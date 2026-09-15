'use strict';

/**
 * Turning a GitHub search response into the pull requests that actually belong
 * to a Trac ticket (issue #109 / #11).
 *
 * On the busiest tickets the real work is a wordpress-develop PR, not a Trac
 * attachment — the attachment list is empty precisely where activity is
 * highest. Core's Trac↔GitHub convention is that a PR cites its ticket in the
 * body ("Trac ticket: https://core.trac.wordpress.org/ticket/NNNNN"), so the
 * search is: ask GitHub broadly for PRs mentioning the number, then verify
 * narrowly, here, that each one cites this ticket's URL. GitHub's search
 * tokeniser matches the bare number in comments and unrelated text, so the
 * verification is what makes the list trustworthy rather than merely plausible.
 *
 * A Gutenberg site (#251) asks the same two questions of `WordPress/gutenberg`,
 * where the convention is GitHub's own: a pull request cites the issue it is
 * for with a closing keyword ("Fixes #71234") or the issue's URL. The
 * verification is chosen per work-item kind (`citesWorkItemFor`); the search,
 * the states and the ordering are the same for both.
 *
 * Kept pure and dependency-free so the verification and the failure
 * classification — the parts that decide whether the UI shows work that exists
 * — are unit tested without a network: the main process requires it, and so
 * does `node --test` (same convention as git-update.cjs / patch-plan.cjs).
 */

const TICKET_HOST = 'core.trac.wordpress.org';
const PR_REPO_PATH = 'WordPress/wordpress-develop';

/**
 * Resolves what a contributor pastes into "apply a PR" to a pull request
 * number. Accepts a bare number or a PR URL on the site's own repository (with
 * any trailing `/files`, `#…`, `?…`). A PR from another repo is rejected by
 * name — its diff would not fit this checkout.
 *
 * @param {string} input
 * @param {Object} [options]
 * @param {string} [options.repoPath] `owner/repo` this site is a checkout of;
 *                                    wordpress-develop when absent.
 * @return {{ok: true, number: number}|{ok: false, error: string}}
 */
function parsePrRef(input, { repoPath = PR_REPO_PATH } = {}) {
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) return { ok: false, error: 'Enter a pull request URL or number.' };

	if (/^#?\d+$/.test(raw)) return { ok: true, number: Number(raw.replace('#', '')) };

	let parsed;
	try {
		parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
	} catch {
		return { ok: false, error: 'That is not a pull request URL or number.' };
	}
	if (parsed.hostname.toLowerCase() !== 'github.com') {
		return { ok: false, error: 'Only github.com pull requests are supported.' };
	}
	const match = /^\/([^/]+\/[^/]+)\/pull\/(\d+)(?:[/?#]|$)/.exec(parsed.pathname + (parsed.pathname.endsWith('/') ? '' : '/'));
	if (!match) return { ok: false, error: 'That does not look like a pull request URL.' };
	if (match[1].toLowerCase() !== String(repoPath).toLowerCase()) {
		return { ok: false, error: `Only ${repoPath} pull requests can be applied here.` };
	}
	return { ok: true, number: Number(match[2]) };
}

/**
 * True when a PR body cites this exact ticket. Current pull request templates
 * use the full Trac URL; older ones used a labelled bare number (#327), so that
 * explicitly labelled form counts too. An unlabelled number still does not:
 * GitHub search can surface it from unrelated prose or comments.
 *
 * The negative lookaheads stop either accepted form from matching a longer
 * ticket number that merely starts with the requested digits.
 *
 * @param {string}        body
 * @param {number|string} ticketId
 * @return {boolean}
 */
function bodyCitesTicket(body, ticketId) {
	if (typeof body !== 'string') return false;
	const id = String(ticketId).replace(/[^0-9]/g, '');
	if (!id) return false;
	const re = new RegExp(`${TICKET_HOST.replace(/\./g, '\\.')}/ticket/${id}(?![0-9])`);
	const labelledNumber = new RegExp(`(?:^|[\\r\\n])[ \\t]*Trac[ \\t]+ticket[ \\t]*:[ \\t]*#?${id}(?![0-9])`, 'i');
	return re.test(body) || labelledNumber.test(body);
}

/**
 * True when a PR body cites this exact GitHub issue, the way GitHub itself
 * links the two (#251): a closing keyword in front of `#N` or `owner/repo#N`
 * ("Fixes #71234", "Closes: WordPress/gutenberg#71234"), or the issue's full
 * URL. Those are the forms that make the pull request show under "linked pull
 * requests" on the issue, so the list here agrees with what GitHub shows. A
 * bare `#N` elsewhere in the body does not count, for the same reason an
 * unlabelled Trac number does not: the search surfaced it from prose.
 *
 * @param {string}        body
 * @param {number|string} issueId
 * @param {string}        [repoPath]
 * @return {boolean}
 */
function bodyCitesIssue(body, issueId, repoPath = PR_REPO_PATH) {
	if (typeof body !== 'string') return false;
	const id = String(issueId).replace(/[^0-9]/g, '');
	if (!id) return false;
	const repo = String(repoPath).replace(/[.\\/]/g, '\\$&');
	const url = new RegExp(`github\\.com/${repo}/issues/${id}(?![0-9])`, 'i');
	// GitHub's closing keywords, each in its three forms, then an optional
	// colon, then the reference. `(?<![0-9])` is not needed on the left: the
	// keyword is what precedes the digits.
	const closing = new RegExp(`\\b(?:close|closes|closed|fix|fixes|fixed|resolve|resolves|resolved)\\s*:?\\s*(?:${repo})?#${id}(?![0-9])`, 'i');
	return url.test(body) || closing.test(body);
}

/**
 * The verification a work-item kind uses (#251): what it means for a pull
 * request body to be *for* this ticket or issue. The Trac form is the default,
 * so a caller with no kind to hand behaves as it always did.
 *
 * @param {string} [provider] 'trac' or 'github-issue'.
 * @param {string} [repoPath] the repository whose issues are cited.
 * @return {function(string, (number|string)): boolean}
 */
function citesWorkItemFor(provider, repoPath = PR_REPO_PATH) {
	if (provider === 'github-issue') return (body, id) => bodyCitesIssue(body, id, repoPath);
	return bodyCitesTicket;
}

/**
 * What happened to one pull request, from a `search/issues` item: open, merged
 * or closed-unmerged.
 *
 * @param {Object} item
 * @return {'open'|'merged'|'closed'}
 */
function prState(item) {
	if (item.pull_request && item.pull_request.merged_at) return 'merged';
	return item.state === 'closed' ? 'closed' : 'open';
}

/**
 * Reduces a GitHub `search/issues` response to the PRs that cite the ticket.
 *
 * Returns sorted by `updatedAt` descending. That is deliberately *not* the
 * order shown to a contributor: `updatedAt` moves on a comment, a label or an
 * upstream force-push, so as a claim about freshness it is worthless (#281).
 * What it is worth is a bound — it never sits earlier than the last commit —
 * so this ordering is the one the commit-date walk in github-prs.js needs to
 * decide how few lookups it can get away with. The display order comes from
 * orderByCommitDate below, once those lookups have happened.
 *
 * @param {Object}        searchJson
 * @param {number|string} ticketId
 * @param {Object}        [options]
 * @param {Function}      [options.cites]    the verification, from `citesWorkItemFor`; Trac's when absent.
 * @param {string}        [options.repoPath] where a PR lives when the item carries no `html_url`.
 * @return {Array<{number: number, title: string, state: 'open'|'merged'|'closed', updatedAt: string, url: string}>}
 */
function parseLinkedPrs(searchJson, ticketId, { cites = bodyCitesTicket, repoPath = PR_REPO_PATH } = {}) {
	const items = searchJson && Array.isArray(searchJson.items) ? searchJson.items : [];
	const seen = new Set();
	const prs = [];
	for (const item of items) {
		// `search/issues` returns issues and PRs together; only PRs carry
		// `pull_request`.
		if (!item || !item.pull_request) continue;
		if (!cites(item.body, ticketId)) continue;
		if (seen.has(item.number)) continue;
		seen.add(item.number);
		prs.push({
			number: item.number,
			title: typeof item.title === 'string' ? item.title : '',
			// Merged is a third state, not a flavour of closed: `state` only ever
			// says open or closed, and the merge shows in `pull_request.merged_at`
			// — which this same search response already carries, so keeping the
			// distinction costs no second request against the shared
			// unauthenticated quota this file is careful with.
			state: prState(item),
			updatedAt: item.updated_at || item.created_at || '',
			url: item.html_url || `https://github.com/${repoPath}/pull/${item.number}`
		});
	}
	prs.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
	return prs;
}

/**
 * The order a contributor reads: newest code first (issue #281).
 *
 * Pull requests whose commit date was resolved come first, freshest first. The
 * rest follow in `updatedAt` order, which is not a claim about them — it is
 * simply better than an arbitrary shuffle.
 *
 * Worth being exact about what the tail does and does not mean, because the
 * walk that produced it stops on a bound: an unresolved row is known to be
 * older than the *newest* resolved one, which is what the "Latest" pill needs,
 * but not older than every resolved row above it. So a 2020 commit can sit
 * above an unresolved row whose real commit is last month. The pill is still
 * correct; the ordering below the top is a best effort, and the row's own date
 * — blank where it is unknown — is what a contributor should read rather than
 * the position.
 *
 * @param {Array} prs
 * @return {Array}
 */
function orderByCommitDate(prs) {
	const list = Array.isArray(prs) ? prs.slice() : [];
	const ms = (pr) => {
		const parsed = pr && typeof pr.commitDate === 'string' && pr.commitDate ? Date.parse(pr.commitDate) : NaN;
		return Number.isFinite(parsed) ? parsed : null;
	};
	list.sort((a, b) => {
		const x = ms(a);
		const y = ms(b);
		if (x !== null && y !== null) return y - x;
		if (x !== null) return -1;
		if (y !== null) return 1;
		return (b.updatedAt || '').localeCompare(a.updatedAt || '');
	});
	return list;
}

/**
 * Classifies a non-2xx GitHub response so the UI can tell "nothing on this
 * ticket" apart from "we could not read it". A rate-limited answer is not an
 * empty ticket: on a shared Contributor-Day IP the unauthenticated 60/hour is
 * spent quickly, and a short list shown as complete is the exact failure this
 * feature exists to prevent.
 *
 * @param {number} status
 * @param {Object} [headers] Lower-cased header map.
 * @return {'rate-limited'|'error'}
 */
function classifyHttpFailure(status, headers = {}) {
	const remaining = headers['x-ratelimit-remaining'];
	if (status === 429) return 'rate-limited';
	if ((status === 403 || status === 401) && String(remaining) === '0') return 'rate-limited';
	// GitHub's secondary (abuse) limit is a 403 with a Retry-After header while
	// the primary quota is not yet spent — the burst case on a shared IP.
	if (status === 403 && headers['retry-after'] !== undefined && headers['retry-after'] !== null) return 'rate-limited';
	return 'error';
}

module.exports = {
	TICKET_HOST,
	PR_REPO_PATH,
	bodyCitesTicket,
	bodyCitesIssue,
	citesWorkItemFor,
	parseLinkedPrs,
	orderByCommitDate,
	classifyHttpFailure,
	parsePrRef
};
