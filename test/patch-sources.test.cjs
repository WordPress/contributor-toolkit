'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { bodyCitesTicket, parseLinkedPrs, classifyHttpFailure } = require('../src/patch-sources.cjs');

// Shaped like a real search/issues item, trimmed to the fields the parser reads.
function item(number, overrides = {}) {
	return {
		number,
		title: `PR ${number}`,
		state: 'open',
		updated_at: '2026-08-01T00:00:00Z',
		html_url: `https://github.com/WordPress/wordpress-develop/pull/${number}`,
		pull_request: { url: 'x' },
		body: 'Trac ticket: https://core.trac.wordpress.org/ticket/62281',
		...overrides
	};
}

test('bodyCitesTicket: the full ticket URL counts, a bare number does not (issue #11)', () => {
	assert.strictEqual(bodyCitesTicket('see https://core.trac.wordpress.org/ticket/62281 for context', 62281), true);
	assert.strictEqual(bodyCitesTicket('this is about #62281 somewhere', 62281), false);
	assert.strictEqual(bodyCitesTicket('', 62281), false);
	assert.strictEqual(bodyCitesTicket(null, 62281), false);
});

// The precision bug the URL check exists to prevent: GitHub's tokeniser can
// surface a PR for a longer number that starts with the same digits.
test('bodyCitesTicket: a longer ticket number is not a match (issue #11)', () => {
	assert.strictEqual(bodyCitesTicket('https://core.trac.wordpress.org/ticket/658200', 65820), false);
	assert.strictEqual(bodyCitesTicket('https://core.trac.wordpress.org/ticket/65820', 65820), true);
	// A trailing slash or anchor still matches.
	assert.strictEqual(bodyCitesTicket('https://core.trac.wordpress.org/ticket/65820#comment:3', 65820), true);
});

test('parseLinkedPrs: keeps only PRs whose body cites the ticket (issue #11)', () => {
	const json = { items: [
		item(101),
		item(102, { body: 'unrelated work, mentions 62281 in passing only' }),
		item(103, { pull_request: undefined, body: 'Trac ticket: https://core.trac.wordpress.org/ticket/62281' })
	] };
	const prs = parseLinkedPrs(json, 62281);
	assert.deepStrictEqual(prs.map((p) => p.number), [101], 'only the verified PR survives; the issue and the passing mention drop');
});

test('parseLinkedPrs: newest first, and duplicates collapse (issue #11)', () => {
	const json = { items: [
		item(1, { updated_at: '2026-01-01T00:00:00Z' }),
		item(2, { updated_at: '2026-08-06T00:00:00Z' }),
		item(2, { updated_at: '2026-08-06T00:00:00Z' })
	] };
	const prs = parseLinkedPrs(json, 62281);
	assert.deepStrictEqual(prs.map((p) => p.number), [2, 1]);
});

test('parseLinkedPrs: a closed PR is marked closed, not dropped (issue #11)', () => {
	const prs = parseLinkedPrs({ items: [item(7, { state: 'closed' })] }, 62281);
	assert.strictEqual(prs[0].state, 'closed');
});

// The three states the row colours (#227). GitHub's `state` says only open or
// closed, so a merged PR arrives as closed and the merge is visible solely in
// `pull_request.merged_at` — collapsing it loses which of two very different
// outcomes the work reached.
test('parseLinkedPrs: a merged PR is merged, not closed (issue #227)', () => {
	const prs = parseLinkedPrs({
		items: [item(7, { state: 'closed', pull_request: { url: 'x', merged_at: '2026-08-02T00:00:00Z' } })]
	}, 62281);
	assert.strictEqual(prs[0].state, 'merged');
});

test('parseLinkedPrs: closed with nothing merged stays closed (issue #227)', () => {
	const prs = parseLinkedPrs({
		items: [item(7, { state: 'closed', pull_request: { url: 'x', merged_at: null } })]
	}, 62281);
	assert.strictEqual(prs[0].state, 'closed');
});

test('parseLinkedPrs: an open PR stays open (issue #227)', () => {
	const prs = parseLinkedPrs({
		items: [item(7, { state: 'open', pull_request: { url: 'x', merged_at: null } })]
	}, 62281);
	assert.strictEqual(prs[0].state, 'open');
});

test('parseLinkedPrs: an empty or malformed response yields an empty list, not a throw (issue #11)', () => {
	assert.deepStrictEqual(parseLinkedPrs({ items: [] }, 62281), []);
	assert.deepStrictEqual(parseLinkedPrs({}, 62281), []);
	assert.deepStrictEqual(parseLinkedPrs(null, 62281), []);
});

// The distinction the panel depends on: an exhausted rate limit must never read
// as "no patches on this ticket".
test('classifyHttpFailure: a spent rate limit is told apart from a plain error (issue #11)', () => {
	assert.strictEqual(classifyHttpFailure(403, { 'x-ratelimit-remaining': '0' }), 'rate-limited');
	assert.strictEqual(classifyHttpFailure(429, {}), 'rate-limited');
	assert.strictEqual(classifyHttpFailure(401, { 'x-ratelimit-remaining': '0' }), 'rate-limited');
	// GitHub's secondary/abuse limit: a 403 with Retry-After while the primary
	// quota is not yet spent — the burst case on a shared IP.
	assert.strictEqual(classifyHttpFailure(403, { 'x-ratelimit-remaining': '57', 'retry-after': '60' }), 'rate-limited');
	// A 403 that is not about any rate limit is a real error.
	assert.strictEqual(classifyHttpFailure(403, { 'x-ratelimit-remaining': '57' }), 'error');
	assert.strictEqual(classifyHttpFailure(500, {}), 'error');
	assert.strictEqual(classifyHttpFailure(404, {}), 'error');
});

const { parsePrRef } = require('../src/patch-sources.cjs');

test('parsePrRef: a bare number or #number resolves (issue #11)', () => {
	assert.deepStrictEqual(parsePrRef('4496'), { ok: true, number: 4496 });
	assert.deepStrictEqual(parsePrRef(' #4496 '), { ok: true, number: 4496 });
});

test('parsePrRef: a wordpress-develop PR URL resolves, with trailing bits (issue #11)', () => {
	assert.strictEqual(parsePrRef('https://github.com/WordPress/wordpress-develop/pull/4496').number, 4496);
	assert.strictEqual(parsePrRef('https://github.com/WordPress/wordpress-develop/pull/4496/files').number, 4496);
	assert.strictEqual(parsePrRef('https://github.com/WordPress/wordpress-develop/pull/4496#pullrequestreview-1').number, 4496);
	// Missing scheme, copied from the address bar.
	assert.strictEqual(parsePrRef('github.com/WordPress/wordpress-develop/pull/4496').number, 4496);
});

test('parsePrRef: a PR from another repo is rejected by name (issue #11)', () => {
	const res = parsePrRef('https://github.com/WordPress/gutenberg/pull/4496');
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /wordpress-develop/);
});

test('parsePrRef: non-PR and empty input are rejected with a reason (issue #11)', () => {
	assert.strictEqual(parsePrRef('').ok, false);
	assert.strictEqual(parsePrRef('   ').ok, false);
	assert.strictEqual(parsePrRef('https://github.com/WordPress/wordpress-develop/issues/4496').ok, false);
	assert.strictEqual(parsePrRef('https://example.com/pull/1').ok, false);
	assert.strictEqual(parsePrRef('not a url').ok, false);
});
