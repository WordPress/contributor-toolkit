'use strict';

/**
 * What the site's view shows about the tickets that already have work on a
 * site (issue #108). The main process reports the branches on disk; this
 * module turns that report into the rows the list renders — which branches
 * count, in what order, and with what "Edited 2 days ago" note — and holds
 * what the list's card says (#557).
 *
 * Kept as a pure module so it can be unit tested without a DOM: the renderer
 * bundle imports it, `node --test` requires it directly (same convention as
 * trac-ticket.cjs and update-plan.cjs).
 */

const { __, _n, sprintf } = require('@wordpress/i18n');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/**
 * "Edited 2 days ago", for a branch's lastUsedAt.
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
	if (elapsed < MINUTE_MS) return __('Edited just now');
	if (elapsed < HOUR_MS) {
		const minutes = Math.floor(elapsed / MINUTE_MS);
		// translators: %d: a number of minutes.
		return sprintf(_n('Edited %d minute ago', 'Edited %d minutes ago', minutes), minutes);
	}
	if (elapsed < DAY_MS) {
		const hours = Math.floor(elapsed / HOUR_MS);
		// translators: %d: a number of hours.
		return sprintf(_n('Edited %d hour ago', 'Edited %d hours ago', hours), hours);
	}
	if (elapsed < 7 * DAY_MS) {
		const days = Math.floor(elapsed / DAY_MS);
		// translators: %d: a number of days.
		return sprintf(_n('Edited %d day ago', 'Edited %d days ago', days), days);
	}
	// translators: %s: a date, written the way the computer writes dates.
	return sprintf(__('Edited on %s'), new Date(then).toLocaleDateString());
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
 * as a row for #59234 while linked to #59234. When the site is
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
 * @return {Array<{ref: string, ticketId: number, number: string, timeLabel: ?string}>}
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
			// What the row is called on screen, and what its buttons are named
			// after.
			number: `#${b.ticketId}`,
			timeLabel: relativeTimeLabel(b.lastUsedAt || null, now)
		}));
}

/**
 * The pull request a switch to this work item would put back, by number, or
 * null when the switch only moves the checkout (#510).
 *
 * The distinction is what the renderer has to know *before* a switch starts,
 * because only the restore pauses the build watch: it ends in an install and a
 * build of its own (#506), while a plain switch leaves the running watch to
 * recompile what changed. `sites:set-ticket` reports it afterwards; this reads
 * the same record beforehand, off the `savedPr` each row carries.
 *
 * The work item already linked is the exception, and not a cosmetic one. A
 * branch records its parked pull request only when it is left, so while you
 * are on it the record says nothing and the row would answer null — which
 * would read as "leaving a pull request", pause the watch, and charge a full
 * rebuild for a switch main performs as a no-op. Linking the item in hand goes
 * nowhere, so the answer is the pull request already checked out.
 *
 * @param {Object}  input
 * @param {?Array}  input.branches       As returned by `branches:list`.
 * @param {?number} input.ticketId       The work item being switched to, or null for an unlink.
 * @param {?number} [input.linkedTicket] The work item linked now, or null.
 * @param {?number} [input.currentPr]    The pull request checked out now, or null.
 * @return {?number} The pull request number the switch would restore, or null.
 */
function savedPrForSwitch({ branches, ticketId, linkedTicket = null, currentPr = null } = {}) {
	if (ticketId === null || ticketId === undefined) return null;
	if (linkedTicket !== null && linkedTicket !== undefined && String(linkedTicket) === String(ticketId)) {
		return currentPr ?? null;
	}
	const row = (Array.isArray(branches) ? branches : []).find((b) => b && String(b.ticketId) === String(ticketId));
	return row && typeof row.savedPr === 'number' ? row.savedPr : null;
}

/**
 * Whether the site's tickets get a card of their own, and what it says
 * (#240, #557). The list left the Trac ticket card because only one of its
 * sections described the ticket in front of you — this one lists everywhere
 * else you could be. Its heading changes with the state, and so does what a
 * row offers: with a ticket linked the rows are the *other* tickets, and one
 * is switched to; with none linked they are *your* tickets, the primary way
 * to start, and one is gone on with.
 *
 * A row's buttons say what they do and not to which ticket: each is named by
 * the component with its words and then its row's number, the two as they are
 * on screen.
 *
 * Returns null when there are no rows — an empty card with nothing but a
 * heading is worse than no card, and unlike the input field it used to share a
 * card with, this card has nothing else to justify the space.
 *
 * @param {Object}  input
 * @param {number}  input.rowCount   How many rows ticketBranchRows produced.
 * @param {boolean} input.linked     Whether a ticket is linked to the site.
 * @param {string}  [input.provider] What the site's work items are (#251): Trac tickets unless told 'github-issue'.
 * @return {?{heading: string, action: string, remove: string, removing: string}} What the card says, or null for no card.
 */
function ticketListCard({ rowCount, linked, provider = 'trac' }) {
	if (!rowCount) return null;
	const issues = provider === 'github-issue';
	// translators: a verb, on a button beside the number of a ticket or an issue: go to the work on it.
	const switchTo = __('Switch');
	const shared = {
		action: linked ? switchTo : __('Continue working'),
		// translators: said to a screen reader, in place of a spinner, while the work on a ticket or an issue is being deleted.
		removing: __('Deleting')
	};
	if (issues) {
		return {
			...shared,
			heading: linked ? __('Other issues on this site') : __('Your issues on this site'),
			remove: __('Delete this issue’s work')
		};
	}
	return {
		...shared,
		heading: linked ? __('Other tickets on this site') : __('Your tickets on this site'),
		remove: __('Delete this ticket’s work')
	};
}

/**
 * What is asked before a ticket's work is deleted. The branch and everything
 * on it go, and nothing brings them back.
 *
 * @param {number} ticketId The ticket or the issue.
 * @return {string} The question.
 */
function deleteWorkQuestion(ticketId) {
	// translators: %d: the number of a Trac ticket or a GitHub issue.
	return sprintf(__('Delete all work on #%d on this site? This cannot be undone.'), ticketId);
}

module.exports = {
	relativeTimeLabel,
	ticketBranchRows,
	savedPrForSwitch,
	ticketListCard,
	deleteWorkQuestion
};
