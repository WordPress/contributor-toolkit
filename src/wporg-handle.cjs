'use strict';

/**
 * Reading what a contributor typed when asked for their WordPress.org handle
 * (issue #166).
 *
 * The handle is what makes the mentor handoff work: the patch carries it, so
 * whoever pushes the work can hand the props back to the person who did it.
 * That is the whole reason it is asked for, and the reason it is asked for
 * once, app-wide — it is a fact about the contributor, not a property of a
 * checkout, the same reasoning the editor preference already follows.
 *
 * People arrive from a browser, so the input is as likely to be a pasted
 * profile URL or an `@handle` copied out of Slack as it is the bare handle.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM or an Electron process: the renderer bundle imports it, main.js requires
 * it, `node --test` requires it directly (same convention as trac-ticket.cjs).
 */

const PROFILES_HOST = 'profiles.wordpress.org';

// WordPress.org sanitizes a username down to this before it becomes the
// profile slug: letters, digits, and the three separators, never leading or
// trailing. Matched case-insensitively and stored lowercase, because that is
// the form profiles.wordpress.org serves and the form props are written in.
const HANDLE = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i;

// Longer than any real handle, short enough that the value stays a plausible
// filename component and a single header line.
const MAX_HANDLE_LENGTH = 60;

const NOT_A_HANDLE =
	'Enter your WordPress.org username, like janedoe, or your profiles.wordpress.org URL.';

/**
 * Whether a value is already a stored handle — the canonical form `parseHandle`
 * produces, not free-form input. Callers that put a handle somewhere structural
 * (a filename, a header line) ask this rather than re-deriving the charset.
 *
 * @param {unknown} value
 */
function isHandle(value) {
	return typeof value === 'string'
		&& value.length <= MAX_HANDLE_LENGTH
		&& value === value.toLowerCase()
		&& HANDLE.test(value);
}

/**
 * Canonical profile URL for a handle.
 *
 * @param {string} handle
 */
function profileUrl(handle) {
	return `https://${PROFILES_HOST}/${handle}/`;
}

/**
 * @param {string} candidate
 */
function fromHandle(candidate) {
	if (candidate.length > MAX_HANDLE_LENGTH || !HANDLE.test(candidate)) {
		return { ok: false, error: NOT_A_HANDLE };
	}
	const handle = candidate.toLowerCase();
	return { ok: true, handle, url: profileUrl(handle) };
}

/**
 * Resolves free-form input to a WordPress.org handle. Accepts `janedoe`,
 * `@janedoe` and any profiles.wordpress.org URL; rejects everything else with
 * a message meant for the contributor, not for a log.
 *
 * @param {string} input
 * @return {{ok: true, handle: string, url: string}|{ok: false, error: string}}
 */
function parseHandle(input) {
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) return { ok: false, error: 'Enter your WordPress.org username.' };

	const bare = raw.replace(/^@/, '');

	// Only take the URL branch when the input actually looks like one. `new URL`
	// is lenient enough that a bare word parses as a hostname, which would report
	// a wrong *host* rather than the real problem — the same trap trac-ticket.cjs
	// documents. A handle can contain dots, so a dotted string is not enough to
	// call it a URL: it needs a scheme or a path.
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
	if (!hasScheme && !raw.includes('/')) return fromHandle(bare);

	let parsed;
	try {
		parsed = new URL(hasScheme ? raw : `https://${raw}`);
	} catch {
		return { ok: false, error: NOT_A_HANDLE };
	}

	if (parsed.hostname.toLowerCase() !== PROFILES_HOST) {
		return { ok: false, error: `Only ${PROFILES_HOST} profile links are supported.` };
	}

	// Reading the handle off the path drops any query or fragment for free.
	const match = /^\/([^/]+)\/?$/.exec(parsed.pathname);
	if (!match) return { ok: false, error: NOT_A_HANDLE };

	// A percent-escape the URL parser left in place — the handle charset has
	// none, so an undecodable one is simply not a handle.
	let slug;
	try {
		slug = decodeURIComponent(match[1]);
	} catch {
		return { ok: false, error: NOT_A_HANDLE };
	}
	return fromHandle(slug);
}

module.exports = {
	PROFILES_HOST,
	MAX_HANDLE_LENGTH,
	isHandle,
	profileUrl,
	parseHandle
};
