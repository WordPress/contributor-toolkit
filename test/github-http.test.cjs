'use strict';

// The request primitive grew a method, a body and an Authorization header when
// opening a pull request needed one (#167). Its GET behaviour is already pinned
// by test/github-prs.test.cjs — the transport, timeout and settle-once paths —
// so what is here is only what POST added, plus the one property everything
// downstream leans on: a non-2xx status is data, never an exception.

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { httpRequest, postJson, getJson } = require('../src/github-http.cjs');

// A stand-in for Electron's `net`, recording what the request was told to be:
// the method and URL it was opened with, every header set on it, and everything
// written to its body.
function fakeNet(onEnd) {
	const sent = { headers: {}, written: [], options: null };
	return {
		sent,
		client: {
			request(options) {
				sent.options = options;
				const req = new EventEmitter();
				req.setHeader = (key, value) => { sent.headers[key] = value; };
				req.write = (chunk) => { sent.written.push(chunk); };
				req.abort = () => {};
				req.end = () => onEnd(req);
				return req;
			}
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

test('httpRequest sends the method, the body and an identifying User-Agent', async () => {
	const net = fakeNet((req) => respond(req, { status: 201, body: '{}' }));

	await httpRequest('POST', 'https://api.github.com/x', { Accept: 'application/json' }, {
		net: net.client,
		body: '{"a":1}'
	});

	assert.strictEqual(net.sent.options.method, 'POST');
	assert.strictEqual(net.sent.options.url, 'https://api.github.com/x');
	assert.deepStrictEqual(net.sent.written, ['{"a":1}']);
	assert.strictEqual(net.sent.headers.Accept, 'application/json');
	assert.match(net.sent.headers['User-Agent'], /WordPress-Contributor-Toolkit/);
});

// The header is what authorises every write in the pull request flow, and its
// absence is what keeps the anonymous reads anonymous — an unconditional header
// would send `Bearer undefined` on every one of them.
test('httpRequest sends Authorization only when there is a token', async () => {
	const withToken = fakeNet((req) => respond(req, { status: 200, body: '{}' }));
	await httpRequest('GET', 'https://api.github.com/user', {}, { net: withToken.client, token: 'gho_x' });
	assert.strictEqual(withToken.sent.headers.Authorization, 'Bearer gho_x');

	const without = fakeNet((req) => respond(req, { status: 200, body: '{}' }));
	await httpRequest('GET', 'https://api.github.com/user', {}, { net: without.client });
	assert.strictEqual('Authorization' in without.sent.headers, false);
});

// A redirect on a token-bearing request must fail closed rather than let
// Chromium's stack decide whether the Authorization header follows it to
// another host. Anonymous requests keep the default and follow normally.
test('httpRequest refuses redirects only when carrying a token', async () => {
	const withToken = fakeNet((req) => respond(req, { status: 200, body: '{}' }));
	await httpRequest('GET', 'https://api.github.com/user', {}, { net: withToken.client, token: 'gho_x' });
	assert.strictEqual(withToken.sent.options.redirect, 'error');

	const without = fakeNet((req) => respond(req, { status: 200, body: '{}' }));
	await httpRequest('GET', 'https://api.github.com/x', {}, { net: without.client });
	assert.strictEqual('redirect' in without.sent.options, false);
});

test('httpRequest writes no body when none was given', async () => {
	const net = fakeNet((req) => respond(req, { status: 204 }));
	await httpRequest('POST', 'https://api.github.com/x', {}, { net: net.client });
	assert.deepStrictEqual(net.sent.written, []);
});

test('postJson serialises the payload and parses the answer', async () => {
	const net = fakeNet((req) => respond(req, { status: 201, body: '{"sha":"abc"}' }));

	const res = await postJson('https://api.github.com/x', { message: 'hi' }, { net: net.client });

	assert.deepStrictEqual(net.sent.written, ['{"message":"hi"}']);
	assert.strictEqual(net.sent.headers['Content-Type'], 'application/json');
	assert.strictEqual(res.status, 201);
	assert.deepStrictEqual(res.json, { sha: 'abc' });
});

// A proxy's HTML error page, a truncated response, an empty 204: all of them
// reach a caller that is about to read `.json.something`. Surviving as null is
// what lets the status decide instead of a parse throwing past the failure
// classification.
test('postJson and getJson survive a body that is not JSON', async () => {
	const posted = await postJson('https://api.github.com/x', {}, {
		net: fakeNet((req) => respond(req, { status: 502, body: '<html>bad gateway</html>' })).client
	});
	assert.strictEqual(posted.status, 502);
	assert.strictEqual(posted.json, null);

	const got = await getJson('https://api.github.com/x', {
		net: fakeNet((req) => respond(req, { status: 204 })).client
	});
	assert.strictEqual(got.json, null);
});

// Every failure classification downstream reads a status, so a status that
// throws instead of returning would route a spent rate limit, a revoked token
// and a missing fork all into the same catch.
test('a non-2xx status resolves rather than throwing', async () => {
	const res = await postJson('https://api.github.com/x', {}, {
		net: fakeNet((req) => respond(req, { status: 403, headers: { 'Retry-After': '60' }, body: '{"message":"slow"}' })).client
	});
	assert.strictEqual(res.status, 403);
	assert.strictEqual(res.headers['retry-after'], '60');
	assert.deepStrictEqual(res.json, { message: 'slow' });
});
