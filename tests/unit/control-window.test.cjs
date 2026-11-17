'use strict';

// The waiting between main and the window for what a tool asked the window
// to do (#764). The window itself is a recording `send` here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { REFUSALS, createWindowRequests } = require('../../src/control-window.cjs');

function harness({ sendThrows = false } = {}) {
	const sent = [];
	let n = 0;
	const requests = createWindowRequests({
		send: (request) => {
			if (sendThrows) throw new Error('no window');
			sent.push(request);
		},
		newId: () => `id-${n += 1}`
	});
	return { sent, requests };
}

const turn = () => new Promise((resolve) => setImmediate(resolve));

test('a request goes to a page that is listening, and its answer comes back by its id', async () => {
	const { sent, requests } = harness();
	requests.markReady();

	const first = requests.ask({ action: 'site.server.start', sitePath: '/sites/wp', params: {} });
	const second = requests.ask({ action: 'site.server.stop', sitePath: '/sites/gb', params: {} });
	await turn();
	assert.deepEqual(sent, [
		{ id: 'id-1', action: 'site.server.start', sitePath: '/sites/wp', params: {} },
		{ id: 'id-2', action: 'site.server.stop', sitePath: '/sites/gb', params: {} }
	]);

	// Answered out of order: each answer is its own request's.
	assert.equal(requests.answer('id-2', { ok: true, result: { stopped: true } }), true);
	assert.equal(requests.answer('id-1', { ok: false, code: 'not-built', error: 'Not built.' }), true);
	assert.deepEqual(await second, { ok: true, result: { stopped: true } });
	assert.deepEqual(await first, { ok: false, code: 'not-built', error: 'Not built.' });
	assert.equal(requests.pending(), 0);
});

test('an answer to nothing, or a second answer, changes nothing', async () => {
	const { requests } = harness();
	requests.markReady();
	const asked = requests.ask({ action: 'site.server.start', sitePath: '/sites/wp' });
	await turn();

	assert.equal(requests.answer('id-9', { ok: true, result: {} }), false);
	assert.equal(requests.answer('id-1', { ok: true, result: { url: 'http://127.0.0.1:9400' } }), true);
	assert.equal(requests.answer('id-1', { ok: true, result: { url: 'http://evil.example' } }), false);
	assert.deepEqual(await asked, { ok: true, result: { url: 'http://127.0.0.1:9400' } });
});

test('an answer that is not one is read as a refusal, not passed on', async () => {
	for (const reply of [undefined, null, 'ok', 7, {}, { ok: 'yes' }, { ok: false }, { ok: false, code: 7 }]) {
		const { requests } = harness();
		requests.markReady();
		const asked = requests.ask({ action: 'site.server.start', sitePath: '/sites/wp' });
		await turn();
		requests.answer('id-1', reply);
		assert.deepEqual(await asked, REFUSALS.UNREADABLE, JSON.stringify(reply));
	}
});

test('a request waits for a page that is still loading, and is refused if none comes', async () => {
	const { sent, requests } = harness();

	const waited = requests.ask({ action: 'site.server.start', sitePath: '/sites/wp' });
	await turn();
	assert.deepEqual(sent, [], 'nothing is sent into a page that has not subscribed');
	requests.markReady();
	await turn();
	assert.equal(sent.length, 1);
	requests.answer('id-1', { ok: true, result: {} });
	assert.deepEqual(await waited, { ok: true, result: {} });

	const none = harness();
	assert.deepEqual(await none.requests.ask({ action: 'site.server.start', sitePath: '/sites/wp' }, { readyTimeoutMs: 20 }), REFUSALS.NOT_READY);
	assert.deepEqual(none.sent, []);
});

test('a page that reloads or a window that closes answers everything it was asked, as gone', async () => {
	const { sent, requests } = harness();
	requests.markReady();
	const asked = requests.ask({ action: 'site.server.start', sitePath: '/sites/wp' });
	await turn();

	requests.reset();
	assert.deepEqual(await asked, REFUSALS.GONE);
	// The old page's answer, arriving late, is not the new page's.
	assert.equal(requests.answer('id-1', { ok: true, result: {} }), false);

	// The page that follows has to say it is listening before it is asked.
	const next = requests.ask({ action: 'site.server.stop', sitePath: '/sites/wp' });
	await turn();
	assert.equal(sent.length, 1);
	requests.markReady();
	await turn();
	assert.equal(sent.length, 2);
	requests.answer('id-2', { ok: true, result: {} });
	await next;
});

test('a window that went away between the check and the send is answered as gone', async () => {
	const { requests } = harness({ sendThrows: true });
	requests.markReady();
	assert.deepEqual(await requests.ask({ action: 'site.server.start', sitePath: '/sites/wp' }), REFUSALS.GONE);
	assert.equal(requests.pending(), 0);
});
