'use strict';

/**
 * Deciding which patch on a ticket is the most recent — a pull request or a
 * Trac attachment (issue #109 / #11).
 *
 * A contributor arriving at a ticket wants to try the latest fix. Usually that
 * is a PR, and the PR list loads on its own, so the answer is known
 * immediately. Attachments load on demand (opening Trac costs the challenge),
 * so "latest" can only be judged across what is currently loaded: PRs alone
 * until the contributor asks for attachments, then both. When an uploaded patch
 * turns out to be newer than any PR, the UI says so explicitly rather than
 * leaving it buried under the attachments button.
 *
 * Kept pure and dependency-free so the comparison is unit tested without a DOM:
 * the renderer imports it, `node --test` requires it directly (same convention
 * as patch-plan.cjs / patch-sources.cjs).
 *
 * Caveat, deliberate: a PR is dated by `updatedAt`, which also bumps on
 * comments, so "latest" means "most recently touched", not "newest commit".
 * That matches the common case (an active PR is usually the freshest thing) and
 * is the only date the list already carries.
 */

/**
 * Milliseconds for an attachment's upload time, or NaN when it cannot be known.
 * The absolute timestamp scraped from Trac's title attribute is a US-format
 * date string ("MM/DD/YYYY hh:mm:ss AM"); a relative fallback ("15 months
 * ago") is not comparable and must not win.
 *
 * The string carries no timezone, so it is anchored to UTC by hand rather than
 * left to Date.parse, which would read it in the machine's local zone. That
 * anchoring is what keeps the comparison machine-independent: two contributors
 * in different timezones must see the same patch marked latest. The absolute
 * instant may be off by the true Trac offset, but "which is newer" stays
 * consistent, which is the point.
 *
 * @param {Object} attachment
 * @return {number}
 */
function attachmentDateMs(attachment) {
	const text = attachment && typeof attachment.dateText === 'string' ? attachment.dateText : '';
	const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?/i.exec(text.trim());
	if (!m) return NaN;
	const [, mon, day, year, hh, mm, ss, ampm] = m;
	let hour = Number(hh);
	if (ampm) {
		const pm = ampm.toUpperCase() === 'PM';
		if (pm && hour !== 12) hour += 12;
		if (!pm && hour === 12) hour = 0;
	}
	return Date.UTC(Number(year), Number(mon) - 1, Number(day), hour, Number(mm), Number(ss));
}

/**
 * Milliseconds for a PR's last activity, or NaN when absent.
 *
 * @param {Object} pr
 * @return {number}
 */
function prDateMs(pr) {
	const text = pr && typeof pr.updatedAt === 'string' ? pr.updatedAt : '';
	return text ? Date.parse(text) : NaN;
}

/**
 * The most recent patch across the loaded sources, or null if none is datable.
 *
 * Only applyable attachments (patch files) compete — a .txt is context, not a
 * fix. `attachments` being undefined means they have not been loaded yet, so
 * the answer is drawn from PRs alone; that is the normal, pre-attachment state.
 *
 * @param {Object} root0
 * @param {Array}  [root0.prs]
 * @param {Array}  [root0.attachments]
 * @return {{kind: 'pr'|'attachment', key: (number|string), whenMs: number}|null}
 */
function pickLatest({ prs, attachments } = {}) {
	let best = null;
	const consider = (kind, key, whenMs) => {
		if (!Number.isFinite(whenMs)) return;
		if (!best || whenMs > best.whenMs) best = { kind, key, whenMs };
	};

	for (const pr of Array.isArray(prs) ? prs : []) {
		consider('pr', pr.number, prDateMs(pr));
	}
	for (const att of Array.isArray(attachments) ? attachments : []) {
		if (!att.applyable) continue;
		consider('attachment', att.url || att.filename, attachmentDateMs(att));
	}
	return best;
}

module.exports = { attachmentDateMs, prDateMs, pickLatest };
