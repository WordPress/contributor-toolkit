'use strict';

// What the window does with a request from the `toolkit` command (#764):
// which row, what to press, and how the end is read. The row here is a
// stand-in with the same two things index.jsx hands over: its state after
// each render, and its own functions.

const test = require('node:test');
const assert = require('node:assert/strict');

const {
	APP_ACTIONS,
	SITE_ACTIONS,
	SETTLED,
	MAX_OUTPUT,
	rowActivity,
	createControlRegistry,
	createOutcomeWaiters,
	serverStartPlan,
	serverStartOutcome,
	serverStopPlan,
	serverStopOutcome,
	scriptRefusal,
	tailOfOutput,
	waitForSetup,
	performSiteControl,
	performAppControl
} = require('../../src/renderer/control-requests.cjs');
const { pickLatest } = require('../../src/latest-patch.cjs');

const URL = 'http://127.0.0.1:9400';
const CORE_SCRIPTS = ['build', 'build:dev', 'dev', 'test', 'watch', 'grunt'];

// A row's state: a built site with nothing running, unless said otherwise.
function row(changes = {}) {
	const base = {
		loading: false,
		held: false,
		busy: false,
		canServe: true,
		scripts: CORE_SCRIPTS,
		server: { running: false, starting: false, url: '', failure: '' },
		ticket: { blocked: null },
		apply: { fetching: null, preview: null, error: '', conflict: '' },
		patches: { isTrac: true, prs: [], prsStatus: 'ok', prRankComplete: true, prsLoading: false, attachments: [], attachmentsStatus: null, attachmentsLoading: false },
		update: { state: 'idle', dirtyOpen: false, failed: false, summary: null }
	};
	const next = { ...base, ...changes };
	for (const key of ['server', 'ticket', 'apply', 'patches', 'update']) next[key] = { ...base[key], ...(changes[key] || {}) };
	return next;
}

// What main says of the site, which the actions ask for before and after.
const status = (changes = {}) => ({ tracTicket: null, pullRequest: null, appliedPatch: null, buildFailed: false, installFailed: false, updateIncomplete: false, ...changes });

// A row as index.jsx wires one. `presses` are recorded and can be given a
// result; `render` is what a render does, handing the new state over.
function mountedRow({ initial = row(), results = {}, statuses = [status()] } = {}) {
	const pressed = [];
	const waiters = createOutcomeWaiters();
	const state = { snapshot: initial };
	// A mounted row has rendered once, and handed its state over.
	waiters.settle(initial);
	const remaining = [...statuses];
	const press = (name) => (...args) => {
		pressed.push(args.length ? { name, args } : name);
		return typeof results[name] === 'function' ? results[name](...args) : results[name];
	};
	const presses = {
		readStatus: async () => (remaining.length > 1 ? remaining.shift() : remaining[0])
	};
	for (const name of ['toggleDevServer', 'runTerminalCommand', 'linkRef', 'unlinkTicket', 'previewPullRequest', 'previewAttachment', 'loadTracAttachments', 'loadTicketPatches', 'applyPreview', 'leavePullRequest', 'startTrunkUpdate']) presses[name] = press(name);
	return {
		pressed,
		perform: (action, params = {}) => performSiteControl(action, params, { latest: () => ({ snapshot: state.snapshot, presses }), waiters, deps: { pickLatest } }),
		render(next) {
			state.snapshot = next;
			waiters.settle(next);
		},
		waiters
	};
}

// Lets the awaits inside an action run up to its next wait on the page.
const turn = async () => { for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

test('a request goes to the row of the site it names, and a site with no row is refused', async () => {
	const registry = createControlRegistry();
	const asked = [];
	const unregister = registry.register('/sites/wp', async (action, params) => { asked.push({ action, params }); return { ok: true, result: { url: URL } }; });

	assert.deepEqual(await registry.handle({ id: '1', action: 'site.server.start', sitePath: '/sites/wp' }), { ok: true, result: { url: URL } });
	assert.deepEqual(asked, [{ action: 'site.server.start', params: {} }]);

	for (const request of [{ action: 'site.server.start', sitePath: '/sites/other' }, null, undefined]) {
		assert.equal((await registry.handle(request)).code, 'site-not-open');
	}
	unregister();
	assert.equal((await registry.handle({ action: 'site.server.start', sitePath: '/sites/wp' })).code, 'site-not-open');
});

test('a request about no site goes to the window itself, and to no row', async () => {
	const registry = createControlRegistry();
	registry.register('/sites/wp', async () => ({ ok: true, result: { from: 'row' } }));
	assert.equal((await registry.handle({ action: 'sites.create', sitePath: null, params: { name: 'Demo' } })).code, 'site-not-open');

	const unregister = registry.registerApp(async (action, params) => ({ ok: true, result: { from: 'app', action, params } }));
	assert.deepEqual(await registry.handle({ action: 'sites.create', sitePath: null, params: { name: 'Demo' } }), { ok: true, result: { from: 'app', action: 'sites.create', params: { name: 'Demo' } } });
	assert.deepEqual(await registry.handle({ action: 'x', sitePath: '/sites/wp' }), { ok: true, result: { from: 'row' } });
	unregister();
	assert.equal((await registry.handle({ action: 'sites.create' })).code, 'site-not-open');
});

test('an action nothing has, and a row that throws, are answers', async () => {
	const registry = createControlRegistry();
	registry.register('/sites/wp', (action) => {
		if (action === 'breaks') throw new Error('the row broke');
		return null;
	});
	assert.equal((await registry.handle({ action: 'site.delete', sitePath: '/sites/wp' })).code, 'unknown-action');
	assert.deepEqual(await registry.handle({ action: 'breaks', sitePath: '/sites/wp' }), { ok: false, code: 'failed', error: 'the row broke' });
	assert.equal(await mountedRow().perform('site.delete'), null);
	assert.equal(performAppControl('sites.delete', {}, { latest: () => ({}) }), null);
});

test('a row that is replaced is not taken out by the one it replaced', async () => {
	const registry = createControlRegistry();
	const unregisterOld = registry.register('/sites/wp', async () => ({ ok: true, result: { from: 'old' } }));
	registry.register('/sites/wp', async () => ({ ok: true, result: { from: 'new' } }));
	unregisterOld();
	assert.deepEqual(await registry.handle({ action: 'x', sitePath: '/sites/wp' }), { ok: true, result: { from: 'new' } });
});

test('the actions the window has are the ones a tool was allowed, and none that loses work', () => {
	// A new action here is a new thing a tool can make the window do: main's
	// `controlActions` has to offer it, and the settings have to name it.
	assert.deepEqual(Object.keys(SITE_ACTIONS), ['site.server.start', 'site.server.stop', 'site.script.run', 'site.ticket.link', 'site.ticket.unlink', 'site.pr.checkout', 'site.pr.leave', 'site.patch.apply-latest', 'site.trunk.update']);
	assert.deepEqual(Object.keys(APP_ACTIONS), ['sites.create']);
	for (const name of [...Object.keys(SITE_ACTIONS), ...Object.keys(APP_ACTIONS)]) assert.doesNotMatch(name, /delete|discard|revert|submit|open-pr/);
});

// --- the server ------------------------------------------------------------

test('start presses the button on a built site with no server, and nothing else', () => {
	assert.deepEqual(serverStartPlan(row()), { press: true });
	assert.deepEqual(serverStartPlan(row({ server: { running: true, url: URL } })), { done: { ok: true, result: { url: URL, started: false } } });
	// On its way already: the request waits for that start, and does not
	// press, which would be a second one.
	assert.deepEqual(serverStartPlan(row({ server: { starting: true } })), { wait: true });
	assert.equal(serverStartPlan(row({ canServe: false })).refuse.code, 'not-built');
	assert.equal(serverStartPlan(row({ held: true })).refuse.code, 'busy');
	assert.equal(serverStartPlan(row({ held: true, server: { running: true, url: URL } })).done.result.url, URL);
});

test('a start has ended when the server has an address, or when the page stopped starting without one', () => {
	const outcome = serverStartOutcome();
	// Before the press has reached the page, a failure it still shows is an
	// earlier start's.
	assert.equal(outcome(row({ server: { failure: 'The last start timed out.' } })), null);
	assert.equal(outcome(row({ server: { starting: true } })), null);
	assert.deepEqual(outcome(row({ server: { running: true, url: URL } })), { ok: true, result: { url: URL, started: true } });

	const failed = serverStartOutcome();
	failed(row({ server: { starting: true } }));
	assert.deepEqual(failed(row({ server: { failure: 'Timed out starting the server.' } })), { ok: false, code: 'server-failed', error: 'Timed out starting the server.' });
	// Joined a start already on its way: its end is this one's too.
	assert.equal(serverStartOutcome({ begun: true })(row()).code, 'server-failed');
});

test('stop presses the button on a running server, and has ended when nothing is running', () => {
	assert.deepEqual(serverStopPlan(row({ server: { running: true, url: URL } })), { press: true });
	assert.deepEqual(serverStopPlan(row()), { done: { ok: true, result: { stopped: false } } });
	assert.equal(serverStopPlan(row({ server: { starting: true } })).refuse.code, 'busy');
	const outcome = serverStopOutcome();
	assert.equal(outcome(row({ server: { running: true, url: URL } })), null);
	assert.deepEqual(outcome(row()), { ok: true, result: { stopped: true } });
});

test('a start request presses once, a second one joins it, and both hear the address', async () => {
	const site = mountedRow();
	const first = site.perform('site.server.start');
	await turn();
	site.render(row({ server: { starting: true } }));
	const second = site.perform('site.server.start');
	await turn();
	assert.deepEqual(site.pressed, ['toggleDevServer']);

	site.render(row({ server: { running: true, url: URL } }));
	assert.equal((await first).result.url, URL);
	assert.equal((await second).result.url, URL);
});

test('a row that goes away answers what it owed, and one that never ends is given up on', async () => {
	const site = mountedRow();
	const reply = site.perform('site.server.start');
	await turn();
	site.waiters.abandon();
	assert.equal((await reply).code, 'site-not-open');

	const waiters = createOutcomeWaiters();
	assert.equal((await waiters.wait(() => null, 20)).code, 'timed-out');
	let answers = 0;
	const once = waiters.wait(() => { answers += 1; return { ok: true, result: {} }; });
	waiters.settle(row());
	waiters.settle(row());
	await once;
	assert.equal(answers, 1, 'an answer given is given once');
});

// --- scripts ---------------------------------------------------------------

test('a tool can run what the terminal\'s list has, except the watches that never end', () => {
	assert.equal(scriptRefusal('build', CORE_SCRIPTS), null);
	assert.equal(scriptRefusal('install', CORE_SCRIPTS), null);
	for (const script of ['start', 'postinstall', 'build && rm -rf ~', '', undefined, 7, ['build']]) {
		assert.equal(scriptRefusal(script, CORE_SCRIPTS).code, 'unsupported-script', String(script));
	}
	for (const script of ['watch', 'dev']) assert.match(scriptRefusal(script, CORE_SCRIPTS).error, /does not end/);
	// The list offered is the one that can be run.
	assert.match(scriptRefusal('nope', CORE_SCRIPTS).error, /install, build, build:dev, test, grunt\./);
});

test('a script is typed into the site\'s terminal, and its exit code and the end of its output are the answer', async () => {
	const built = mountedRow({ results: { runTerminalCommand: async () => ({ code: 0, output: 'Done.\n' }) } });
	assert.deepEqual(await built.perform('site.script.run', { script: 'build' }), { ok: true, result: { command: 'npm run build', code: 0, output: 'Done.\n' } });
	assert.deepEqual(built.pressed, [{ name: 'runTerminalCommand', args: ['npm run build'] }]);

	const installed = mountedRow({ results: { runTerminalCommand: async () => ({ code: 0, output: '' }) } });
	await installed.perform('site.script.run', { script: 'install' });
	assert.deepEqual(installed.pressed, [{ name: 'runTerminalCommand', args: ['npm install'] }]);

	const failed = mountedRow({ results: { runTerminalCommand: async () => ({ code: 1, output: 'Error: boom' }) } });
	assert.deepEqual(await failed.perform('site.script.run', { script: 'build' }), { ok: false, code: 'script-failed', error: 'npm run build exited with code 1.', output: 'Error: boom' });

	// Refused before the terminal is touched, and by the terminal's own lock.
	const refused = mountedRow({ initial: row({ busy: true }) });
	assert.equal((await refused.perform('site.script.run', { script: 'build' })).code, 'busy');
	assert.equal((await mountedRow().perform('site.script.run', { script: 'watch' })).code, 'unsupported-script');
	assert.deepEqual(refused.pressed, []);
	const locked = mountedRow({ results: { runTerminalCommand: async () => ({ refused: 'busy', output: '' }) } });
	assert.equal((await locked.perform('site.script.run', { script: 'build' })).code, 'busy');

	assert.equal(tailOfOutput('x'.repeat(MAX_OUTPUT + 50)).length, MAX_OUTPUT);
	assert.equal(tailOfOutput('abcdef', 3), 'def');
});

// --- tickets ---------------------------------------------------------------

test('linking a ticket is the card\'s own link, and its answer is the page\'s', async () => {
	const linked = mountedRow({ results: { linkRef: async () => ({ ok: true, ticket: 62281, branch: 'ticket/62281', rebuilding: false }) } });
	assert.deepEqual(await linked.perform('site.ticket.link', { ref: 62281 }), { ok: true, result: { ticket: 62281, branch: 'ticket/62281', rebuilt: false } });
	assert.deepEqual(linked.pressed, [{ name: 'linkRef', args: ['62281', undefined] }]);

	const carried = mountedRow({ results: { linkRef: async () => ({ ok: true, ticket: 62281, branch: 'ticket/62281', rebuilding: false }) } });
	await carried.perform('site.ticket.link', { ref: ' 62281 ', carry: true });
	assert.deepEqual(carried.pressed, [{ name: 'linkRef', args: ['62281', { carryTrunkWork: true }] }]);

	for (const ref of [undefined, '', '  ', {}, ['62281']]) {
		assert.equal((await mountedRow().perform('site.ticket.link', { ref })).code, 'invalid-request');
	}
	assert.equal((await mountedRow({ initial: row({ busy: true }) }).perform('site.ticket.link', { ref: '62281' })).code, 'busy');
});

test('a link the page refused says why, and edits on trunk are a question for the window or for --carry', async () => {
	const refusing = (result) => mountedRow({ results: { linkRef: async () => result } }).perform('site.ticket.link', { ref: '62281' });

	const dirty = await refusing({ ok: false, code: 'dirty-trunk', canCarry: true, files: 3 });
	assert.equal(dirty.code, 'dirty-trunk');
	assert.match(dirty.error, /3 edited file\(s\).*--carry/);
	assert.doesNotMatch((await refusing({ ok: false, code: 'dirty-trunk', canCarry: false, files: null })).error, /--carry/);

	assert.deepEqual(await refusing({ ok: false, code: 'is-pull-request', error: '#70123 is a pull request.' }), { ok: false, code: 'is-pull-request', error: '#70123 is a pull request.' });
	assert.equal((await refusing({ ok: false, code: 'legacy-site', error: 'This site was made by an older version.' })).code, 'legacy-site');
	assert.equal((await refusing({ ok: false, code: 'busy' })).code, 'busy');
	// A press the page turned away before it began answers nothing.
	assert.equal((await refusing(undefined)).code, 'failed');
});

test('a switch that puts a pull request back is not over until its rebuild is, and says if that failed', async () => {
	const site = mountedRow({
		initial: row({ busy: true }),
		results: { linkRef: async () => ({ ok: true, ticket: 62281, branch: 'pr/9000', rebuilding: true }) },
		statuses: [status({ tracTicket: 62281, buildFailed: true })]
	});
	// The row was idle when asked; the switch took the lock.
	const reply = performSiteControl('site.ticket.link', { ref: '62281' }, {
		latest: (() => { let asked = 0; return () => ({ snapshot: asked++ === 0 ? row() : row({ busy: true }), presses: { linkRef: async () => ({ ok: true, ticket: 62281, branch: 'pr/9000', rebuilding: true }), readStatus: async () => status({ tracTicket: 62281, buildFailed: true }) } }); })(),
		waiters: site.waiters
	});
	let answered = false;
	reply.then(() => { answered = true; });
	await turn();
	assert.equal(answered, false, 'still rebuilding');
	site.waiters.settle(row());
	const result = await reply;
	assert.equal(result.result.rebuilt, true);
	assert.match(result.result.warning, /build failed/);
});

test('unlinking a site with nothing linked presses nothing', async () => {
	const none = mountedRow();
	assert.deepEqual(await none.perform('site.ticket.unlink'), { ok: true, result: { ticket: null, branch: null, rebuilt: false } });
	assert.deepEqual(none.pressed, []);

	const linked = mountedRow({ statuses: [status({ tracTicket: 62281 }), status()], results: { unlinkTicket: async () => ({ ok: true, ticket: null, branch: 'trunk', rebuilding: false }) } });
	assert.deepEqual(await linked.perform('site.ticket.unlink'), { ok: true, result: { ticket: null, branch: 'trunk', rebuilt: false } });
	assert.deepEqual(linked.pressed, ['unlinkTicket']);
});

// --- pull requests ---------------------------------------------------------

const PR_PREVIEW = { kind: 'pr', number: 9000, label: 'PR #9000' };

test('a pull request is previewed, then checked out by the preview\'s own button, and main says it is', async () => {
	const site = mountedRow({ statuses: [status(), status({ pullRequest: { number: 9000 } })] });
	const reply = site.perform('site.pr.checkout', { number: 9000 });
	await turn();
	assert.deepEqual(site.pressed, [{ name: 'previewPullRequest', args: [9000] }]);

	site.render(row({ apply: { fetching: 9000 } }));
	site.render(row({ apply: { preview: PR_PREVIEW } }));
	await turn();
	assert.deepEqual(site.pressed.slice(1), ['applyPreview']);

	site.render(row({ busy: true, apply: { preview: PR_PREVIEW } }));
	site.render(row());
	assert.deepEqual(await reply, { ok: true, result: { pullRequest: 9000, checkedOut: true } });
});

test('a pull request that cannot be previewed, or is refused at checkout, is said in the page\'s words', async () => {
	const unfetched = mountedRow();
	const noPreview = unfetched.perform('site.pr.checkout', { number: 9000 });
	await turn();
	unfetched.render(row({ apply: { fetching: 9000 } }));
	unfetched.render(row({ apply: { error: 'Pull request #9000 could not be fetched.' } }));
	assert.deepEqual(await noPreview, { ok: false, code: 'preview-failed', error: 'Pull request #9000 could not be fetched.' });
	assert.deepEqual(unfetched.pressed, [{ name: 'previewPullRequest', args: [9000] }], 'nothing is applied');

	const dirty = mountedRow();
	const blocked = dirty.perform('site.pr.checkout', { number: 9000 });
	await turn();
	dirty.render(row({ apply: { fetching: 9000 } }));
	dirty.render(row({ apply: { preview: PR_PREVIEW } }));
	await turn();
	dirty.render(row({ busy: true }));
	dirty.render(row({ ticket: { blocked: { files: 2 } }, apply: { preview: PR_PREVIEW } }));
	const refused = await blocked;
	assert.equal(refused.code, 'dirty-trunk');
	assert.match(refused.error, /2 edited file\(s\)/);

	// The page went idle with nothing said, and main says it is not checked out.
	const silent = mountedRow();
	const nothing = silent.perform('site.pr.checkout', { number: 9000 });
	await turn();
	silent.render(row({ apply: { fetching: 9000 } }));
	silent.render(row({ apply: { preview: PR_PREVIEW } }));
	await turn();
	silent.render(row({ busy: true }));
	silent.render(row());
	assert.equal((await nothing).code, 'apply-failed');
});

test('a pull request already checked out, a bad number and a busy site press nothing', async () => {
	const already = mountedRow({ statuses: [status({ pullRequest: { number: 9000 } })] });
	assert.deepEqual(await already.perform('site.pr.checkout', { number: 9000 }), { ok: true, result: { pullRequest: 9000, checkedOut: false } });
	for (const number of [undefined, 0, -1, 1.5, 'abc']) assert.equal((await mountedRow().perform('site.pr.checkout', { number })).code, 'invalid-request', String(number));
	const busy = mountedRow({ initial: row({ busy: true }) });
	assert.equal((await busy.perform('site.pr.checkout', { number: 9000 })).code, 'busy');
	assert.deepEqual([...already.pressed, ...busy.pressed], []);
});

test('leaving a pull request presses its button, and is nothing to do with none checked out', async () => {
	const none = mountedRow();
	assert.deepEqual(await none.perform('site.pr.leave'), { ok: true, result: { pullRequest: null, left: false } });
	assert.deepEqual(none.pressed, []);

	const on = mountedRow({ statuses: [status({ pullRequest: { number: 9000 } }), status({ tracTicket: 62281 })] });
	const reply = on.perform('site.pr.leave');
	await turn();
	assert.deepEqual(on.pressed, ['leavePullRequest']);
	on.render(row({ busy: true }));
	on.render(row());
	assert.deepEqual(await reply, { ok: true, result: { pullRequest: null, left: true, ticket: 62281 } });
});

// --- the latest patch ------------------------------------------------------

const ATTACHMENT = { filename: '62281.2.diff', url: 'https://core.trac.wordpress.org/raw-attachment/ticket/62281/62281.2.diff', applyable: true, dateText: '11/10/2026 10:00:00 AM' };

test('the latest patch needs a ticket, and no patch applied already', async () => {
	assert.equal((await mountedRow().perform('site.patch.apply-latest')).code, 'no-ticket');
	const applied = mountedRow({ statuses: [status({ tracTicket: 62281, appliedPatch: { label: '62281.diff' } })] });
	const refused = await applied.perform('site.patch.apply-latest');
	assert.equal(refused.code, 'already-applied');
	assert.match(refused.error, /62281\.diff/);
	assert.deepEqual(applied.pressed, []);
});

test('with nothing on the ticket, or a read of Trac that failed, nothing is applied', async () => {
	const empty = mountedRow({ statuses: [status({ tracTicket: 62281 })] });
	const none = empty.perform('site.patch.apply-latest');
	await turn();
	assert.deepEqual(empty.pressed, ['loadTicketPatches', 'loadTracAttachments']);
	empty.render(row({ patches: { attachmentsLoading: true } }));
	empty.render(row({ patches: { attachmentsStatus: 'ok' } }));
	assert.equal((await none).code, 'no-latest-patch');

	const down = mountedRow({ statuses: [status({ tracTicket: 62281 })] });
	const failed = down.perform('site.patch.apply-latest');
	await turn();
	down.render(row({ patches: { attachmentsLoading: true } }));
	down.render(row({ patches: { attachmentsStatus: 'error' } }));
	assert.equal((await failed).code, 'trac-failed');
	assert.deepEqual(down.pressed, ['loadTicketPatches', 'loadTracAttachments']);
});

test('the latest patch on a Trac ticket is read from Trac, previewed, applied by the preview\'s own button, and named by main', async () => {
	const older = { ...ATTACHMENT, filename: '62281.diff', url: `${ATTACHMENT.url}.old`, dateText: '11/01/2026 10:00:00 AM' };
	const screenshot = { filename: 'before.png', url: 'https://core.trac.wordpress.org/raw-attachment/ticket/62281/before.png', applyable: false, dateText: '11/12/2026 10:00:00 AM' };
	const site = mountedRow({ statuses: [status({ tracTicket: 62281 }), status({ tracTicket: 62281, appliedPatch: { label: '62281.2.diff' } })] });
	const reply = site.perform('site.patch.apply-latest');
	await turn();
	site.render(row({ patches: { attachmentsLoading: true } }));
	site.render(row({ patches: { attachmentsStatus: 'ok', attachments: [older, screenshot, ATTACHMENT] } }));
	await turn();
	// The newest that can be applied: not the older diff, not the screenshot.
	assert.deepEqual(site.pressed, ['loadTicketPatches', 'loadTracAttachments', { name: 'previewAttachment', args: [ATTACHMENT] }]);

	site.render(row({ apply: { fetching: ATTACHMENT.url } }));
	site.render(row({ apply: { preview: { kind: 'patch', number: null, label: '62281.2.diff' } } }));
	await turn();
	assert.equal(site.pressed[3], 'applyPreview');
	site.render(row({ busy: true }));
	site.render(row());
	assert.deepEqual(await reply, { ok: true, result: { appliedPatch: '62281.2.diff' } });
});

test('a patch that does not apply is refused in the page\'s words, and nothing is said to be applied', async () => {
	const site = mountedRow({ statuses: [status({ tracTicket: 62281 })] });
	const reply = site.perform('site.patch.apply-latest');
	await turn();
	site.render(row({ patches: { attachmentsLoading: true } }));
	site.render(row({ patches: { attachmentsStatus: 'ok', attachments: [ATTACHMENT] } }));
	await turn();
	site.render(row({ apply: { fetching: ATTACHMENT.url } }));
	site.render(row({ apply: { preview: { kind: 'patch', number: null, label: '62281.2.diff' } } }));
	await turn();
	site.render(row({ busy: true }));
	site.render(row({ apply: { error: 'The patch could not be applied.' } }));
	assert.deepEqual(await reply, { ok: false, code: 'apply-failed', error: 'The patch could not be applied.' });
});

test('the latest patch on a GitHub site is its newest pull request, read for this request, with no visit to Trac', async () => {
	const pr = { number: 9000, url: 'https://github.com/WordPress/gutenberg/pull/9000', commitDate: '2026-11-12T10:00:00Z' };
	assert.deepEqual(pickLatest({ prs: [pr], attachments: [], prRankComplete: true })?.key, 9000, 'this app\'s own ranking names it');
	// A row that is not the one on screen has never read the list.
	const site = mountedRow({
		initial: row({ patches: { isTrac: false, prs: [], prsStatus: null } }),
		statuses: [status({ tracTicket: 70123 }), status({ tracTicket: 70123 }), status({ tracTicket: 70123, pullRequest: { number: 9000 } })]
	});
	const reply = site.perform('site.patch.apply-latest');
	await turn();
	assert.deepEqual(site.pressed, ['loadTicketPatches']);
	site.render(row({ patches: { isTrac: false, prsLoading: true } }));
	site.render(row({ patches: { isTrac: false, prs: [pr], prsStatus: 'ok' } }));
	await turn();
	assert.deepEqual(site.pressed[1], { name: 'previewPullRequest', args: [9000] });
	site.render(row({ apply: { fetching: 9000 } }));
	site.render(row({ apply: { preview: PR_PREVIEW } }));
	await turn();
	site.render(row({ busy: true }));
	site.render(row());
	assert.deepEqual(await reply, { ok: true, result: { pullRequest: 9000, checkedOut: true } });
});

test('a pull request list that could not be read is not taken for an empty one', async () => {
	const site = mountedRow({ statuses: [status({ tracTicket: 62281 })] });
	const reply = site.perform('site.patch.apply-latest');
	await turn();
	site.render(row({ patches: { prsLoading: true, attachmentsLoading: true } }));
	site.render(row({ patches: { prsStatus: 'error', attachmentsStatus: 'ok', attachments: [ATTACHMENT] } }));
	assert.equal((await reply).code, 'patches-failed');
	assert.deepEqual(site.pressed, ['loadTicketPatches', 'loadTracAttachments'], 'nothing is previewed or applied');
});

// --- trunk -----------------------------------------------------------------

test('an update presses the update button and answers when the page and main say it is over', async () => {
	const site = mountedRow();
	const reply = site.perform('site.trunk.update');
	await turn();
	assert.deepEqual(site.pressed, ['startTrunkUpdate']);
	site.render(row({ busy: true, update: { state: 'fetching' } }));
	site.render(row({ busy: true, update: { state: 'building' } }));
	site.render(row({ update: { summary: { lockfileChanged: false } } }));
	assert.deepEqual(await reply, { ok: true, result: { updated: true, upToDate: false } });

	const current = mountedRow();
	const nothing = current.perform('site.trunk.update');
	await turn();
	current.render(row({ busy: true, update: { state: 'fetching' } }));
	current.render(row());
	assert.deepEqual(await nothing, { ok: true, result: { updated: false, upToDate: true } });
});

test('an update that would reset edits, could not fetch, or did not build is not reported as done', async () => {
	const dirty = mountedRow();
	const asked = dirty.perform('site.trunk.update');
	await turn();
	dirty.render(row({ update: { dirtyOpen: true } }));
	assert.equal((await asked).code, 'dirty');

	const offline = mountedRow();
	const failed = offline.perform('site.trunk.update');
	await turn();
	offline.render(row({ busy: true, update: { state: 'fetching' } }));
	offline.render(row({ update: { failed: true } }));
	assert.equal((await failed).code, 'update-failed');

	const unbuilt = mountedRow({ statuses: [status({ updateIncomplete: true })] });
	const half = unbuilt.perform('site.trunk.update');
	await turn();
	unbuilt.render(row({ busy: true, update: { state: 'building' } }));
	unbuilt.render(row());
	const refused = await half;
	assert.equal(refused.code, 'update-failed');
	assert.match(refused.error, /not usable yet/);

	const busy = mountedRow({ initial: row({ busy: true }) });
	assert.equal((await busy.perform('site.trunk.update')).code, 'busy');
	assert.deepEqual(busy.pressed, []);
});

// --- a new site ------------------------------------------------------------

function app({ creating = false, defaultFolder = '/Users/dev/sites', created = { ok: true, path: '/Users/dev/sites/demo' }, statuses = [{ hasNodeModules: true, hasBuilt: true }] } = {}) {
	const asked = [];
	const remaining = [...statuses];
	return {
		asked,
		perform: (params) => performAppControl('sites.create', params, {
			latest: () => ({
				snapshot: { creating, defaultFolder },
				presses: {
					startSiteSetup: async (options) => { asked.push(options); return created; },
					readStatus: async () => (remaining.length > 1 ? remaining.shift() : remaining[0]),
					whenSettled: async () => ({ ok: true, result: {} })
				}
			}),
			deps: { sleep: async () => {} }
		})
	};
}

test('a site is made by the dialog\'s own function, in the folder named or the one the settings hold', async () => {
	const window = app();
	assert.deepEqual(await window.perform({ name: ' Demo ' }), { ok: true, result: { site: '/Users/dev/sites/demo', project: 'core', name: 'Demo' } });
	assert.deepEqual(window.asked, [{ name: 'Demo', dir: '/Users/dev/sites', projectType: 'core' }]);

	const elsewhere = app();
	await elsewhere.perform({ name: 'Demo', project: 'gutenberg', folder: '/tmp/sites' });
	assert.deepEqual(elsewhere.asked, [{ name: 'Demo', dir: '/tmp/sites', projectType: 'gutenberg' }]);
});

test('a site with no name, no folder, an unknown project, or asked for during another setup is not started', async () => {
	const refused = async (window, params) => { const reply = await window.perform(params); assert.deepEqual(window.asked, []); return reply.code; };
	assert.equal(await refused(app(), { name: '  ' }), 'invalid-request');
	assert.equal(await refused(app(), {}), 'invalid-request');
	assert.equal(await refused(app(), { name: 'Demo', project: 'drupal' }), 'invalid-request');
	assert.equal(await refused(app({ defaultFolder: null }), { name: 'Demo' }), 'no-folder');
	assert.equal(await refused(app({ creating: true }), { name: 'Demo' }), 'busy');
});

test('a new site is ready when it is installed and built, and a setup that failed says which step', async () => {
	const slow = app({ statuses: [{}, { hasNodeModules: true }, { hasNodeModules: true, hasBuilt: true }] });
	assert.equal((await slow.perform({ name: 'Demo' })).ok, true);

	const clone = await app({ created: { ok: false, error: 'The folder already exists.' } }).perform({ name: 'Demo' });
	assert.deepEqual(clone, { ok: false, code: 'setup-failed', error: 'The folder already exists.' });

	const install = await app({ statuses: [{}, { installFailed: true }] }).perform({ name: 'Demo' });
	assert.equal(install.code, 'setup-failed');
	assert.match(install.error, /npm install failed/);
	// The site exists all the same, and the answer says where.
	assert.equal(install.site, '/Users/dev/sites/demo');

	const build = await app({ statuses: [{ hasNodeModules: true, buildFailed: true }] }).perform({ name: 'Demo' });
	assert.match(build.error, /first build failed/);

	let clock = 0;
	const never = await waitForSetup('/sites/demo', { readStatus: async () => ({}), sleep: async () => {}, now: () => { clock += 1000; return clock; }, timeoutMs: 5000 });
	assert.equal(never.code, 'timed-out');
});

// --- what the review of this found ------------------------------------------

test('what a row is in the middle of is read from the flags its page is drawn from', () => {
	const idle = { statusLoading: false, isPending: false, isDeleting: false, isUpdating: false, setupChainState: 'idle', terminalRunning: false, isApplying: false, installing: false, building: false, ticketSaving: false };
	assert.deepEqual(rowActivity(idle), { loading: false, held: false, busy: false });
	assert.deepEqual(rowActivity({ ...idle, statusLoading: true }), { loading: true, held: false, busy: false });
	for (const flag of ['isPending', 'isDeleting']) assert.deepEqual(rowActivity({ ...idle, [flag]: true }), { loading: false, held: true, busy: false }, flag);
	assert.deepEqual(rowActivity({ ...idle, setupChainState: 'installing' }), { loading: false, held: true, busy: false });
	for (const flag of ['terminalRunning', 'isApplying', 'installing', 'building', 'ticketSaving']) assert.deepEqual(rowActivity({ ...idle, [flag]: true }), { loading: false, held: false, busy: true }, flag);
	// An update holds the site and is work that ends: both.
	assert.deepEqual(rowActivity({ ...idle, isUpdating: true }), { loading: false, held: true, busy: true });
});

test('a request for a site whose row is still being mounted waits for it, and is refused only if none comes', async () => {
	const registry = createControlRegistry({ rowWaitMs: 40 });
	// The window has only just opened: no row yet.
	const early = registry.handle({ action: 'site.server.start', sitePath: '/sites/wp' });
	registry.register('/sites/wp', async () => ({ ok: true, result: { url: URL } }));
	assert.deepEqual(await early, { ok: true, result: { url: URL } });

	assert.equal((await registry.handle({ action: 'site.server.start', sitePath: '/sites/never' })).code, 'site-not-open');
});

test('a request waits for a row that is still reading its site\'s status, and acts on what it then reads', async () => {
	const site = mountedRow({ initial: row({ loading: true, canServe: false }) });
	const reply = site.perform('site.server.start');
	await turn();
	assert.deepEqual(site.pressed, [], 'nothing is decided from a status not yet read');
	site.render(row());
	await turn();
	assert.deepEqual(site.pressed, ['toggleDevServer']);
	site.render(row({ server: { starting: true } }));
	site.render(row({ server: { running: true, url: URL } }));
	assert.equal((await reply).result.url, URL);
});

test('a press the page turned away without a word is answered as busy, not waited on for half an hour', async () => {
	// The terminal was taken between the check and the press: the page says
	// so in the terminal, and nothing an answer is read from ever changes.
	const waiters = createOutcomeWaiters({ startGraceMs: 30 });
	waiters.settle(row());
	const presses = { startTrunkUpdate: () => {}, readStatus: async () => status() };
	const reply = await performSiteControl('site.trunk.update', {}, { latest: () => ({ snapshot: row(), presses }), waiters });
	assert.equal(reply.code, 'busy');

	// One that did begin is not cut short by the same clock.
	const began = createOutcomeWaiters({ startGraceMs: 30 });
	began.settle(row());
	const running = performSiteControl('site.trunk.update', {}, { latest: () => ({ snapshot: row(), presses }), waiters: began });
	await turn();
	began.settle(row({ busy: true, update: { state: 'fetching' } }));
	await new Promise((resolve) => setTimeout(resolve, 60));
	began.settle(row({ update: { summary: {} } }));
	assert.deepEqual(await running, { ok: true, result: { updated: true, upToDate: false } });
});

test('a new site is not called ready while its row still has its first build running', async () => {
	// The folder that says "built" appears before the build has ended.
	let settledAsked = 0;
	let release;
	const stillBuilding = new Promise((resolve) => { release = resolve; });
	const reply = performAppControl('sites.create', { name: 'Demo' }, {
		latest: () => ({
			snapshot: { creating: false, defaultFolder: '/Users/dev/sites' },
			presses: {
				startSiteSetup: async () => ({ ok: true, path: '/Users/dev/sites/demo' }),
				readStatus: async () => ({ hasNodeModules: true, hasBuilt: true }),
				whenSettled: async (sitePath) => { settledAsked += 1; assert.equal(sitePath, '/Users/dev/sites/demo'); await stillBuilding; return { ok: true, result: {} }; }
			}
		}),
		deps: { sleep: async () => {} }
	});
	let answered = false;
	reply.then(() => { answered = true; });
	await turn();
	assert.equal(settledAsked, 1);
	assert.equal(answered, false);
	release();
	assert.equal((await reply).ok, true);
});

test('the window\'s own question to a row is answered once nothing is running there, and is not an action a tool has', async () => {
	assert.equal(Object.hasOwn(SITE_ACTIONS, SETTLED), false);
	const site = mountedRow({ initial: row({ held: true }) });
	const settled = site.perform(SETTLED);
	let answered = false;
	settled.then(() => { answered = true; });
	site.render(row({ busy: true }));
	await turn();
	assert.equal(answered, false);
	site.render(row());
	assert.deepEqual(await settled, { ok: true, result: {} });
});
