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

const { __, _n, sprintf } = require('@wordpress/i18n');

/**
 * What is asked before local changes are discarded, from the note, the review
 * or the question an update asks over edits: one action, so one question
 * wherever it is triggered from.
 *
 * @return {{title: string, description: string, confirm: string}} The question, and what its button says.
 */
function discardQuestion() {
	return {
		title: __('Discard all local changes?'),
		description: __('This can’t be undone.'),
		confirm: __('Discard changes')
	};
}

/**
 * What "Discard your changes" asks first (#669). It removes only the
 * contributor's own work, so the question says what stays: the applied patch,
 * or the checked-out pull request. A patch whose text was not kept cannot be
 * put back, and goes too; the question says that instead.
 *
 * @param {Object}  root0
 * @param {?number} [root0.editedCount]  The files the contributor changed, or null while unknown.
 * @param {?Object} [root0.appliedPatch] The applied patch, as site:status describes it: `{ label, kept }`.
 * @param {?Object} [root0.pullRequest]  The checked-out pull request, `{ number }`.
 * @return {{title: string, description: string, confirm: string}}
 */
function discardYourChangesQuestion({ editedCount = null, appliedPatch = null, pullRequest = null } = {}) {
	const sentences = [];
	if (Number.isInteger(editedCount) && editedCount > 0) {
		// translators: %d: how many files the contributor changed.
		sentences.push(sprintf(_n('Your edits to %d file are removed.', 'Your edits to %d files are removed.', editedCount), editedCount));
	}
	if (appliedPatch && appliedPatch.kept) {
		// translators: %s: the name of the applied patch, such as a file name.
		sentences.push(sprintf(__('The patch %s stays applied.'), appliedPatch.label));
	} else if (appliedPatch) {
		// translators: %s: the name of the applied patch, such as a file name.
		sentences.push(sprintf(__('The applied patch %s is removed too, because the app can’t put it back.'), appliedPatch.label));
	} else if (pullRequest) {
		// translators: %d: a pull request number.
		sentences.push(sprintf(__('PR #%d stays checked out.'), pullRequest.number));
	}
	sentences.push(__('This can’t be undone.'));
	return {
		title: __('Discard your changes?'),
		description: sentences.join(' '),
		confirm: __('Discard changes')
	};
}

// The branch namespaces a work item gets (#251): `ticket/` on a Core site,
// `issue/` on a Gutenberg one. Spelled out here rather than imported because
// ticket-branches.js, which owns the list, reaches for Git and cannot be
// bundled into the renderer; the test walks its WORK_ITEM_BRANCH_PREFIXES
// against this so the two cannot drift apart unnoticed.
const WORK_ITEM_BRANCH = /^(?:ticket|issue)\//;

/**
 * The changes note, or null when there is nothing to say. Where it renders
 * decides its shape.
 *
 * By the buttons (`placement: 'buttons'`) it is one sentence with its two
 * links marked in it: `<review>` opens the review, `<discard>` discards. The
 * component fills them in with `createInterpolateElement`, so each sentence
 * is whole for a translator. There the modal has not been named yet, so the
 * review link says what it produces: a patch.
 *
 * In the ticket card (`placement: 'ticket'`) it is a notice: a `title` that
 * says how much is waiting and for what, a `body` under it, and the words of
 * its review button (`review`); the discard button says `discardLabel()`.
 * The card already says where the changes are going, so the review button
 * borrows the modal's own name. The card also carries a reassurance the
 * buttons never need: Unlink sits right above, and the changes must not look
 * like they hang on it. That is its body; on top of a pull request the body
 * says where the changes go when the PR is reverted instead.
 *
 * `changedCount` can be missing: the dirty probe may have answered before a
 * count existed, and "You have changes" is still true then.
 *
 * `workItemNoun` is what the site calls its work item (#251), `ticket` unless
 * told otherwise; every line that names it is written once per kind.
 *
 * @param {{dirty?: boolean, changedCount?: number, tracTicket?: *, pullRequest?: Object, workItemNoun?: string}} state
 * @return {{placement: 'buttons', sentence: string}|{placement: 'ticket', title: string, body: string, review: string}|null}
 */
function changesNoteParts({ dirty, changedCount, tracTicket, pullRequest, workItemNoun = 'ticket' } = {}) {
	if (!dirty) return null;
	const count = Number.isInteger(changedCount) && changedCount > 0 ? changedCount : null;
	const issue = workItemNoun === 'issue';
	if (pullRequest && Number.isInteger(pullRequest.number)) {
		const hasReturnDestination = typeof pullRequest.returnTo === 'string' && pullRequest.returnTo.length > 0;
		const returnsToTicket = hasReturnDestination ? WORK_ITEM_BRANCH.test(pullRequest.returnTo) : Boolean(tracTicket);
		if (!returnsToTicket) return { placement: 'buttons', sentence: pullRequestChangesSentence({ count, number: pullRequest.number }) };
		return {
			placement: 'ticket',
			title: pullRequestChangesTitle({ count, number: pullRequest.number }),
			body: __("They stay with this pull request's local copy when you revert this PR."),
			review: __('Review changes')
		};
	}
	if (tracTicket) {
		return {
			placement: 'ticket',
			title: workItemChangesTitle({ count, issue, number: tracTicket }),
			review: __('Review and submit'),
			body: issue
				? __("Unlinking this issue doesn't affect your local changes for this issue — they remain attached to it in this site, ready for when you link it again.")
				: __("Unlinking this ticket doesn't affect your local changes for this ticket — they remain attached to it in this site, ready for when you link it again.")
		};
	}
	return { placement: 'buttons', sentence: unassignedChangesSentence({ count, issue }) };
}

/**
 * What the ticket card's discard button says: the same words as the
 * question's own button, since it is the same action, which keeps an applied
 * patch or a checked-out pull request (#669).
 *
 * @return {string} The label.
 */
function discardLabel() {
	return discardYourChangesQuestion().confirm;
}

// The card's title for changes on top of a checked-out pull request.
function pullRequestChangesTitle({ count, number }) {
	if (count === null) {
		// translators: %d: a pull request number.
		return sprintf(__('Changes on top of PR #%d'), number);
	}
	return sprintf(
		// translators: 1: how many files have changes. 2: a pull request number.
		_n('%1$d change on top of PR #%2$d', '%1$d changes on top of PR #%2$d', count),
		count,
		number
	);
}

// The card's title for changes on a linked ticket or issue.
function workItemChangesTitle({ count, issue, number }) {
	if (count === null && issue) {
		// translators: %s: a GitHub issue number.
		return sprintf(__('Unsubmitted changes for issue #%s'), number);
	}
	if (count === null) {
		// translators: %s: a Trac ticket number.
		return sprintf(__('Unsubmitted changes for ticket #%s'), number);
	}
	if (issue) {
		return sprintf(
			// translators: 1: how many files have changes. 2: a GitHub issue number.
			_n('%1$d unsubmitted change for issue #%2$s', '%1$d unsubmitted changes for issue #%2$s', count),
			count,
			number
		);
	}
	return sprintf(
		// translators: 1: how many files have changes. 2: a Trac ticket number.
		_n('%1$d unsubmitted change for ticket #%2$s', '%1$d unsubmitted changes for ticket #%2$s', count),
		count,
		number
	);
}

// The note's sentence for changes on top of a checked-out pull request.
function pullRequestChangesSentence({ count, number }) {
	if (count === null) {
		return sprintf(
			// translators: %d: a pull request number. <review> and <discard> are links.
			__("You have changes on top of PR #%d. You can <review>review them</review> or <discard>discard your changes</discard>. They stay with this pull request's local copy when you revert this PR."),
			number
		);
	}
	return sprintf(
		// translators: 1: how many files have changes. 2: a pull request number. <review> and <discard> are links.
		_n(
			"You have %1$d change on top of PR #%2$d. You can <review>review them</review> or <discard>discard your changes</discard>. They stay with this pull request's local copy when you revert this PR.",
			"You have %1$d changes on top of PR #%2$d. You can <review>review them</review> or <discard>discard your changes</discard>. They stay with this pull request's local copy when you revert this PR.",
			count
		),
		count,
		number
	);
}

// The note's sentence for changes that belong to nothing yet.
function unassignedChangesSentence({ count, issue }) {
	if (count === null && issue) {
		// translators: <review> and <discard> are links.
		return __('You have changes not assigned to any issue. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.');
	}
	if (count === null) {
		// translators: <review> and <discard> are links.
		return __('You have changes not assigned to any ticket. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.');
	}
	if (issue) {
		return sprintf(
			// translators: %d: how many files have changes. <review> and <discard> are links.
			_n(
				'You have %d change not assigned to any issue. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.',
				'You have %d changes not assigned to any issue. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.',
				count
			),
			count
		);
	}
	return sprintf(
		// translators: %d: how many files have changes. <review> and <discard> are links.
		_n(
			'You have %d change not assigned to any ticket. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.',
			'You have %d changes not assigned to any ticket. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.',
			count
		),
		count
	);
}

/**
 * How many files "Discard your changes" takes (#669): those under "Your
 * changes", and the applied patch's or pull request's own the contributor
 * edited since. Null while the list has not been walked.
 *
 * @param {{change: ?Object, yours: Array}} groups      From `changedFileGroups`.
 * @param {?Object}                         unsubmitted The `git:unsubmitted-work` reply the groups were made from.
 * @return {?number}
 */
function ownEditCount({ change, yours }, unsubmitted) {
	if (!unsubmitted) return null;
	return yours.length + (change ? change.files.filter((file) => file.alsoEdited).length : 0);
}

/**
 * What the toast says after a discard. "All" only when everything went as
 * asked: not when the patch or PR stayed, and not when a patch the
 * contributor asked to keep could not be put back, which the apply line
 * reports on its own.
 *
 * @param {Object}  outcome             A successful `discardOutcome`.
 * @param {Object}  root1
 * @param {?Object} [root1.pullRequest] The checked-out pull request.
 * @return {string}
 */
function discardToast(outcome, { pullRequest = null } = {}) {
	if (outcome.keptPatch || outcome.patchLost || pullRequest) return __('Your changes were discarded.');
	return __('All changes discarded.');
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
		// What happened to the applied patch (#669), when there was one.
		const patch = {};
		for (const key of ['keptPatch', 'removedPatch', 'patchLost']) {
			if (res[key] !== undefined) patch[key] = res[key];
		}
		return typeof res.dirty === 'boolean'
			? { ok: true, dirty: res.dirty, changedCount: res.changedCount, ...patch }
			: { ok: true, ...patch };
	}
	return {
		ok: false,
		message: sprintf(
			// translators: %s: why the discard failed, usually Git's own message in English.
			__('Failed to discard changes: %s'),
			res && res.error ? res.error : __('Unknown error')
		)
	};
}

/**
 * Apply-related feedback after attempting the destructive exit from a ticket.
 * A failure preserves the layer and the error that explains why it remains;
 * success clears both because the ticket is back at its base, unless the
 * discard kept the patch (#669), whose banner then stays. A patch that could
 * not be put back is said, since the contributor asked for it to stay.
 *
 * @param {{ok?: boolean}} outcome The discard result.
 * @param {*}              current The apply feedback currently on screen.
 * @return {*}
 */
function applyFeedbackAfterDiscard(outcome, current) {
	if (!outcome || !outcome.ok) return current;
	let applyError = '';
	if (outcome.patchLost) {
		// translators: %s: the name of the patch, such as a file name.
		applyError = sprintf(__('Your changes were discarded, but %s could not be put back, so it is no longer applied.'), outcome.removedPatch);
	}
	const appliedPatch = outcome.keptPatch && current ? current.appliedPatch : null;
	return { appliedPatch, applyError, applyConflict: null, applyNotice: '' };
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
 * `nothingOfYours` is a kept patch or pull request with none of the
 * contributor's work on top (#669): the discard would remove nothing.
 *
 * @param {{patchLoading?: boolean, patchLoadFailed?: boolean, patchHasChanges?: boolean,
 *          nothingOfYours?: boolean, isUpdating?: boolean, installing?: boolean, building?: boolean,
 *          devServerActive?: boolean, discarding?: boolean}} state
 * @return {string|null}
 */
function discardDisabledReason({ patchLoading, patchLoadFailed, patchHasChanges, nothingOfYours, isUpdating, installing, building, devServerActive, discarding } = {}) {
	if (discarding) return __('Changes are already being discarded.');
	if (patchLoading) return __('Wait for your changes to finish loading.');
	if (patchLoadFailed) return __('Changes could not be loaded.');
	if (!patchHasChanges) return __('There are no changes to discard.');
	if (nothingOfYours) return __('There are no edits of yours to discard.');
	if (isUpdating) return __('Wait for the trunk update to finish before discarding changes.');
	if (installing) return __('Wait for the installation to finish before discarding changes.');
	if (building) return __('Wait for the build to finish before discarding changes.');
	if (devServerActive) return __('Stop the dev server before discarding changes.');
	return null;
}

// The heading over a linked work item's changes, one sentence per kind
// (`workItemNoun` as in changesNoteParts).
function workItemChangesHeading(workItemNoun, number) {
	// translators: %d: a GitHub issue number.
	if (workItemNoun === 'issue') return sprintf(__('Your changes for issue #%d'), number);
	// translators: %d: a Trac ticket number.
	return sprintf(__('Your changes for ticket #%d'), number);
}

// The review always names the base used to measure the displayed changes.
function patchReviewContext({ pullRequest, tracTicket, workItemNoun = 'ticket' } = {}) {
	if (pullRequest) return {
		// translators: %d: a pull request number.
		heading: sprintf(__('Your changes on top of PR #%d'), pullRequest.number),
		description: __('Edits to this local copy, compared with the original PR commits.'),
		// translators: %d: a pull request number.
		empty: sprintf(__('There are no changes on top of PR #%d.'), pullRequest.number)
	};
	return {
		heading: tracTicket ? workItemChangesHeading(workItemNoun, tracTicket) : __('Your changes'),
		description: __('Everything this site has that its copy of trunk does not.'),
		empty: __('There is nothing to send yet — this site has no changes against its copy of trunk.')
	};
}

module.exports = { patchReviewContext, changesNoteParts, discardLabel, discardOutcome, applyFeedbackAfterDiscard, noteAfterDiscard, noteAfterProbe, discardBlocked, discardDisabledReason, discardQuestion, discardYourChangesQuestion, ownEditCount, discardToast };
