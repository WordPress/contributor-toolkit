'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');

// Shared by the IPC refusals and the Apply panel; no Electron or Git imports.
//
// `returnTo` is a work-item branch under either namespace (#251,
// ticket-branches.js): `ticket/N` on a Core site, `issue/N` on a Gutenberg
// one. `noun` is what that site calls it, `ticket` unless told otherwise, and
// chooses the sentence rather than going into one. The headline is not here:
// it follows the build watch, so `appliedBannerState` in watch-activity.cjs
// owns it (#509).
function describePrCheckout({ returnTo, hasEdits = false, noun = 'ticket' }) {
	const workItem = /^(?:ticket|issue)\/(\d+)$/.exec(returnTo || '');
	let body = __('Reverting this PR returns to trunk.');
	if (workItem) {
		body = noun === 'issue'
			? __('Your issue changes are saved separately and return when you revert this PR.')
			: __('Your ticket changes are saved separately and return when you revert this PR.');
	}
	return {
		body,
		edits: hasEdits
			? __('Your edits here stay with your local copy of the PR.')
			: __('Edits you make here stay with your local copy of the PR.'),
		backLabel: __('Revert this PR')
	};
}

function prSubmissionRefusal(number) {
	// translators: %d: a pull request number.
	return sprintf(__("PR #%d is applied. Its author's commits are this checkout's history, so it cannot be submitted as your work. Revert this PR first."), number);
}

/**
 * Why the pull request card will not submit this checkout, as the sentence it
 * shows in place of everything else, or '' when it will.
 *
 * Someone else's pull request comes first: while one is checked out, a patch
 * applied on top of it is the smaller fact, and reverting the pull request is
 * the way out of both.
 *
 * @param {Object}  state
 * @param {?Object} state.pullRequest         The pull request checked out, if one is.
 * @param {?Object} state.appliedPatch        The patch applied to the checkout, if one is.
 * @param {string}  [state.appliedPatchLabel] What the app calls that patch, if it has a name.
 * @return {string}
 */
function prSubmissionBlocked({ pullRequest, appliedPatch, appliedPatchLabel }) {
	if (pullRequest) return prSubmissionRefusal(pullRequest.number);
	if (appliedPatch && appliedPatchLabel) {
		// translators: %s: the name of an applied patch, such as a file name.
		return sprintf(__('Revert %s before opening a pull request from this checkout.'), appliedPatchLabel);
	}
	if (appliedPatch) return __('Revert the patch you applied before opening a pull request from this checkout.');
	return '';
}

// Called in main as well as in the renderer: main words the refusal for the
// terminal and the done event, and the renderer words the ones it meets on a
// preview. An unknown code keeps the error it came with, which main has
// already worded.
function prCheckoutRefusal({ code, number, error }) {
	switch (code) {
		case 'pr-has-edits':
			// translators: %d: a pull request number.
			return sprintf(__('PR #%d has moved on GitHub and your copy has edits on top. Discard those edits before updating it, or keep the copy you have.'), number);
		case 'pr-branch-exists':
			// translators: %d: a pull request number, which is also part of the branch name pr/%d.
			return sprintf(__('This site already has a branch named pr/%d that the app did not make. Rename or delete that branch from a terminal before trying again.'), number);
		case 'already-checked-out':
			// translators: %d: a pull request number.
			return sprintf(__('PR #%d is already checked out. Revert it before applying it again.'), number);
		case 'bad-pr-number': return __('Enter a positive whole pull request number.');
		case 'not-on-pr': return __('No pull request is checked out on this site.');
		case 'no-pr-head': return __('This pull request has no recorded starting point, so the app cannot safely save its edits. Save a patch before changing branches.');
		default: return error || __('Could not switch this pull request. Check the log and try again.');
	}
}

function describePrPreview({ number, files = [], needsInstall = false, exists = false, moved = false, hasEdits = false, state = null }) {
	const count = files.length;
	// translators: 1: a pull request number. 2: how many files it changes.
	let headline = sprintf(_n('PR #%1$d changes %2$d file.', 'PR #%1$d changes %2$d files.', count), number, count);
	if (exists && hasEdits && moved) {
		// translators: %d: a pull request number.
		headline = sprintf(__('PR #%d has moved on GitHub, but your copy has edits on top.'), number);
	} else if (exists && moved) {
		// translators: %d: a pull request number.
		headline = sprintf(__('PR #%d has moved on GitHub; your local copy will be updated.'), number);
	} else if (exists) {
		// translators: %d: a pull request number.
		headline = sprintf(__('PR #%d is already on this site; you will switch to your local copy.'), number);
	}
	return {
		headline,
		actionLabel: exists && moved && hasEdits ? __('Return to saved copy') : __('Apply and rebuild'),
		closedNote: state === 'closed' ? __('This pull request is closed. You can still check out its last head to investigate it.') : '',
		// translators: %s: the name of a file, package-lock.json.
		installNote: needsInstall ? sprintf(__('It changes %s, so dependencies will be installed before the rebuild.'), 'package-lock.json') : ''
	};
}

module.exports = { describePrCheckout, describePrPreview, prSubmissionRefusal, prSubmissionBlocked, prCheckoutRefusal };
