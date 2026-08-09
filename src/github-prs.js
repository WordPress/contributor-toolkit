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
 */

const { parseLinkedPrs, classifyHttpFailure } = require('./patch-sources.cjs');
const { httpGet } = require('./github-http.cjs');

const REPO = 'WordPress/wordpress-develop';

/**
 * The pull requests that cite a ticket, newest first.
 *
 * @param {number|string} ticketId
 * @param {Object}        [deps]
 * @return {Promise<{status: 'ok'|'rate-limited'|'error'|'offline', items: Array, error?: string}>}
 */
async function fetchLinkedPrs(ticketId, deps = {}) {
	const get = deps.httpGet || httpGet;
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

	return { status: 'ok', items: parseLinkedPrs(json, id) };
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

module.exports = { fetchLinkedPrs, fetchPrDiff, httpGet };
