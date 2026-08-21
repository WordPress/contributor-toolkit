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
 * Kept pure and dependency-free so the verification and the failure
 * classification — the parts that decide whether the UI shows work that exists
 * — are unit tested without a network: the main process requires it, and so
 * does `node --test` (same convention as git-update.cjs / patch-plan.cjs).
 */

const TICKET_HOST = 'core.trac.wordpress.org';
const PR_REPO_PATH = 'WordPress/wordpress-develop';

/**
 * Resolves what a contributor pastes into "apply a PR" to a pull request
 * number. Accepts a bare number or a wordpress-develop PR URL (with any
 * trailing `/files`, `#…`, `?…`). A PR from another repo is rejected by name —
 * its diff would not fit this checkout.
 *
 * @param {string} input
 * @return {{ok: true, number: number}|{ok: false, error: string}}
 */
function parsePrRef(input) {
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
	if (match[1].toLowerCase() !== PR_REPO_PATH.toLowerCase()) {
		return { ok: false, error: `Only ${PR_REPO_PATH} pull requests can be applied here.` };
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
 * @return {Array<{number: number, title: string, state: 'open'|'merged'|'closed', updatedAt: string, url: string}>}
 */
function parseLinkedPrs(searchJson, ticketId) {
	const items = searchJson && Array.isArray(searchJson.items) ? searchJson.items : [];
	const seen = new Set();
	const prs = [];
	for (const item of items) {
		// `search/issues` returns issues and PRs together; only PRs carry
		// `pull_request`.
		if (!item || !item.pull_request) continue;
		if (!bodyCitesTicket(item.body, ticketId)) continue;
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
			url: item.html_url || `https://github.com/WordPress/wordpress-develop/pull/${item.number}`
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
	bodyCitesTicket,
	parseLinkedPrs,
	orderByCommitDate,
	classifyHttpFailure,
	parsePrRef
};
