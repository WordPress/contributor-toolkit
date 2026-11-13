'use strict';

// What the control channel (#764) says of a site: the facts a tool needs to
// work in the checkout the app already made, and nothing it would have to
// interpret. Kept out of main.js so the shape has a test of its own.

const { projectTypeForSite } = require('./project-type.cjs');
const path = require('path');
const { pathBasename } = require('./renderer/path-basename.cjs');

/**
 * @param {Object}      root0
 * @param {string}      root0.sitePath
 * @param {Object}      [root0.meta]        The site's record in the store.
 * @param {string}      root0.branch        The branch checked out.
 * @param {number|null} [root0.pullRequest] The pull request that branch is, if it is one.
 * @param {Object}      [root0.server]      The entry in main.js's `playgroundServers`.
 * @return {Object} One entry of `sites.list`.
 */
function describeSite({ sitePath, meta = {}, branch, pullRequest = null, server = null }) {
	const project = projectTypeForSite(meta);
	return {
		path: sitePath,
		label: meta.label || pathBasename(sitePath),
		project: project.id,
		// The stored key is `tracTicket` for both providers (see the note
		// above `sites:set-ticket` in main.js); the provider is what tells a
		// Trac ticket from a GitHub issue.
		workItem: meta.tracTicket ? { provider: project.workItem.provider, id: meta.tracTicket } : null,
		branch,
		pullRequest,
		initialized: Boolean(meta.initialized),
		server: {
			running: Boolean(server && server.child),
			// A server that is still starting has a process and no address yet.
			url: (server && server.child && server.url) || null
		}
	};
}

// How many lines of debug.log an answer carries: what is asked for, within
// these. The whole file is not an answer; it can be a week of notices.
const LOG_LINES = { fallback: 100, max: 1000 };

// The most of one mail's text an answer carries. A password reset or a
// notification is a few hundred characters; a newsletter template is not what
// a tool testing a ticket is reading for.
const MAX_MAIL_TEXT = 20000;

// How many mails an answer carries, newest first. The store keeps every mail
// a site ever sent, and an answer is one line of JSON built in the main
// process and read into a tool's context.
const MAX_MAILS = 50;

// Windows and macOS file systems do not tell `Sites` from `sites`. `..` is
// resolved first, so `/sites/wp/../gb` is in gb and not in wp.
function comparable(p, platform) {
	const posix = path.posix.normalize(String(p).replace(/\\/g, '/')).replace(/\/+$/, '');
	return platform === 'linux' ? posix : posix.toLowerCase();
}

/**
 * Which registered site a tool means.
 *
 * A tool names a site the way it knows it: the path `sites.list` gave, a
 * folder inside that site (an agent working in the checkout passes where it
 * is), or the name in the sidebar. The answer is always a path out of the
 * registry, never the string that was sent, so nothing a tool sends is used as
 * a path.
 *
 * @param {*}        ref              What the tool sent.
 * @param {Object}   root0
 * @param {string[]} root0.sites      The registry.
 * @param {Object}   [root0.siteMeta]
 * @param {string}   [root0.platform]
 * @return {{ok: true, sitePath: string}|{ok: false, code: string, error: string}}
 */
function resolveSite(ref, { sites, siteMeta = {}, platform = process.platform }) {
	const registered = Array.isArray(sites) ? sites : [];
	if (typeof ref !== 'string' || ref.trim() === '') {
		return { ok: false, code: 'unknown-site', error: 'No site was named.' };
	}
	if (registered.includes(ref)) return { ok: true, sitePath: ref };

	// A folder inside a site. The longest match, for a site kept inside
	// another one's folder.
	const wanted = comparable(ref, platform);
	const containing = registered
		.filter((sitePath) => {
			const site = comparable(sitePath, platform);
			return wanted === site || wanted.startsWith(`${site}/`);
		})
		.sort((a, b) => b.length - a.length);
	if (containing.length > 0) return { ok: true, sitePath: containing[0] };

	const named = registered.filter((sitePath) => {
		const label = (siteMeta[sitePath] && siteMeta[sitePath].label) || pathBasename(sitePath);
		return label.toLowerCase() === ref.trim().toLowerCase();
	});
	if (named.length === 1) return { ok: true, sitePath: named[0] };
	if (named.length > 1) {
		return { ok: false, code: 'ambiguous-site', error: `${named.length} sites are named ${ref.trim()}. Name the one you mean by its path.` };
	}
	return { ok: false, code: 'unknown-site', error: `The WordPress Contributor Toolkit has no site at or named ${ref.trim().slice(0, 200)}.` };
}

/**
 * How many lines to answer with, from what a tool asked for.
 *
 * @param {*} asked
 * @return {number}
 */
function logLineCount(asked) {
	const n = Number(asked);
	if (!Number.isInteger(n) || n < 1) return LOG_LINES.fallback;
	return Math.min(n, LOG_LINES.max);
}

/**
 * The last `count` lines of what was read from the end of a log.
 *
 * @param {string}  text
 * @param {number}  count
 * @param {Object}  [options]
 * @param {boolean} [options.partialFirst] The read began mid-file, so its first line may be the end of one.
 * @return {string[]}
 */
function lastLines(text, count, { partialFirst = false } = {}) {
	const lines = String(text).split(/\r?\n/);
	if (lines[lines.length - 1] === '') lines.pop();
	// One line longer than the whole read has no beginning to wait for: what
	// there is of it is the answer, not an empty log.
	if (partialFirst && lines.length > 1) lines.shift();
	return lines.slice(-count);
}

/**
 * A caught mail as a tool reads it: who, what and the text. The HTML part is
 * left out; the text part is what WordPress's own mails are written in.
 *
 * @param {Object} email A record from the store.
 * @return {Object}
 */
function describeEmail(email) {
	const text = String(email.text || '');
	return {
		sentAt: email.sentAt || null,
		from: email.from || '',
		to: email.to || '',
		subject: email.subject || '',
		text: text.slice(0, MAX_MAIL_TEXT),
		textTruncated: text.length > MAX_MAIL_TEXT
	};
}

module.exports = { LOG_LINES, MAX_MAIL_TEXT, MAX_MAILS, describeSite, resolveSite, logLineCount, lastLines, describeEmail };
