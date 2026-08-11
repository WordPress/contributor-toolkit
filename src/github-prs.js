'use strict';

/**
 * Finding the pull requests linked to a Trac ticket, and fetching one's diff
 * (issue #11 / #109).
 *
 * All GitHub access goes through the documented REST API, not the web `.diff`
 * route: `github.com/…/pull/N.diff` and `patch-diff.githubusercontent.com`
 * both return 422 to unauthenticated clients now (verified 2026-08-06), so the
 * only reliable unauthenticated path is `repos/…/pulls/N` with the diff media
 * type. The cost is the shared 60-requests-per-hour limit, which is why the
 * caller caches and why classifyHttpFailure separates a spent limit from an
 * empty ticket.
 *
 * Requests use Electron's `net` rather than a new HTTP dependency: it rides the
 * Chromium network stack, so it honours the same proxy and TLS configuration
 * the rest of the app already relies on, and adds nothing to install. That
 * request primitive now lives in github-http.cjs, because opening a pull
 * request (#167) needs the same one with a method and a body.
 *
 * The list costs one request; ranking it costs a few more. That is not a
 * regression against the care taken above — it is the price of the list meaning
 * anything (#281). See resolveCommitDates for how few it settles for.
 */

const { parseLinkedPrs, orderByCommitDate, classifyHttpFailure } = require('./patch-sources.cjs');
const { httpGet } = require('./github-http.cjs');

const REPO = 'WordPress/wordpress-develop';

/**
 * How many requests the commit-date walk may spend on one ticket.
 *
 * Each is one request against the shared unauthenticated 60/hour, so the
 * ranking below spends them only while they can still change the answer and
 * stops at this cap regardless. Four covers every ticket seen in practice
 * except one caught inside a fresh upstream force-push sweep, where no number
 * is obviously right and admitting the ranking is incomplete is better than
 * emptying the quota.
 *
 * It counts requests rather than pull requests because that is what the quota
 * counts: a pull request over 100 commits costs two, and four rows of those
 * would be eight requests under a cap that reads like four.
 */
const MAX_COMMIT_LOOKUPS = 4;

/**
 * How far ahead of now a commit date may sit before it is treated as a wrong
 * clock rather than a fresh commit. Machines drift by minutes; a commit dated
 * next month is not a fix anyone can apply.
 */
const CLOCK_SKEW_TOLERANCE_MS = 10 * 60 * 1000;

/**
 * The date of a pull request's most recent commit, or null when it cannot be
 * read (issue #281).
 *
 * `search/issues` — the one request the list is built from — carries no commit
 * date, so this is the extra cost of ranking by code rather than by touch. The
 * documented `pulls/{n}/commits` is used rather than a ref trick against
 * `commits/{sha}`: this file already avoids undocumented GitHub behaviour on
 * the `.diff` routes, and the same reasoning applies here.
 *
 * The list is ascending and paginated at 100. Nearly every pull request fits in
 * one page; a longer one is followed once, to the `rel="last"` page named in
 * the Link header. GitHub truncates the list at 250 commits, so a pull request
 * longer than that resolves to the newest of the 250 it lists — off by nothing
 * that matters for "which of these is fresher", and never silently absent.
 *
 * @param {number}   number
 * @param {Function} get    httpGet, injected so the loop is testable.
 * @param {Object}   spent  Mutable `{count}` — every request made is counted.
 * @return {Promise<{ok: true, date: string|null}|{ok: false, status: string}>}
 */
async function fetchPrCommitDate(number, get, spent) {
	const base = `https://api.github.com/repos/${REPO}/pulls/${number}/commits?per_page=100`;

	const page = async (url) => {
		spent.count += 1;
		let res;
		try {
			res = await get(url, { Accept: 'application/vnd.github+json' });
		} catch {
			return { ok: false, status: 'offline' };
		}
		if (res.status !== 200) return { ok: false, status: classifyHttpFailure(res.status, res.headers) };
		let json;
		try { json = JSON.parse(res.body); } catch { return { ok: false, status: 'error' }; }
		return { ok: true, commits: Array.isArray(json) ? json : [], headers: res.headers || {} };
	};

	const first = await page(base);
	if (!first.ok) return first;

	// Only the last page can hold the newest commit, so a paginated pull request
	// costs a second request and not a walk through the middle. That second one
	// is checked against the cap here rather than only at the top of the walk:
	// the cap counts requests, and a guard that admits a row and then spends two
	// makes the real ceiling one higher than the number it is written as.
	const lastPage = lastPageNumber(first.headers.link);
	let commits = first.commits;
	if (lastPage > 1) {
		// Refusing is the honest outcome, not falling back to the first page: its
		// newest commit is the oldest part of this pull request, so using it would
		// be a confident wrong answer rather than a missing one.
		if (spent.count >= MAX_COMMIT_LOOKUPS) return { ok: false, status: 'capped' };
		const rest = await page(`${base}&page=${lastPage}`);
		if (!rest.ok) return rest;
		commits = rest.commits;
	}

	let newest = null;
	for (const entry of commits) {
		// `committer.date` is when the commit last took its current form — the
		// one a rebase or amend moves. `author.date` is the fallback for the
		// rare entry that omits it.
		const c = entry && entry.commit ? entry.commit : null;
		const text = (c && c.committer && c.committer.date) || (c && c.author && c.author.date) || '';
		const ms = text ? Date.parse(text) : NaN;
		if (!Number.isFinite(ms)) continue;
		if (newest === null || ms > Date.parse(newest)) newest = text;
	}
	return { ok: true, date: newest };
}

/**
 * The page number in a Link header's `rel="last"`, or 0 when there is none.
 *
 * @param {string} [link]
 * @return {number}
 */
function lastPageNumber(link) {
	if (typeof link !== 'string' || !link) return 0;
	for (const part of link.split(',')) {
		if (!/rel="?last"?/.test(part)) continue;
		const m = /[?&]page=(\d+)/.exec(part);
		if (m) return Number(m[1]);
	}
	return 0;
}

/**
 * Fills in the commit date of as many pull requests as the answer needs, in
 * place, and reports whether the resulting ranking is complete (issue #281).
 *
 * The saving that makes this affordable: GitHub's `updated_at` is at or after
 * the last commit date — a comment or a bot sweep can only push it later, never
 * earlier — so on a list already sorted by `updated_at` descending it is a
 * per-row *upper bound*. Once a resolved commit date beats the next row's
 * bound, no row below can win and the walk stops. A ticket with one pull
 * request, or with a clear winner, costs one extra request; only a ticket whose
 * bounds are all identical — which is exactly what a force-push sweep produces,
 * and the bug this exists to fix — walks down to the cap.
 *
 * "Complete" means the tail was ruled out rather than merely unread: true when
 * the walk stopped on the bound or ran out of rows, false when it stopped on
 * the cap or on a failed lookup. The caller shows no "Latest" pill on an
 * incomplete ranking, because an unread row could be the real winner.
 *
 * A date already known from the cache is reused rather than fetched again, on
 * the same bound that makes the walk cheap: `updated_at` moves when a branch is
 * pushed, so a row whose stamp has not changed since it was cached has not had
 * new code pushed to it either. Without this a Refresh on a rate-limited
 * quota would replace a ranking the contributor could already read with an
 * unranked list, and the request that failed would have destroyed the evidence
 * rather than merely failed to add to it.
 *
 * @param {Array}    prs   Sorted by `updatedAt` descending; mutated in place.
 * @param {Function} get
 * @param {Map}      known PR number → `{updatedAt, commitDate}` last seen.
 * @return {Promise<boolean>} Whether the ranking is complete.
 */
async function resolveCommitDates(prs, get, known) {
	const spent = { count: 0 };
	let bestMs = -Infinity;
	let complete = true;

	// A commit dated well ahead of now is a contributor's clock, not a fresher
	// fix. It has to be discarded rather than merely ignored for the pill: as
	// `bestMs` it would clear every remaining bound at once, ending the walk and
	// reporting the whole ranking complete on the strength of the one date that
	// is wrong. The tolerance is for the ordinary case of a machine a few
	// minutes out — a just-pushed commit is the freshest thing on the ticket and
	// should not be thrown away over a clock, which is the failure this guard
	// could otherwise cause instead of prevent.
	const horizonMs = Date.now() + CLOCK_SKEW_TOLERANCE_MS;
	const usable = (date) => {
		const ms = date ? Date.parse(date) : NaN;
		return Number.isFinite(ms) && ms <= horizonMs ? ms : NaN;
	};

	// Cached dates are free, so they are applied to every row before the walk
	// starts rather than only to the rows it reaches — a date the walk would
	// have stopped short of is still a date the row can show. A cached date gets
	// the same horizon check as a fetched one: a clock corrected backwards since
	// it was written would otherwise leave a future date on the row, winning the
	// pill and never being re-read, because a dated row is one the walk skips.
	for (const pr of prs) {
		const cached = known instanceof Map ? known.get(pr.number) : null;
		if (!cached || !cached.commitDate || !cached.updatedAt) continue;
		if (cached.updatedAt !== pr.updatedAt) continue;
		const cachedMs = usable(cached.commitDate);
		if (!Number.isFinite(cachedMs)) continue;
		pr.commitDate = cached.commitDate;
		if (cachedMs > bestMs) bestMs = cachedMs;
	}

	for (const pr of prs) {
		if (pr.commitDate) continue;

		const boundMs = pr.updatedAt ? Date.parse(pr.updatedAt) : NaN;
		// Nothing from here down can beat what is already resolved.
		if (Number.isFinite(boundMs) && bestMs >= boundMs) break;
		if (spent.count >= MAX_COMMIT_LOOKUPS) { complete = false; break; }

		const res = await fetchPrCommitDate(pr.number, get, spent);
		// A spent rate limit or a dead network will not fix itself on the next
		// row, and each attempt costs a request the contributor may need for the
		// diff they are about to apply.
		if (!res.ok) { complete = false; break; }

		const ms = usable(res.date);
		pr.commitDate = Number.isFinite(ms) ? res.date : null;
		if (Number.isFinite(ms) && ms > bestMs) bestMs = ms;
	}

	return complete;
}

/**
 * The pull requests that cite a ticket, newest first.
 *
 * `deps.known` is the last-seen list for this ticket, if the caller kept one.
 * Its commit dates are reused for rows whose `updatedAt` has not moved since,
 * which is what stops a Refresh from re-spending the walk — and, on a spent
 * quota, from replacing a ranking the contributor could already read.
 *
 * @param {number|string} ticketId
 * @param {Object}        [deps]
 * @param {Function}      [deps.httpGet]
 * @param {Array}         [deps.known]
 * @return {Promise<{status: 'ok'|'rate-limited'|'error'|'offline', items: Array, rankComplete?: boolean, error?: string}>}
 */
async function fetchLinkedPrs(ticketId, deps = {}) {
	const get = deps.httpGet || httpGet;
	const known = new Map();
	for (const pr of Array.isArray(deps.known) ? deps.known : []) {
		if (pr && typeof pr.number === 'number') known.set(pr.number, { updatedAt: pr.updatedAt, commitDate: pr.commitDate });
	}
	const id = String(ticketId).replace(/[^0-9]/g, '');
	if (!id) return { status: 'error', items: [], error: 'No ticket number' };

	// 100 is GitHub's per-page maximum. One request covers any realistic ticket;
	// paginating would multiply requests against the shared unauthenticated quota
	// this whole feature is careful with, so instead a result that does not fit in
	// one page is treated as incomplete below.
	const query = encodeURIComponent(`repo:${REPO} is:pr ${id}`);
	const url = `https://api.github.com/search/issues?q=${query}&per_page=100`;

	let res;
	try {
		res = await get(url, { Accept: 'application/vnd.github+json' });
	} catch (e) {
		// A transport failure is offline, not empty: the contributor may simply
		// have no network, which the panel should say rather than "no patches".
		return { status: 'offline', items: [], error: String(e && e.message ? e.message : e) };
	}

	if (res.status !== 200) {
		return { status: classifyHttpFailure(res.status, res.headers), items: [], error: `GitHub returned ${res.status}` };
	}

	let json;
	try { json = JSON.parse(res.body); } catch { return { status: 'error', items: [], error: 'Unreadable response from GitHub' }; }

	// A truncated search must not be cached as the complete list: the linked PR
	// could be one we did not receive, and "no patches" shown as final is the
	// exact failure this feature guards against. Fall back to the cache instead.
	const returned = Array.isArray(json.items) ? json.items.length : 0;
	if (json.incomplete_results === true || (typeof json.total_count === 'number' && json.total_count > returned)) {
		return { status: 'error', items: [], error: 'Too many results to list reliably' };
	}

	const items = parseLinkedPrs(json, id);
	// The list arrives ordered by `updatedAt`, which is the bound the walk needs
	// and not an ordering worth showing (#281). Rank it by real commit dates,
	// then reorder for display.
	const rankComplete = await resolveCommitDates(items, get, known);
	return { status: 'ok', items: orderByCommitDate(items), rankComplete };
}

/**
 * The unified diff for one pull request.
 *
 * @param {number} number
 * @return {Promise<{ok: true, text: string}|{ok: false, status: string, error: string}>}
 */
async function fetchPrDiff(number) {
	const n = String(number).replace(/[^0-9]/g, '');
	if (!n) return { ok: false, status: 'error', error: 'No pull request number' };

	let res;
	try {
		res = await httpGet(`https://api.github.com/repos/${REPO}/pulls/${n}`, { Accept: 'application/vnd.github.v3.diff' });
	} catch (e) {
		return { ok: false, status: 'offline', error: String(e && e.message ? e.message : e) };
	}
	if (res.status !== 200) {
		return { ok: false, status: classifyHttpFailure(res.status, res.headers), error: `GitHub returned ${res.status}` };
	}
	return { ok: true, text: res.body };
}

module.exports = { MAX_COMMIT_LOOKUPS, fetchLinkedPrs, fetchPrDiff, httpGet };
