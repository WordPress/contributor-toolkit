// What the card says about unsubmitted changes, and when a discard may run.
//
// The note under the buttons is the first place the app admits there is
// unsubmitted work without the contributor opening the patch modal to find
// out. "Unsubmitted" is measured the way the patch measures it — from the
// ticket's branch point, parked WIP included — not as "uncommitted" (#239):
// under the ticket-as-branch model those diverged, and the note reads the
// wide answer while the checkout guards keep the narrow one.
// Its sentence branches three ways — clean tree, dirty with a linked ticket,
// dirty without one — and where it renders moves with the ticket: a change
// that belongs to #12345 is news for the ticket card, a change that belongs
// to nothing is news for the buttons that would give it somewhere to go.
'use strict';

// Byte-identical to the confirm the dirty-update modal has always used, so
// the same action reads the same everywhere it can be triggered.
const DISCARD_CONFIRM_MESSAGE = 'Discard all local changes? This cannot be undone.';

/**
 * The changes note, split into parts the component interleaves with its two
 * link buttons, or null when there is nothing to say.
 *
 * `changedCount` can be missing: the dirty probe may have answered before a
 * count existed, and "You have changes" is still true then.
 *
 * The action labels move with the placement. By the buttons the modal has
 * not been named yet, so the link says what it produces — a patch. In the
 * ticket card the sentence already says where the changes are going, so the
 * link borrows the modal's own name, "review and submit". The ticket card
 * also carries a reassurance the buttons never need: Unlink sits right
 * above, and the changes must not look like they hang on it.
 *
 * @param {{dirty?: boolean, changedCount?: number, tracTicket?: *}} state
 * @return {{placement: 'buttons'|'ticket', lead: string, patchLabel: string,
 *          middle: string, discardLabel: string, end: string,
 *          unlinkNote?: string}|null}
 */
function changesNoteParts({ dirty, changedCount, tracTicket } = {}) {
	if (!dirty) return null;
	const count = Number.isInteger(changedCount) && changedCount > 0 ? changedCount : null;
	const noun = count === 1 ? 'change' : 'changes';
	if (tracTicket) {
		return {
			placement: 'ticket',
			lead: `You have ${count === null ? '' : `${count} `}unsubmitted ${noun} for ticket #${tracTicket}. You can `,
			patchLabel: 'review and submit',
			middle: ' or ',
			discardLabel: 'discard your changes',
			end: '.',
			unlinkNote: 'Unlinking this ticket doesn\'t affect your local changes for this ticket — they remain attached to it in this site, ready for when you link it again.'
		};
	}
	return {
		placement: 'buttons',
		lead: `You have ${count === null ? '' : `${count} `}${noun} not assigned to any ticket. You can `,
		patchLabel: 'create and save a patch',
		middle: ' or ',
		discardLabel: 'discard your changes',
		end: '.'
	};
}

/**
 * A `git:discard-changes` reply turned into something the card can render.
 * Failure always carries a message — a discard that silently did nothing
 * would leave the contributor believing their tree is clean.
 *
 * Success carries the reply's recount of what survived when there is one
 * (#239): on a ticket branch the parked work outlives a discard, and dropping
 * the count here would leave the card marking the tree clean over changes
 * that are still there.
 *
 * @param {*} res
 * @return {{ok: true, dirty?: boolean, changedCount?: number}
 *         |{ok: false, message: string}}
 */
function discardOutcome(res) {
	if (res && res.ok) {
		return typeof res.dirty === 'boolean'
			? { ok: true, dirty: res.dirty, changedCount: res.changedCount }
			: { ok: true };
	}
	return { ok: false, message: `Failed to discard changes: ${res && res.error ? res.error : 'Unknown error'}` };
}

/**
 * Whether the modal's discard link is inert: while the diff is loading there
 * is nothing to confirm against, with no changes there is nothing to lose,
 * and mid-discard a second click would race the first.
 *
 * @param {{patchLoading?: boolean, patchHasChanges?: boolean, discarding?: boolean}} state
 * @return {boolean}
 */
function modalDiscardDisabled({ patchLoading, patchHasChanges, discarding } = {}) {
	return Boolean(patchLoading || discarding || !patchHasChanges);
}

/**
 * Whether a discard may run at all right now. The same states that block
 * starting a trunk update block a discard, and for the same reason: both
 * rewrite the tree under whatever npm is doing to it, and a force checkout
 * under a running install, build or dev server leaves a tree neither side
 * finished.
 *
 * @param {{isUpdating?: boolean, installing?: boolean, building?: boolean,
 *          devServerActive?: boolean, discarding?: boolean}} state
 * @return {boolean}
 */
function discardBlocked({ isUpdating, installing, building, devServerActive, discarding } = {}) {
	return Boolean(isUpdating || installing || building || devServerActive || discarding);
}

module.exports = { changesNoteParts, discardOutcome, modalDiscardDisabled, discardBlocked, DISCARD_CONFIRM_MESSAGE };
