'use strict';

/**
 * What the Trac ticket panel shows about the tickets that already have work on
 * a site (issue #108). The main process reports the branches on disk; this
 * module turns that report into the rows the panel renders — which branches
 * count, in what order, and with what "edited N days ago" note.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as trac-ticket.cjs and update-plan.cjs).
 */

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "edited 2 days ago", for a branch's lastUsedAt.
 *
 * Hand-rolled buckets rather than Intl.RelativeTimeFormat: the buckets are the
 * whole behaviour, and with an injected `now` they are testable to the
 * millisecond. Past a week the phrasing switches to the absolute date — "43
 * days ago" makes the reader do arithmetic that toLocaleDateString has already
 * done.
 *
 * @param {?string} iso When the branch was last worked on, or null — a branch
 *                      made outside the app has no record, and no label is
 *                      more honest than a guessed one.
 * @param {number}  now Current time in epoch milliseconds, injected for tests.
 * @return {?string} The label, or null when there is nothing to say.
 */
function relativeTimeLabel(iso, now) {
	if (!iso) return null;
	const then = Date.parse(iso);
	if (Number.isNaN(then)) return null;
	const elapsed = now - then;
	if (elapsed < MINUTE_MS) return 'edited just now';
	if (elapsed < HOUR_MS) {
		const minutes = Math.floor(elapsed / MINUTE_MS);
		return `edited ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
	}
	if (elapsed < DAY_MS) {
		const hours = Math.floor(elapsed / HOUR_MS);
		return `edited ${hours} hour${hours === 1 ? '' : 's'} ago`;
	}
	if (elapsed < 7 * DAY_MS) {
		const days = Math.floor(elapsed / DAY_MS);
		return `edited ${days} day${days === 1 ? '' : 's'} ago`;
	}
	return `edited on ${new Date(then).toLocaleDateString()}`;
}

/**
 * The rows the panel renders, from what `branches:list` returned.
 *
 * Branches without a ticket id are dropped — a branch someone made with their
 * own git client is not a ticket this panel can offer to resume. So is the
 * branch currently checked out: its ticket is the one the panel already names,
 * and offering to "continue" it would be a button that does nothing. When the
 * site is on trunk (or nothing resolves), no ref matches and every ticket is
 * offered — which is exactly right for the unlinked state.
 *
 * Most recently used first, so the ticket someone is coming back for is the
 * top row; branches with no record sort last, tickets ascending, rather than
 * interleaving with the ones that can prove their recency.
 *
 * @param {Object}  input
 * @param {?Array}  input.branches As returned by `branches:list`.
 * @param {?string} input.current  The checked-out ref, or null.
 * @param {number}  input.now      Epoch milliseconds, injected for tests.
 * @return {Array<{ref: string, ticketId: number, timeLabel: ?string}>}
 */
function ticketBranchRows({ branches, current, now }) {
	return (Array.isArray(branches) ? branches : [])
		.filter((b) => b && typeof b.ticketId === 'number' && b.ref !== current)
		.sort((a, b) => {
			const aAt = a.lastUsedAt ? Date.parse(a.lastUsedAt) : NaN;
			const bAt = b.lastUsedAt ? Date.parse(b.lastUsedAt) : NaN;
			if (Number.isNaN(aAt) && Number.isNaN(bAt)) return a.ticketId - b.ticketId;
			if (Number.isNaN(aAt)) return 1;
			if (Number.isNaN(bAt)) return -1;
			return bAt - aAt || a.ticketId - b.ticketId;
		})
		.map((b) => ({
			ref: b.ref,
			ticketId: b.ticketId,
			timeLabel: relativeTimeLabel(b.lastUsedAt || null, now)
		}));
}

module.exports = {
	relativeTimeLabel,
	ticketBranchRows
};
