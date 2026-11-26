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

// The admin user every site is set up with. The credentials the details show
// are built from it (site-processes.cjs), so the user the wp-admin link logs
// in as is always the one they name.
const ADMIN_USERNAME = 'admin';

/**
 * The admin dashboard, already logged in (#743).
 *
 * The trailing slash matters: WordPress redirects `/wp-admin` to `/wp-admin/`,
 * and asking for the canonical form directly saves the round trip.
 *
 * The query is Playground's own: with PLAYGROUND_FORCE_AUTO_LOGIN_ENABLED,
 * which every site is served with (playground-plan.cjs), its auto-login
 * mu-plugin logs the browser in as the named user on that request. Only this
 * link does it: the site's front end and wp-login.php stay logged out until
 * the contributor logs in, so a ticket about either can still be tested.
 *
 * @param {string} serverUrl
 * @return {string}
 */
function adminUrl(serverUrl) {
	const url = siteUrl(serverUrl, 'wp-admin/');
	return url ? `${url}?playground_force_auto_login_as_user=${ADMIN_USERNAME}` : '';
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
	adminerUrl,
	ADMIN_USERNAME
};
