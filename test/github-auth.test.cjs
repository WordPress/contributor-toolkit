'use strict';

// The device flow (#167), every state of it.
//
// The polling loop is where this feature is most likely to be quietly wrong:
// four of GitHub's five documented answers are indistinguishable from each
// other at a glance, they arrive minutes apart in real use, and getting one of
// them wrong shows up as an app that hangs on a code the contributor has
// already entered. So each one is driven here, without a network and without a
// real wait — `post` and `sleep` are injected for exactly that.

const test = require('node:test');
const assert = require('node:assert');
const { requestDeviceCode, pollForToken, fetchViewer, getClientId } = require('../src/github-auth.cjs');

const CLIENT_ID = 'Ov23liTEST';

// Answers the given responses in order, recording what it was asked. A queue
// rather than a function of the request, because what matters in a poll is the
// sequence: pending, pending, then granted.
function replies(...queued) {
	const calls = [];
	const fn = async (url, payload) => {
		calls.push({ url, payload });
		const next = queued.length > 1 ? queued.shift() : queued[0];
		if (next instanceof Error) throw next;
		return { status: next.status || 200, headers: {}, body: '', json: next.json === undefined ? next : next.json };
	};
	fn.calls = calls;
	return fn;
}

// Records the waits instead of taking them, so `slow_down` is observable.
function fakeSleep() {
	const waited = [];
	const fn = async (ms) => { waited.push(ms); };
	fn.waited = waited;
	return fn;
}

test('getClientId prefers the environment, so a second application needs no rebuild', () => {
	const original = process.env.WP_DEV_ENV_GITHUB_CLIENT_ID;
	try {
		process.env.WP_DEV_ENV_GITHUB_CLIENT_ID = 'Ov23liFROMENV';
		assert.strictEqual(getClientId(), 'Ov23liFROMENV');
		process.env.WP_DEV_ENV_GITHUB_CLIENT_ID = '   ';
		// Blank is not a configuration, and treating it as one would ship a
		// request with an empty client_id and a 404 nobody could explain.
		assert.notStrictEqual(getClientId(), '   ');
	} finally {
		if (original === undefined) delete process.env.WP_DEV_ENV_GITHUB_CLIENT_ID;
		else process.env.WP_DEV_ENV_GITHUB_CLIENT_ID = original;
	}
});

test('requestDeviceCode returns the code, the page, and an absolute expiry', async () => {
	const post = replies({
		device_code: 'dev-code',
		user_code: 'WDJB-MJHT',
		verification_uri: 'https://github.com/login/device',
		expires_in: 900,
		interval: 5
	});

	const res = await requestDeviceCode({ post, clientId: CLIENT_ID, now: () => 1000 });

	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.userCode, 'WDJB-MJHT');
	assert.strictEqual(res.deviceCode, 'dev-code');
	assert.strictEqual(res.interval, 5);
	// GitHub sends a duration; every later comparison wants an instant.
	assert.strictEqual(res.expiresAt, 1000 + 900 * 1000);
	assert.strictEqual(post.calls[0].payload.client_id, CLIENT_ID);
	assert.strictEqual(post.calls[0].payload.scope, 'public_repo');
});

// The build shipping without a client ID and the application not having device
// flow enabled are the same symptom — nothing works — and neither is a network
// failure. Both are named so the panel can say which.
test('requestDeviceCode names an unconfigured build and an unconfigured application', async () => {
	const noId = await requestDeviceCode({ post: replies({}), clientId: '' });
	assert.strictEqual(noId.ok, false);
	assert.strictEqual(noId.reason, 'not-configured');

	const notEnabled = await requestDeviceCode({ post: replies({ status: 404, json: {} }), clientId: CLIENT_ID });
	assert.strictEqual(notEnabled.ok, false);
	assert.strictEqual(notEnabled.reason, 'not-configured');
	assert.match(notEnabled.error, /device flow/);
});

test('requestDeviceCode reports a transport failure as offline, not as a refusal', async () => {
	const res = await requestDeviceCode({ post: replies(new Error('ENOTFOUND')), clientId: CLIENT_ID });
	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.reason, 'offline');
});

test('pollForToken waits through authorization_pending and returns the token', async () => {
	const post = replies(
		{ error: 'authorization_pending' },
		{ error: 'authorization_pending' },
		{ access_token: 'gho_test' }
	);
	const sleep = fakeSleep();

	const res = await pollForToken(
		{ deviceCode: 'dev-code', interval: 5, expiresAt: 10_000 },
		{ post, sleep, now: () => 0, clientId: CLIENT_ID }
	);

	assert.deepStrictEqual(res, { ok: true, token: 'gho_test' });
	assert.deepStrictEqual(sleep.waited, [5000, 5000, 5000]);
	assert.strictEqual(post.calls[0].payload.grant_type, 'urn:ietf:params:oauth:grant-type:device_code');
	assert.strictEqual(post.calls[0].payload.device_code, 'dev-code');
});

// Polling faster than GitHub asks gets the device code rejected outright, so
// the bump is not politeness — ignoring it breaks the sign-in it is trying to
// complete.
test('pollForToken slows down when told to, taking GitHub’s own interval when it sends one', async () => {
	const withInterval = fakeSleep();
	await pollForToken(
		{ deviceCode: 'd', interval: 5, expiresAt: 10_000 },
		{ post: replies({ error: 'slow_down', interval: 12 }, { access_token: 't' }), sleep: withInterval, now: () => 0 }
	);
	assert.deepStrictEqual(withInterval.waited, [5000, 12_000]);

	const withoutInterval = fakeSleep();
	await pollForToken(
		{ deviceCode: 'd', interval: 5, expiresAt: 10_000 },
		{ post: replies({ error: 'slow_down' }, { access_token: 't' }), sleep: withoutInterval, now: () => 0 }
	);
	assert.deepStrictEqual(withoutInterval.waited, [5000, 10_000]);
});

test('pollForToken tells declining, expiry and an unknown failure apart', async () => {
	const cases = [
		[{ error: 'access_denied' }, 'denied'],
		[{ error: 'expired_token' }, 'expired'],
		[{ error: 'incorrect_device_code', error_description: 'nope' }, 'error']
	];
	for (const [answer, reason] of cases) {
		const res = await pollForToken(
			{ deviceCode: 'd', interval: 1, expiresAt: 10_000 },
			{ post: replies(answer), sleep: fakeSleep(), now: () => 0 }
		);
		assert.strictEqual(res.ok, false);
		assert.strictEqual(res.reason, reason, JSON.stringify(answer));
	}
});

// A code that runs out while the contributor is still looking for the browser
// window is the ordinary case, not an edge one, and it has to end the loop:
// GitHub keeps answering, so nothing else would.
test('pollForToken stops when the code has expired, without polling again', async () => {
	const post = replies({ error: 'authorization_pending' });
	let clock = 0;

	const res = await pollForToken(
		{ deviceCode: 'd', interval: 5, expiresAt: 4000 },
		{ post, sleep: async () => { clock += 5000; }, now: () => clock }
	);

	assert.strictEqual(res.reason, 'expired');
	assert.strictEqual(post.calls.length, 0, 'the expiry was checked after the wait, before spending a request');
});

test('pollForToken gives up as soon as the sign-in is canceled', async () => {
	const post = replies({ error: 'authorization_pending' });
	let canceled = false;

	const res = await pollForToken(
		{ deviceCode: 'd', interval: 5, expiresAt: 10_000 },
		{ post, sleep: async () => { canceled = true; }, now: () => 0, isCanceled: () => canceled }
	);

	assert.strictEqual(res.reason, 'canceled');
	assert.strictEqual(post.calls.length, 0);
});

// Losing the network mid-poll is not a decision the contributor made, and the
// authorization on GitHub's side is still perfectly valid.
test('pollForToken reports a dropped connection as offline', async () => {
	const res = await pollForToken(
		{ deviceCode: 'd', interval: 1, expiresAt: 10_000 },
		{ post: replies(new Error('ECONNRESET')), sleep: fakeSleep(), now: () => 0 }
	);
	assert.strictEqual(res.reason, 'offline');
});

test('fetchViewer returns the login, and calls a rejected token unauthorized', async () => {
	const ok = await fetchViewer('gho_test', { get: async () => ({ status: 200, json: { login: 'janedoe' } }) });
	assert.deepStrictEqual(ok, { ok: true, login: 'janedoe' });

	const revoked = await fetchViewer('gho_test', { get: async () => ({ status: 401, json: {} }) });
	assert.strictEqual(revoked.reason, 'unauthorized');
});

// The bug found by hand: a device-flow sign-in against an app the account
// authorized before can reuse the old grant with the old scopes. The token
// then signs in fine, uploads blobs and the commit fine — the Git object
// endpoints accept it — and 404s on the branch, the very last write. What
// GitHub actually granted is in the X-OAuth-Scopes header, so a token that
// cannot push is named at sign-in, with the remedy, instead of at the end.
test('fetchViewer refuses a token whose granted scopes cannot push', async () => {
	const viewer = (scopes) => fetchViewer('gho_test', {
		get: async () => ({
			status: 200,
			headers: scopes === undefined ? {} : { 'x-oauth-scopes': scopes },
			json: { login: 'janedoe' }
		})
	});

	// A reused grant with no scopes, and one with only unrelated scopes.
	assert.strictEqual((await viewer('')).reason, 'insufficient-scope');
	assert.strictEqual((await viewer('gist, read:org')).reason, 'insufficient-scope');
	assert.match((await viewer('')).error, /sign in here again/i);

	// Either granted scope that can push passes; `repo` contains `public_repo`.
	assert.strictEqual((await viewer('public_repo')).ok, true);
	assert.strictEqual((await viewer('repo, gist')).ok, true);

	// No header is no evidence — some token types omit it entirely.
	assert.strictEqual((await viewer(undefined)).ok, true);
});
