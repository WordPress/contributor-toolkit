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
 * branch currently checked out, and so is the ticket the panel is linked to:
 * both mean "the one you are on", and offering to "continue" it would be a
 * button that does nothing. They are excluded independently because they can
 * disagree — `current` arrives with the branch list, which is loaded
 * asynchronously and can be stale for a moment after a switch, while the
 * linked ticket is what the panel is already showing. Seen in manual testing
 * as "You also have work on #59234" while linked to #59234. When the site is
 * on trunk with no ticket, neither matches and every ticket is offered —
 * which is exactly right for the unlinked state.
 *
 * Most recently used first, so the ticket someone is coming back for is the
 * top row; branches with no record sort last, tickets ascending, rather than
 * interleaving with the ones that can prove their recency.
 *
 * @param {Object}  input
 * @param {?Array}  input.branches   As returned by `branches:list`.
 * @param {?string} input.current    The checked-out ref, or null.
 * @param {?number} input.tracTicket The ticket the panel is linked to, or null.
 * @param {number}  input.now        Epoch milliseconds, injected for tests.
 * @return {Array<{ref: string, ticketId: number, timeLabel: ?string}>}
 */
function ticketBranchRows({ branches, current, tracTicket, now }) {
	return (Array.isArray(branches) ? branches : [])
		.filter((b) => b && typeof b.ticketId === 'number' && b.ref !== current
			&& (typeof tracTicket !== 'number' || b.ticketId !== tracTicket))
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

/**
 * Whether the site's tickets get a card of their own, and under what heading
 * (#240). The list left the Trac ticket card because only one of its sections
 * described the ticket in front of you — this one lists everywhere else you
 * could be. Its heading still changes with the state: with a ticket linked the
 * rows are the *other* tickets, with none linked they are *your* tickets and
 * the primary way to start.
 *
 * Returns null when there are no rows — an empty card with nothing but a
 * heading is worse than no card, and unlike the input field it used to share a
 * card with, this card has nothing else to justify the space.
 *
 * @param {Object}  input
 * @param {number}  input.rowCount How many rows ticketBranchRows produced.
 * @param {boolean} input.linked   Whether a ticket is linked to the site.
 * @return {?{heading: string}} What the card says, or null for no card.
 */
function ticketListCard({ rowCount, linked }) {
	if (!rowCount) return null;
	return {
		heading: linked ? 'Other tickets on this site' : 'Your tickets on this site'
	};
}

module.exports = {
	relativeTimeLabel,
	ticketBranchRows,
	ticketListCard
};
