'use strict';

/**
 * Destinations inside a running dev server: the front end, wp-admin and Adminer
 * (issue #248).
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as trac-ticket.cjs and setup-steps.cjs).
 *
 * Why this is a module rather than a string concatenation at the call site:
 * `server-runner.js` builds the URL as `http://127.0.0.1:${port}/`, so it has
 * always ended in a slash, and the renderer's existing `Open Adminer` button
 * relies on that by writing `serverUrl.replace(/\/$/, '/') + 'adminer.php'`.
 * That `replace` swaps a trailing slash for a trailing slash — it is a no-op,
 * not the guard it reads as, so a URL arriving without one would silently
 * produce `http://127.0.0.1:8881adminer.php`. Deriving both paths here makes
 * the join correct regardless, and testable.
 */

/**
 * Joins a path onto the dev server's base URL.
 *
 * Returns '' for a missing base so a caller can use the result's falsiness as
 * the "no server yet" case, matching how the renderer already guards on
 * `serverUrl`.
 *
 * @param {string} serverUrl    Base URL of the running dev server.
 * @param {string} relativePath Path below it, with or without a leading slash.
 * @return {string}
 */
function siteUrl(serverUrl, relativePath) {
	const base = typeof serverUrl === 'string' ? serverUrl.trim() : '';
	if (!base) return '';
	const rel = typeof relativePath === 'string' ? relativePath.replace(/^\/+/, '') : '';
	return `${base.replace(/\/+$/, '')}/${rel}`;
}

/**
 * The admin dashboard.
 *
 * The trailing slash matters: WordPress redirects `/wp-admin` to `/wp-admin/`,
 * and asking for the canonical form directly saves the round trip.
 *
 * @param {string} serverUrl
 * @return {string}
 */
function adminUrl(serverUrl) {
	return siteUrl(serverUrl, 'wp-admin/');
}

/**
 * The bundled database browser (`src/adminer.php`).
 *
 * @param {string} serverUrl
 * @return {string}
 */
function adminerUrl(serverUrl) {
	return siteUrl(serverUrl, 'adminer.php');
}

module.exports = {
	siteUrl,
	adminUrl,
	adminerUrl
};
