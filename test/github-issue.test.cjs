'use strict';

// The Gutenberg counterpart of trac-ticket.test.cjs (#251). A contributor
// arrives from a browser, so what they paste is as likely to be a URL — with an
// anchor, a query or a trailing slash still on it — as a bare `#1234`.

const test = require('node:test');
const assert = require('node:assert');
const { parseIssueRef, issueUrl } = require('../src/renderer/github-issue.cjs');

const GB = 'WordPress/gutenberg';

test('issueUrl builds the canonical issue address', () => {
	assert.strictEqual(issueUrl(71234, GB), 'https://github.com/WordPress/gutenberg/issues/71234');
});

test('parseIssueRef: a bare number, with or without the #', () => {
	assert.deepStrictEqual(parseIssueRef('71234'), { ok: true, id: 71234, url: issueUrl(71234, GB) });
	assert.deepStrictEqual(parseIssueRef('#71234'), { ok: true, id: 71234, url: issueUrl(71234, GB) });
	assert.deepStrictEqual(parseIssueRef('  71234  '), { ok: true, id: 71234, url: issueUrl(71234, GB) });
});

test('parseIssueRef: an issue URL, with the noise a copy-paste brings', () => {
	for (const input of [
		'https://github.com/WordPress/gutenberg/issues/71234',
		'https://github.com/WordPress/gutenberg/issues/71234/',
		'github.com/WordPress/gutenberg/issues/71234',
		'https://github.com/WordPress/gutenberg/issues/71234#issuecomment-123456',
		'https://github.com/WordPress/gutenberg/issues/71234?foo=bar'
	]) {
		const res = parseIssueRef(input);
		assert.strictEqual(res.ok, true, `${input}: ${res.error}`);
		assert.strictEqual(res.id, 71234, input);
	}
});

// Pasting the pull request instead of the issue it fixes is the obvious mistake
// here, so it gets an answer that unsticks it rather than the generic one.
test('parseIssueRef: a pull request URL is refused by name', () => {
	const res = parseIssueRef('https://github.com/WordPress/gutenberg/pull/4496');
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /pull request/i);
});

// The repo guard is what stops a site tracking an issue from another project,
// whose number would then be cited in a pull request that has nothing to do
// with it.
test('parseIssueRef: another repository’s issue is refused', () => {
	const res = parseIssueRef('https://github.com/WordPress/wordpress-develop/issues/1234');
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /WordPress\/gutenberg/);

	// And the guard moves with the site.
	const ok = parseIssueRef('https://github.com/WordPress/wordpress-develop/issues/1234', { repoPath: 'WordPress/wordpress-develop' });
	assert.strictEqual(ok.ok, true);
	assert.strictEqual(ok.id, 1234);
});

test('parseIssueRef: another host is refused', () => {
	const res = parseIssueRef('https://gitlab.com/WordPress/gutenberg/issues/1');
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /github\.com/);
});

test('parseIssueRef: empty and nonsense input are rejected with a reason', () => {
	assert.strictEqual(parseIssueRef('').ok, false);
	assert.strictEqual(parseIssueRef('   ').ok, false);
	assert.strictEqual(parseIssueRef(undefined).ok, false);
	// A bare word must read as not-an-issue, not as a wrong host: `new URL` is
	// lenient enough to accept `https://nonsense` as a valid hostname.
	const res = parseIssueRef('nonsense');
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /issue number/i);
});

test('parseIssueRef: zero and absurd numbers are rejected', () => {
	assert.strictEqual(parseIssueRef('0').ok, false);
	assert.strictEqual(parseIssueRef('99999999999').ok, false, 'a pasted timestamp is not an issue');
});

// The URL branch has to apply the same bounds as the typed one — it reads digits
// off a pasted address, which are no more trustworthy. Each of these parsed
// before the guard was shared:
//
//   /issues/0   → a falsy id, so the site sits on branch `ticket/0` while every
//                 `ticketId ? …` reads it as having no work item at all, and
//                 "open a pull request" refuses on a site that looks linked.
//   /issues/<20 digits> → Number() overflows to a float, and the branch is named
//                 after it (`fix/issue-100000000000000000000`).
//   /issues/012 → id 12, but a url still pointing at `/012`.
test('parseIssueRef: a URL’s number is bounds-checked like a typed one', () => {
	const url = (n) => `https://github.com/WordPress/gutenberg/issues/${n}`;

	assert.strictEqual(parseIssueRef(url(0)).ok, false, 'issue 0 is not a work item');
	assert.strictEqual(parseIssueRef(url('99999999999999999999')).ok, false, 'an overflowing number is not an issue');
	// A padded number resolves to the canonical id and a canonical URL.
	const padded = parseIssueRef(url('012'));
	assert.strictEqual(padded.ok, true);
	assert.strictEqual(padded.id, 12);
	assert.strictEqual(padded.url, url(12), 'the URL is rebuilt from the parsed id, not echoed back');
});
