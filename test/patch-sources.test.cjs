'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { bodyCitesTicket, bodyCitesIssue, citesWorkItemFor, parseLinkedPrs, classifyHttpFailure } = require('../src/patch-sources.cjs');

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

// --- GitHub-issue work items (#251) ---------------------------------------
//
// A Gutenberg pull request has no Trac URL to cite: it references its issue the
// GitHub way. The verification still has to be narrow, because the search that
// feeds it matches the bare number anywhere in the text.

test('bodyCitesIssue: a #-prefixed reference counts', () => {
	assert.strictEqual(bodyCitesIssue('Fixes #1234, at last.', 1234), true);
	assert.strictEqual(bodyCitesIssue('Closes #1234', 1234), true);
	assert.strictEqual(bodyCitesIssue('see #1234.', '1234'), true);
});

// The guard that makes the check trustworthy rather than merely plausible.
test('bodyCitesIssue: a longer number is not a match for its prefix', () => {
	assert.strictEqual(bodyCitesIssue('Fixes #12345', 1234), false);
	assert.strictEqual(bodyCitesIssue('Fixes #1234', 12345), false);
});

// A bare number is exactly the prose match the verification exists to reject:
// GitHub's search tokeniser finds "1234" in unrelated sentences.
test('bodyCitesIssue: a bare number without # does not count', () => {
	assert.strictEqual(bodyCitesIssue('This fixes 1234 rendering bugs.', 1234), false);
});

test('bodyCitesIssue: the issue URL counts when the repo is known', () => {
	const body = 'Fixes https://github.com/WordPress/gutenberg/issues/1234';
	assert.strictEqual(bodyCitesIssue(body, 1234, 'WordPress/gutenberg'), true);
	// Without a repo the URL form cannot be checked, but the #-form in it can't
	// be faked either — a URL alone with no `#1234` is not a match.
	assert.strictEqual(bodyCitesIssue(body, 1234), false);
});

test('bodyCitesIssue: non-string bodies and empty ids are rejected', () => {
	assert.strictEqual(bodyCitesIssue(null, 1234), false);
	assert.strictEqual(bodyCitesIssue('#1234', ''), false);
});

test('citesWorkItemFor: picks the provider’s test, defaulting to Trac', () => {
	const trac = citesWorkItemFor('trac');
	assert.strictEqual(trac, bodyCitesTicket);
	assert.strictEqual(citesWorkItemFor(undefined), bodyCitesTicket, 'an unknown provider is Core’s');

	const gh = citesWorkItemFor('github-issue', 'WordPress/gutenberg');
	assert.strictEqual(gh('Fixes #1234', 1234), true);
	// And it does NOT accept the Trac form, which would be a different project.
	assert.strictEqual(gh('core.trac.wordpress.org/ticket/1234', 1234), false);
});

// The whole point of threading `cites` through: a Gutenberg search result is
// filtered by the GitHub convention, not by a Trac URL that will never be there.
test('parseLinkedPrs: uses the supplied citation test', () => {
	const json = { items: [item(11, { body: 'Fixes #1234' }), item(12, { body: 'unrelated' })] };
	const cites = citesWorkItemFor('github-issue', 'WordPress/gutenberg');

	const prs = parseLinkedPrs(json, 1234, { cites, repoPath: 'WordPress/gutenberg' });
	assert.deepStrictEqual(prs.map((p) => p.number), [11]);
});

// The repo guard is what stops a diff from the wrong project being applied to a
// checkout it cannot fit — so it moves with the site, it does not go away.
test('parsePrRef: a Gutenberg site accepts gutenberg PRs and rejects Core ones', () => {
	const opts = { repoPath: 'WordPress/gutenberg' };

	const ok = parsePrRef('https://github.com/WordPress/gutenberg/pull/4496', opts);
	assert.strictEqual(ok.ok, true);
	assert.strictEqual(ok.number, 4496);

	const wrong = parsePrRef('https://github.com/WordPress/wordpress-develop/pull/7319', opts);
	assert.strictEqual(wrong.ok, false);
	assert.match(wrong.error, /WordPress\/gutenberg/);

	// A bare number is still just a number — it names no repo to disagree with.
	assert.deepStrictEqual(parsePrRef('#4496', opts), { ok: true, number: 4496 });
});
