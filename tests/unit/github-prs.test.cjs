'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { httpGet, fetchLinkedPrs, MAX_COMMIT_LOOKUPS } = require('../../src/github-prs');
const { pickLatest } = require('../../src/latest-patch.cjs');

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

const searchItem = (number, updatedAt) => ({
	number,
	pull_request: { url: 'x' },
	title: `PR ${number}`,
	state: 'open',
	updated_at: updatedAt,
	html_url: `https://github.com/WordPress/wordpress-develop/pull/${number}`,
	body: CITE(123)
});

/**
 * An httpGet that answers the search once and each `pulls/N/commits` from a
 * table, recording every URL it was asked for. The request count is the point
 * of most of the tests below: this feature spends a shared 60/hour quota, so
 * "does it get the right answer" and "how many requests did that take" are the
 * same question.
 *
 * @param {Array}  items     `search/issues` items the one search request answers with.
 * @param {Object} [commits] PR number → an array of commit dates, or a function
 *                           of the URL for the pagination and failure cases.
 * @return {Object}
 */
function ghDouble(items, commits = {}) {
	const calls = [];
	const searchBody = JSON.stringify({ total_count: items.length, incomplete_results: false, items });
	const httpGetImpl = async (url) => {
		calls.push(url);
		if (url.includes('/search/issues')) return { status: 200, headers: {}, body: searchBody };
		const n = Number(/\/pulls\/(\d+)\/commits/.exec(url)[1]);
		const entry = commits[n];
		if (typeof entry === 'function') return entry(url);
		const dates = Array.isArray(entry) ? entry : [];
		return { status: 200, headers: {}, body: JSON.stringify(dates.map((d) => ({ commit: { committer: { date: d } } }))) };
	};
	return { httpGet: httpGetImpl, calls, commitCalls: () => calls.filter((u) => u.includes('/commits')) };
}

test('fetchLinkedPrs returns ok with the citing PRs when the result is complete', async () => {
	const gh = ghDouble([searchItem(42, '2026-01-01T00:00:00Z')], { 42: ['2025-12-30T10:00:00Z'] });
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(res.status, 'ok');
	assert.strictEqual(res.items.length, 1);
	assert.strictEqual(res.items[0].number, 42);
	assert.strictEqual(res.items[0].commitDate, '2025-12-30T10:00:00Z');
	assert.strictEqual(res.rankComplete, true);
	assert.strictEqual(gh.commitCalls().length, 1, 'one PR, one lookup');
});

// --- ranking by commit date (issue #281) ---------------------------------

// The bug, in the shape it actually shipped: an upstream force-push restamped
// both PRs 19 seconds apart, so updatedAt crowned the November 2024 patch that
// no longer applies over the April 2026 one that does.
test('fetchLinkedPrs ranks by newest commit, not by an upstream force-push stamp (issue #281)', async () => {
	const gh = ghDouble(
		[searchItem(7382, '2026-07-06T03:10:47Z'), searchItem(8455, '2026-07-06T03:10:28Z')],
		{ 7382: ['2024-11-19T09:00:00Z'], 8455: ['2026-01-02T08:00:00Z', '2026-04-12T11:30:00Z'] }
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.deepStrictEqual(res.items.map((p) => p.number), [8455, 7382]);
	assert.strictEqual(res.items[0].commitDate, '2026-04-12T11:30:00Z', 'newest commit on the PR, not its first');
	assert.strictEqual(res.rankComplete, true);
});

// The saving that makes the extra requests affordable: updatedAt is never
// earlier than the last commit, so it bounds every row below.
test('fetchLinkedPrs stops looking up once no remaining PR can win (issue #281)', async () => {
	const gh = ghDouble(
		[searchItem(1, '2026-08-01T00:00:00Z'), searchItem(2, '2026-02-01T00:00:00Z'), searchItem(3, '2026-01-01T00:00:00Z')],
		{ 1: ['2026-07-01T00:00:00Z'], 2: ['2026-01-15T00:00:00Z'], 3: ['2025-01-01T00:00:00Z'] }
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, 1, 'PR 1 beats the bound on PR 2, so 2 and 3 are never fetched');
	assert.strictEqual(res.rankComplete, true, 'the tail was ruled out, not merely unread');
	assert.deepStrictEqual(res.items.map((p) => p.number), [1, 2, 3]);
});

test('fetchLinkedPrs stops at the lookup cap and says the ranking is incomplete (issue #281)', async () => {
	// Every bound identical — a force-push sweep — so the walk cannot rule
	// anything out and would otherwise fetch the lot.
	const stamp = '2026-07-06T03:10:00Z';
	const numbers = [1, 2, 3, 4, 5, 6];
	const commits = {};
	for (const n of numbers) commits[n] = [`2026-0${n}-01T00:00:00Z`];
	const gh = ghDouble(numbers.map((n) => searchItem(n, stamp)), commits);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, MAX_COMMIT_LOOKUPS);
	assert.strictEqual(res.rankComplete, false);
});

test('fetchLinkedPrs stops looking up after a failed lookup rather than spending the rest (issue #281)', async () => {
	const stamp = '2026-07-06T03:10:00Z';
	const gh = ghDouble(
		[searchItem(1, stamp), searchItem(2, stamp), searchItem(3, stamp)],
		{
			1: ['2026-01-01T00:00:00Z'],
			2: () => ({ status: 403, headers: { 'x-ratelimit-remaining': '0' }, body: '' }),
			3: ['2026-06-01T00:00:00Z']
		}
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, 2, 'PR 3 is not attempted against a spent quota');
	assert.strictEqual(res.rankComplete, false);
	// The list itself still came back — a ranking we could not finish is not a
	// reason to hide the work that exists.
	assert.strictEqual(res.status, 'ok');
	assert.strictEqual(res.items.length, 3);
});

test('fetchLinkedPrs follows Link rel="last" once for a long PR, and takes the newest there (issue #281)', async () => {
	const gh = ghDouble([searchItem(9, '2026-08-01T00:00:00Z')], {
		9: (url) => (url.includes('page=3')
			? { status: 200, headers: {}, body: JSON.stringify([{ commit: { committer: { date: '2026-07-30T12:00:00Z' } } }]) }
			: {
				status: 200,
				headers: { link: '<https://api.github.com/repos/WordPress/wordpress-develop/pulls/9/commits?per_page=100&page=3>; rel="last"' },
				body: JSON.stringify([{ commit: { committer: { date: '2024-01-01T00:00:00Z' } } }])
			})
	});
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, 2, 'the last page, not a walk through the middle');
	assert.strictEqual(res.items[0].commitDate, '2026-07-30T12:00:00Z');
});

// The failure the cache reuse exists to prevent: `search/issues` and the core
// API have separate unauthenticated allowances, so "the search works, the
// commit lookups are 403" is the ordinary state on a shared Contributor Day IP.
// Without reuse, that Refresh would replace a ranking the contributor could
// already read with an unranked list — the failed request destroying the
// evidence rather than merely failing to add to it.
test('fetchLinkedPrs reuses cached commit dates, so a spent quota cannot downgrade a ranking (issue #281)', async () => {
	const known = [
		{ number: 7382, updatedAt: '2026-07-06T03:10:47Z', commitDate: '2024-11-19T09:00:00Z' },
		{ number: 8455, updatedAt: '2026-07-06T03:10:28Z', commitDate: '2026-04-12T11:30:00Z' }
	];
	const gh = ghDouble(
		[searchItem(7382, '2026-07-06T03:10:47Z'), searchItem(8455, '2026-07-06T03:10:28Z')],
		{ 7382: () => { throw new Error('must not be fetched'); }, 8455: () => { throw new Error('must not be fetched'); } }
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet, known });
	assert.strictEqual(gh.commitCalls().length, 0, 'nothing moved, so nothing is re-fetched');
	assert.strictEqual(res.rankComplete, true);
	assert.deepStrictEqual(res.items.map((p) => p.number), [8455, 7382]);
});

test('fetchLinkedPrs re-fetches a PR whose updatedAt moved since it was cached (issue #281)', async () => {
	// A push moves `updated_at`, so a changed stamp is the signal that the
	// cached commit date may be stale. It is only a signal in one direction —
	// a comment moves it too — so this costs a request it sometimes did not
	// need to, which is the safe side of that trade.
	const known = [{ number: 42, updatedAt: '2026-01-01T00:00:00Z', commitDate: '2025-12-30T10:00:00Z' }];
	const gh = ghDouble([searchItem(42, '2026-08-01T00:00:00Z')], { 42: ['2026-07-31T10:00:00Z'] });
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet, known });
	assert.strictEqual(gh.commitCalls().length, 1);
	assert.strictEqual(res.items[0].commitDate, '2026-07-31T10:00:00Z');
});

// A commit date is written by whoever made the commit, so it can be ahead of
// now. Left alone it would be the worst possible input to the walk: as the
// running best it clears every remaining bound at once, ending the walk and
// declaring the ranking complete on the strength of the one date that is wrong.
test('fetchLinkedPrs discards a commit dated in the future rather than crowning it (issue #281)', async () => {
	const future = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
	const stamp = '2026-07-06T03:10:00Z';
	const gh = ghDouble(
		[searchItem(1, stamp), searchItem(2, stamp)],
		{ 1: [future], 2: ['2026-04-12T11:30:00Z'] }
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, 2, 'the bad date must not end the walk');
	const byNumber = Object.fromEntries(res.items.map((p) => [p.number, p.commitDate]));
	assert.strictEqual(byNumber[1], null, 'a date ahead of now is not a date');
	assert.strictEqual(byNumber[2], '2026-04-12T11:30:00Z');
});

// --- the seam: what the walk produces, fed to what decides the pill ---------
//
// Both halves were green in isolation while the feature was broken between
// them: the walk correctly reported a complete ranking with rows left undated,
// and pickLatest correctly refused to rank a list with undated rows. Nothing
// drove one into the other, so the headline behaviour — a pill on the ticket
// this issue is about — was the one thing untested. These run the real modules
// end to end, no doubles beyond the network.

test('the pill lands on the winner of a one-lookup ticket (issue #281)', async () => {
	// The cheap path the bound exists to produce: PR 8455 is fetched, its commit
	// date is already past PR 7382's stamp, so 7382 is never fetched and stays
	// undated. That must not cost the ticket its pill.
	const gh = ghDouble(
		[searchItem(8455, '2026-07-20T00:00:00Z'), searchItem(7382, '2024-11-19T00:00:00Z')],
		{ 8455: ['2026-07-19T00:00:00Z'] }
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, 1);

	const latest = pickLatest({ prs: res.items, prRankComplete: res.rankComplete });
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 8455 });
});

test('the pill is withheld when the sweep left the ranking unfinished (issue #281)', async () => {
	// #62064's shape widened past the cap: every stamp identical, so no row can
	// be ruled out and the rows past the cap are genuinely unknown.
	const stamp = '2026-07-06T03:10:00Z';
	const numbers = [1, 2, 3, 4, 5, 6];
	const commits = {};
	for (const n of numbers) commits[n] = [`2026-0${n}-01T00:00:00Z`];
	const gh = ghDouble(numbers.map((n) => searchItem(n, stamp)), commits);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });

	assert.strictEqual(res.rankComplete, false);
	assert.strictEqual(pickLatest({ prs: res.items, prRankComplete: res.rankComplete }), null);
});

test('the pill survives a Refresh that could not reach GitHub at all (issue #281)', async () => {
	// The spent-quota Refresh: the search answers from cache-backed reuse, every
	// commit lookup would fail, and the contributor keeps the pill they had.
	const known = [
		{ number: 8455, updatedAt: '2026-07-20T00:00:00Z', commitDate: '2026-07-19T00:00:00Z' },
		{ number: 7382, updatedAt: '2024-11-19T00:00:00Z', commitDate: '2024-11-19T00:00:00Z' }
	];
	const gh = ghDouble(
		[searchItem(8455, '2026-07-20T00:00:00Z'), searchItem(7382, '2024-11-19T00:00:00Z')],
		{ 8455: () => { throw new Error('quota'); }, 7382: () => { throw new Error('quota'); } }
	);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet, known });
	const latest = pickLatest({ prs: res.items, prRankComplete: res.rankComplete });
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 8455 });
});

test('a paginated PR cannot push the walk past the request cap (issue #281)', async () => {
	// Every row paginated and every stamp identical: without the cap check on
	// the second page, four admitted rows would spend eight requests.
	const stamp = '2026-07-06T03:10:00Z';
	const numbers = [1, 2, 3, 4, 5, 6];
	const commits = {};
	for (const n of numbers) {
		commits[n] = (url) => (url.includes('page=2')
			? { status: 200, headers: {}, body: JSON.stringify([{ commit: { committer: { date: `2026-0${n}-01T00:00:00Z` } } }]) }
			: {
				status: 200,
				headers: { link: `<https://api.github.com/repos/WordPress/wordpress-develop/pulls/${n}/commits?per_page=100&page=2>; rel="last"` },
				body: JSON.stringify([{ commit: { committer: { date: '2020-01-01T00:00:00Z' } } }])
			});
	}
	const gh = ghDouble(numbers.map((n) => searchItem(n, stamp)), commits);
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(gh.commitCalls().length, MAX_COMMIT_LOOKUPS, 'the cap counts requests, and pagination spends two');
	assert.strictEqual(res.rankComplete, false);
});

test('fetchLinkedPrs falls back to the author date when a commit has no committer date (issue #281)', async () => {
	const gh = ghDouble([searchItem(4, '2026-08-01T00:00:00Z')], {
		4: () => ({ status: 200, headers: {}, body: JSON.stringify([{ commit: { author: { date: '2026-05-05T00:00:00Z' } } }]) })
	});
	const res = await fetchLinkedPrs('123', { httpGet: gh.httpGet });
	assert.strictEqual(res.items[0].commitDate, '2026-05-05T00:00:00Z');
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
