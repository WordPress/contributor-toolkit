'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { httpGet, fetchLinkedPrs } = require('../src/github-prs');

// A stand-in for Electron's `net`: request() hands back an EventEmitter whose
// end() lets the test drive the response (or an error) the way the real client
// would. Nothing here touches the network.
function fakeNet(onEnd) {
	return {
		request() {
			const req = new EventEmitter();
			req.setHeader = () => {};
			req.abort = () => { req.aborted = true; };
			req.end = () => onEnd(req);
			return req;
		}
	};
}

function respond(req, { status = 200, headers = {}, body = '' }) {
	const res = new EventEmitter();
	res.statusCode = status;
	res.headers = headers;
	req.emit('response', res);
	if (body) res.emit('data', Buffer.from(body));
	res.emit('end');
}

// --- httpGet transport paths (Copilot #136 #4) ---------------------------

test('httpGet resolves with status, lower-cased headers, and body on success', async () => {
	const res = await httpGet('https://x', {}, {
		net: fakeNet((req) => respond(req, { status: 200, headers: { 'X-RateLimit-Remaining': '59' }, body: 'hello' }))
	});
	assert.strictEqual(res.status, 200);
	assert.strictEqual(res.body, 'hello');
	assert.strictEqual(res.headers['x-ratelimit-remaining'], '59');
});

test('httpGet rejects on a transport error, never resolving', async () => {
	await assert.rejects(
		httpGet('https://x', {}, { net: fakeNet((req) => req.emit('error', new Error('boom'))) }),
		/boom/
	);
});

test('httpGet rejects and aborts the request on timeout', async () => {
	let fire;
	let aborted = false;
	const p = httpGet('https://x', {}, {
		net: { request() {
			const req = new EventEmitter();
			req.setHeader = () => {};
			req.abort = () => { aborted = true; };
			req.end = () => {}; // never responds
			return req;
		} },
		setTimeout: (cb) => { fire = cb; return 1; },
		clearTimeout: () => {}
	});
	fire(); // simulate the timeout elapsing
	await assert.rejects(p, /Timed out/);
	assert.strictEqual(aborted, true);
});

test('httpGet settles once: a timeout after a successful response is a no-op', async () => {
	let fire;
	const p = httpGet('https://x', {}, {
		net: fakeNet((req) => respond(req, { status: 200, body: 'ok' })),
		setTimeout: (cb) => { fire = cb; return 1; },
		clearTimeout: () => {}
	});
	const res = await p;
	assert.strictEqual(res.body, 'ok');
	// The promise is already resolved; firing the timer must not throw or change it.
	assert.doesNotThrow(() => fire());
});

// --- fetchLinkedPrs completeness (Copilot #136 #3) -----------------------

const CITE = (id) => `Trac: https://core.trac.wordpress.org/ticket/${id}`;

test('fetchLinkedPrs returns ok with the citing PRs when the result is complete', async () => {
	const body = JSON.stringify({
		total_count: 1,
		incomplete_results: false,
		items: [{ number: 42, pull_request: { url: 'x' }, title: 'Fix', state: 'open', updated_at: '2026-01-01T00:00:00Z', html_url: 'u', body: CITE(123) }]
	});
	const res = await fetchLinkedPrs('123', { httpGet: async () => ({ status: 200, headers: {}, body }) });
	assert.strictEqual(res.status, 'ok');
	assert.strictEqual(res.items.length, 1);
	assert.strictEqual(res.items[0].number, 42);
});

test('fetchLinkedPrs refuses to cache a truncated result, so the cache is used instead', async () => {
	// total_count exceeds what one page returned: the linked PR could be one we
	// did not receive, so this must not be reported (or cached) as complete.
	const body = JSON.stringify({ total_count: 150, incomplete_results: true, items: [{ number: 1, pull_request: {}, body: CITE(123) }] });
	const res = await fetchLinkedPrs('123', { httpGet: async () => ({ status: 200, headers: {}, body }) });
	assert.strictEqual(res.status, 'error');
	assert.deepStrictEqual(res.items, []);
});

test('fetchLinkedPrs treats total_count beyond the page as incomplete even without the flag', async () => {
	const body = JSON.stringify({ total_count: 101, incomplete_results: false, items: [{ number: 1, pull_request: {}, body: CITE(123) }] });
	const res = await fetchLinkedPrs('123', { httpGet: async () => ({ status: 200, headers: {}, body }) });
	assert.strictEqual(res.status, 'error');
});

test('fetchLinkedPrs maps a rate-limited status through classifyHttpFailure', async () => {
	const res = await fetchLinkedPrs('123', { httpGet: async () => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: '' }) });
	assert.strictEqual(res.status, 'rate-limited');
});

test('fetchLinkedPrs reports offline on a transport failure rather than empty', async () => {
	const res = await fetchLinkedPrs('123', { httpGet: async () => { throw new Error('no network'); } });
	assert.strictEqual(res.status, 'offline');
	assert.deepStrictEqual(res.items, []);
});
