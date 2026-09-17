'use strict';

/**
 * Reading what a contributor typed when asked which GitHub issue they are
 * working on (#251) — the Gutenberg counterpart of trac-ticket.cjs.
 *
 * Same shape as the Trac parser on purpose: a contributor arrives from a
 * browser, so the input is as likely to be a pasted URL — with a comment
 * anchor, a trailing slash or a query still attached — as it is a bare `#1234`.
 * Keeping the two behind one interface is what lets the rest of the app ask
 * "which work item is this site on?" without knowing where the answer lives.
 *
 * Kept pure and dependency-free so it can be unit tested without a DOM: the
 * renderer bundle imports it and `node --test` requires it directly.
 */

const GITHUB_HOST = 'github.com';

// Gutenberg is in the 70,000s. Seven digits leaves decades of headroom while
// still rejecting a pasted timestamp — the same bound, and the same reasoning,
// as the Trac parser's.
const MAX_ISSUE_ID = 9999999;

/**
 * Canonical URL for an issue in a repository.
 *
 * @param {number|string} id
 * @param {string}        repoPath `owner/repo`.
 */
function issueUrl(id, repoPath) {
	return `https://${GITHUB_HOST}/${repoPath}/issues/${id}`;
}

/**
 * Resolves free-form input to an issue id. Accepts `1234`, `#1234` and an issue
 * URL for this site's own repository; rejects everything else with a message
 * meant for the contributor, not for a log.
 *
 * A pull-request URL is rejected by name rather than falling through to the
 * generic message: pasting the PR instead of the issue it fixes is the obvious
 * mistake here, and "that is a pull request" is the answer that unsticks it.
 *
 * @param {string} input
 * @param {Object} [options]
 * @param {string} [options.repoPath] `owner/repo` whose issues this site tracks.
 * @return {{ok: true, id: number, url: string}|{ok: false, error: string}}
 */
function parseIssueRef(input, { repoPath = 'WordPress/gutenberg' } = {}) {
	const notAnIssue = `Enter an issue number like 1234, or a ${repoPath} issue URL.`;
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) return { ok: false, error: 'Enter an issue number or URL.' };

	// Both branches below go through this, the way the Trac parser routes both of
	// its own through fromDigits. A URL's digits are no more trustworthy than a
	// typed one's: `/issues/0` would otherwise store a falsy id that every
	// `ticketId ? …` reads as "no work item" while the site sits on `ticket/0`,
	// and a 20-digit path would become a branch named after a float.
	const fromDigits = (digits) => {
		const id = Number(digits);
		if (!Number.isSafeInteger(id) || id < 1 || id > MAX_ISSUE_ID) {
			return { ok: false, error: notAnIssue };
		}
		return { ok: true, id, url: issueUrl(id, repoPath) };
	};

	const bare = raw.replace(/^#/, '');
	if (/^\d+$/.test(bare)) return fromDigits(bare);

	// Anything else has to be a URL. Accept it without a scheme too — copying a
	// host out of an address bar often drops it. But `new URL` is lenient
	// (`new URL('https://abc')` succeeds), so only take this branch when the
	// input actually looks like a URL; otherwise a bare word would be reported
	// as a wrong host rather than as not-an-issue.
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
	if (!hasScheme && !raw.includes('/') && !raw.includes('.')) {
		return { ok: false, error: notAnIssue };
	}

	let parsed;
	try {
		parsed = new URL(hasScheme ? raw : `https://${raw}`);
	} catch {
		return { ok: false, error: notAnIssue };
	}

	if (parsed.hostname.toLowerCase() !== GITHUB_HOST) {
		return { ok: false, error: `Only ${GITHUB_HOST} issues are supported.` };
	}

	// Reading the id off the path drops ?foo= and #issuecomment- for free.
	const match = /^\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)\/?$/.exec(parsed.pathname);
	if (!match) return { ok: false, error: notAnIssue };
	if (match[2] === 'pull') {
		return { ok: false, error: 'That is a pull request. Link the issue it fixes instead.' };
	}
	if (match[1].toLowerCase() !== String(repoPath).toLowerCase()) {
		return { ok: false, error: `Only ${repoPath} issues can be linked here.` };
	}
	return fromDigits(match[3]);
}

module.exports = {
	GITHUB_HOST,
	MAX_ISSUE_ID,
	issueUrl,
	parseIssueRef
};
