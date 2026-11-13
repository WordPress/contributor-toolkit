'use strict';

// What the window does with a request from the `toolkit` command (#764):
// which row, what to press, and how the end is read off the page's state.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
	SITE_ACTIONS,
	createControlRegistry,
	createOutcomeWaiters,
	serverStartPlan,
	serverStartOutcome,
	serverStopPlan,
	serverStopOutcome,
	performSiteControl
} = require('../../src/renderer/control-requests.cjs');

const URL = 'http://127.0.0.1:9400';

// A row's state: a built site with nothing running, unless said otherwise.
const row = ({ held = false, canServe = true, ...server } = {}) => ({
	held,
	canServe,
	server: { running: false, starting: false, url: '', failure: '', ...server }
});

// A row as index.jsx wires one: its state, its presses recorded, and
// `render`, which is what a render does, handing the new state over.
function mountedRow(initial = row()) {
	const pressed = [];
	const waiters = createOutcomeWaiters();
	const state = { snapshot: initial };
	return {
		pressed,
		perform: (action) => performSiteControl(action, { snapshot: state.snapshot, presses: { toggleDevServer: () => pressed.push('toggleDevServer') }, waiters }),
		render(next) {
			state.snapshot = next;
			waiters.settle(next);
		},
		waiters
	};
}

test('a request goes to the row of the site it names, and a site with no row is refused', async () => {
	const registry = createControlRegistry();
	const asked = [];
	const unregister = registry.register('/sites/wp', async (action, params) => { asked.push({ action, params }); return { ok: true, result: { url: URL } }; });

	assert.deepEqual(await registry.handle({ id: '1', action: 'site.server.start', sitePath: '/sites/wp' }), { ok: true, result: { url: URL } });
	assert.deepEqual(asked, [{ action: 'site.server.start', params: {} }]);

	for (const request of [{ action: 'site.server.start', sitePath: '/sites/other' }, { action: 'site.server.start' }, null, undefined]) {
		assert.equal((await registry.handle(request)).code, 'site-not-open');
	}

	unregister();
	assert.equal((await registry.handle({ action: 'site.server.start', sitePath: '/sites/wp' })).code, 'site-not-open');
});

test('an action a row does not have, and a row that throws, are answers', async () => {
	const registry = createControlRegistry();
	registry.register('/sites/wp', (action) => {
		if (action === 'breaks') throw new Error('the row broke');
		return null;
	});

	assert.equal((await registry.handle({ action: 'site.delete', sitePath: '/sites/wp' })).code, 'unknown-action');
	assert.deepEqual(await registry.handle({ action: 'breaks', sitePath: '/sites/wp' }), { ok: false, code: 'failed', error: 'the row broke' });
});

test('a row that is replaced is not taken out by the one it replaced', async () => {
	const registry = createControlRegistry();
	const unregisterOld = registry.register('/sites/wp', async () => ({ ok: true, result: { from: 'old' } }));
	registry.register('/sites/wp', async () => ({ ok: true, result: { from: 'new' } }));
	unregisterOld();

	assert.deepEqual(await registry.handle({ action: 'x', sitePath: '/sites/wp' }), { ok: true, result: { from: 'new' } });
});

test('the only actions a row has are the ones a tool was allowed', () => {
	// A new action here is a new thing a tool can make the window do; main's
	// `controlActions` has to offer it too, and the settings have to name it.
	assert.deepEqual(Object.keys(SITE_ACTIONS), ['site.server.start', 'site.server.stop']);
});

test('start presses the button on a built site with no server, and nothing else', () => {
	assert.deepEqual(serverStartPlan(row()), { press: true });
	assert.deepEqual(serverStartPlan(row({ running: true, url: URL })), { done: { ok: true, result: { url: URL, started: false } } });
	// On its way already: the request waits for that start, and does not
	// press, which would be a second one.
	assert.deepEqual(serverStartPlan(row({ starting: true })), { wait: true });
	assert.deepEqual(serverStartPlan(row({ running: true })), { wait: true });
	assert.equal(serverStartPlan(row({ canServe: false })).refuse.code, 'not-built');
	assert.equal(serverStartPlan(row({ held: true })).refuse.code, 'busy');
	// A site that is busy and has a server up still says where it is.
	assert.equal(serverStartPlan(row({ held: true, running: true, url: URL })).done.result.url, URL);
});

test('a start has ended when the server has an address, or when the page stopped starting without one', () => {
	const outcome = serverStartOutcome();
	// Before the press has reached the page, a failure it still shows is an
	// earlier start's.
	assert.equal(outcome(row({ failure: 'The last start timed out.' })), null);
	assert.equal(outcome(row({ starting: true })), null);
	assert.equal(outcome(row({ running: true })), null);
	assert.deepEqual(outcome(row({ running: true, url: URL })), { ok: true, result: { url: URL, started: true } });

	const failed = serverStartOutcome();
	failed(row({ starting: true }));
	assert.deepEqual(failed(row({ failure: 'Timed out starting the server.' })), { ok: false, code: 'server-failed', error: 'Timed out starting the server.' });

	// Cancelled with nothing said, as when the build watch ahead of it stops.
	const cancelled = serverStartOutcome();
	cancelled(row({ starting: true }));
	assert.equal(cancelled(row()).code, 'server-failed');

	// Joined a start already on its way: its end is this one's too.
	assert.equal(serverStartOutcome({ begun: true })(row()).code, 'server-failed');
});

test('stop presses the button on a running server, and has ended when nothing is running', () => {
	assert.deepEqual(serverStopPlan(row({ running: true, url: URL })), { press: true });
	assert.deepEqual(serverStopPlan(row()), { done: { ok: true, result: { stopped: false } } });
	// The page's own button does nothing while a start is on its way.
	assert.equal(serverStopPlan(row({ starting: true })).refuse.code, 'busy');

	const outcome = serverStopOutcome();
	assert.equal(outcome(row({ running: true, url: URL })), null);
	assert.deepEqual(outcome(row()), { ok: true, result: { stopped: true } });
});

test('a start request presses once and answers when a later render shows the address', async () => {
	const site = mountedRow();
	const reply = site.perform('site.server.start');
	assert.deepEqual(site.pressed, ['toggleDevServer']);

	site.render(row({ starting: true }));
	site.render(row({ running: true, url: URL }));
	assert.deepEqual(await reply, { ok: true, result: { url: URL, started: true } });
});

test('a second start request while one is on its way does not press again, and both hear the end', async () => {
	const site = mountedRow();
	const first = site.perform('site.server.start');
	site.render(row({ starting: true }));
	const second = site.perform('site.server.start');
	assert.deepEqual(site.pressed, ['toggleDevServer']);

	site.render(row({ running: true, url: URL }));
	assert.equal((await first).result.url, URL);
	assert.equal((await second).result.url, URL);
});

test('a request that is refused, or already done, presses nothing', async () => {
	const unbuilt = mountedRow(row({ canServe: false }));
	assert.equal((await unbuilt.perform('site.server.start')).code, 'not-built');
	const stopped = mountedRow();
	assert.deepEqual(await stopped.perform('site.server.stop'), { ok: true, result: { stopped: false } });
	assert.deepEqual([...unbuilt.pressed, ...stopped.pressed], []);

	assert.equal(mountedRow().perform('site.delete'), null);
});

test('a row that goes away answers what it owed, and one that never ends is given up on', async () => {
	const site = mountedRow();
	const reply = site.perform('site.server.start');
	site.waiters.abandon();
	assert.equal((await reply).code, 'site-not-open');

	const waiters = createOutcomeWaiters();
	assert.equal((await waiters.wait(() => null, 20)).code, 'timed-out');
	// An answer given is given once: a later render does not answer again.
	let answers = 0;
	const once = waiters.wait(() => { answers += 1; return { ok: true, result: {} }; });
	waiters.settle(row());
	waiters.settle(row());
	await once;
	assert.equal(answers, 1);
});
