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
 * the rest of the app already relies on, and adds nothing to install.
 */

const { parseLinkedPrs, classifyHttpFailure } = require('./patch-sources.cjs');

const REPO = 'WordPress/wordpress-develop';
// GitHub rejects API requests with no User-Agent; an identifying one is also
// the honest thing to send.
const USER_AGENT = 'WordPress-Contributor-Toolkit (+https://github.com/WordPress/experimental-wp-dev-env)';
const REQUEST_TIMEOUT_MS = 15000;

/**
 * A single GET over Electron net. Never rejects on an HTTP status — the status
 * is data the caller classifies — only on a transport failure or timeout.
 * Modelled on the never-reject readiness probe in main.js.
 *
 * The `deps` seam (net client and timers) exists only so the response,
 * transport-error, timeout, and settle-once paths can be exercised without the
 * network or a real 15s wait; production callers pass nothing and get Electron's
 * `net` and the global timers.
 *
 * @param {string} url
 * @param {Object} [headers]
 * @param {Object} [deps]
 * @return {Promise<{status: number, headers: Object, body: string}>}
 */
function httpGet(url, headers = {}, deps = {}) {
	// Required lazily, not at module load: requiring `electron` outside Electron
	// resolves the binary and can spawn its installer on a cold checkout, and the
	// standalone tests inject their own client and must never reach it.
	const netImpl = deps.net || require('electron').net;
	const setTimeoutImpl = deps.setTimeout || setTimeout;
	const clearTimeoutImpl = deps.clearTimeout || clearTimeout;
	return new Promise((resolve, reject) => {
		let settled = false;
		const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };

		const request = netImpl.request({ method: 'GET', url });
		request.setHeader('User-Agent', USER_AGENT);
		for (const [key, value] of Object.entries(headers)) request.setHeader(key, value);

		const timer = setTimeoutImpl(() => {
			try { request.abort(); } catch {}
			finish(reject, new Error(`Timed out after ${REQUEST_TIMEOUT_MS}ms`));
		}, REQUEST_TIMEOUT_MS);

		request.on('response', (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => {
				clearTimeoutImpl(timer);
				const lowerHeaders = {};
				for (const [key, value] of Object.entries(response.headers || {})) {
					lowerHeaders[key.toLowerCase()] = Array.isArray(value) ? value[0] : value;
				}
				finish(resolve, { status: response.statusCode, headers: lowerHeaders, body: Buffer.concat(chunks).toString('utf8') });
			});
			response.on('error', (e) => { clearTimeoutImpl(timer); finish(reject, e); });
		});
		request.on('error', (e) => { clearTimeoutImpl(timer); finish(reject, e); });
		request.end();
	});
}

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
