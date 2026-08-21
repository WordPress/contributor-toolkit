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
 * Apply-related feedback after attempting the destructive exit from a ticket.
 * A failure preserves the layer and the error that explains why it remains;
 * success clears both because the ticket is back at its base.
 *
 * @param {{ok?: boolean}} outcome The discard result.
 * @param {*}              current The apply feedback currently on screen.
 * @return {*}
 */
function applyFeedbackAfterDiscard(outcome, current) {
	if (!outcome || !outcome.ok) return current;
	return { appliedPatch: null, applyError: '', applyConflict: null, applyNotice: '' };
}

/**
 * What the note shows in the frame straight after a discard, before any probe
 * has walked the checkout again.
 *
 * The reply's own recount decides it (#239): a discard rewinds to the last
 * park, and on a ticket branch the parked WIP is not the discard's to take —
 * so "clean" is only true when the reply says so. A reply carrying no recount
 * falls back to clean, which is what this asserted before the recount existed;
 * the next probe corrects it either way.
 *
 * @param {*} outcome A `discardOutcome` result.
 * @return {{dirty: boolean, changedCount: number}}
 */
function noteAfterDiscard(outcome) {
	if (!outcome || !outcome.ok || typeof outcome.dirty !== 'boolean') {
		return { dirty: false, changedCount: 0 };
	}
	return {
		dirty: outcome.dirty,
		changedCount: Number.isInteger(outcome.changedCount) ? outcome.changedCount : 0
	};
}

/**
 * What a completed probe may leave on the card.
 *
 * A failed measurement clears the previous answer. Keeping an old count would
 * present it as current even when the app has just learned that it cannot read
 * the ticket's base (#308).
 *
 * @param {*} _current The note shown while the probe was running.
 * @param {*} result   A `git:unsubmitted-work` reply.
 * @return {{dirty: boolean, changedCount: *}|null}
 */
function noteAfterProbe(_current, result) {
	if (!result || !result.ok) return null;
	return { dirty: Boolean(result.dirty), changedCount: result.changedCount };
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

/**
 * The explanation shown when the modal's discard action is unavailable.
 *
 * One operation can leave several guards true while state settles. Report the
 * action already underway first, then the transient patch state, and finally
 * the process the contributor can stop or wait for.
 *
 * @param {{patchLoading?: boolean, patchLoadFailed?: boolean, patchHasChanges?: boolean,
 *          isUpdating?: boolean, installing?: boolean, building?: boolean,
 *          devServerActive?: boolean, discarding?: boolean}} state
 * @return {string|null}
 */
function discardDisabledReason({ patchLoading, patchLoadFailed, patchHasChanges, isUpdating, installing, building, devServerActive, discarding } = {}) {
	if (discarding) return 'Changes are already being discarded.';
	if (patchLoading) return 'Wait for your changes to finish loading.';
	if (patchLoadFailed) return 'Changes could not be loaded.';
	if (!patchHasChanges) return 'There are no changes to discard.';
	if (isUpdating) return 'Wait for the trunk update to finish before discarding changes.';
	if (installing) return 'Wait for the installation to finish before discarding changes.';
	if (building) return 'Wait for the build to finish before discarding changes.';
	if (devServerActive) return 'Stop the dev server before discarding changes.';
	return null;
}

module.exports = { changesNoteParts, discardOutcome, applyFeedbackAfterDiscard, noteAfterDiscard, noteAfterProbe, discardBlocked, discardDisabledReason, DISCARD_CONFIRM_MESSAGE };
