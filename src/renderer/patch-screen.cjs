'use strict';

/**
 * Which moment the patch screen is in, and what it says while it lasts
 * (issue #190, part of #186).
 *
 * Choosing a destination, signing in, watching the pull request happen and
 * reading its outcome are four different moments, and the screen used to show
 * all of them at once. Deriving the moment from the flow's own state — rather
 * than tracking a separate "screen" variable alongside it — means the two can
 * never disagree about where the contributor is.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM (same convention as update-plan.cjs and trac-ticket.cjs).
 */

/**
 * The moment the screen is in, from the pull request flow's state.
 *
 * The order the checks run in is the order the contributor experiences: an
 * outcome outranks a stage, a stage outranks a code, a code outranks the
 * chooser. It has to be, because the flow leaves state briefly overlapping —
 * a failure is recorded before the stage is cleared, and reading the stage
 * first would flash "opening the pull request" over a request that already
 * failed.
 *
 * A sign-in that fails is deliberately not a moment of its own: it clears the
 * code and returns to the chooser, where the error sits on the destination it
 * belongs to. Only the pull request itself gets a failure screen, because only
 * it can fail after the contributor has stopped watching.
 *
 * @param {Object} root0
 * @param {Object} [root0.prResult]   The opened pull request, once there is one.
 * @param {Object} [root0.prError]    Why the attempt failed.
 * @param {string} [root0.prStage]    The stage the attempt is in, while it runs.
 * @param {Object} [root0.deviceCode] The one-time code, while GitHub waits for it.
 * @return {string} 'choose' | 'signin' | 'working' | 'done' | 'failed'
 */
function patchScreenStep({ prResult, prError, prStage, deviceCode } = {}) {
	if (prResult) return 'done';
	if (prError) return 'failed';
	if (prStage) return 'working';
	if (deviceCode) return 'signin';
	return 'choose';
}

// Why it failed, in a sentence that says what to do about it, and the heading
// that moment is given. Title and message live together so they cannot drift
// into contradicting each other — the heading names the cause, the message
// names the way out, and every one of them still leaves the patch file.
const PR_FAILURES = {
	unauthorized: {
		title: 'That sign-in is no longer valid',
		message: 'That GitHub sign-in is no longer valid. Sign in again, or save the patch file instead.'
	},
	'rate-limited': {
		title: 'GitHub is rate limiting',
		message: 'GitHub is rate-limiting this connection. It usually clears within the hour.'
	},
	offline: {
		title: 'No connection to GitHub',
		message: 'No connection to GitHub.'
	},
	'no-ticket': {
		title: 'No ticket is linked',
		message: 'Link a Trac ticket to this site first — a pull request has to cite one.'
	},
	empty: {
		title: 'There is nothing to send',
		message: 'There are no changes to open a pull request with.'
	}
};

const DEFAULT_FAILURE_TITLE = 'The pull request was not opened';

/**
 * What the screen says in this moment: the heading naming it, the line under
 * the heading saying what is still safe, the footer note, and the way back out.
 *
 * The reassurance is repeated in every state rather than stated once at the
 * top, because the state where a contributor most needs to hear that the patch
 * file is untouched is the one where they are least able to go looking for it.
 *
 * `backLabel` is empty where there is nothing to go back to: the chooser is
 * already the way out, and an attempt in flight cannot be called off — the
 * fork and the branch are already being written.
 *
 * @param {Object}  root0
 * @param {string}  root0.step
 * @param {boolean} [root0.dryRun]        The attempt stopped before opening a pull request.
 * @param {string}  [root0.failureReason] `reason` from the failed attempt.
 * @return {{heading: string, subheading: string, footerNote: string, backLabel: string}}
 */
function patchScreenCopy({ step, dryRun = false, failureReason = '' } = {}) {
	if (step === 'signin') {
		return {
			heading: 'Sign in to GitHub',
			subheading: 'In your browser, with a one-time code. No password is typed into this app.',
			footerNote: 'Declining costs nothing — the patch file stays exactly where it is.',
			backLabel: 'Not now'
		};
	}
	if (step === 'working') {
		return {
			heading: 'Opening the pull request',
			subheading: 'The patch file is already saved. Nothing here can lose it.',
			footerNote: 'This runs through the GitHub API. No push credential is written to disk.',
			backLabel: ''
		};
	}
	if (step === 'done') {
		// A dry run stops after the branch, so the heading that names the pull
		// request would be the screen lying about what happened — the exact
		// failure the test-mode indicator exists to prevent.
		return {
			heading: dryRun ? 'Branch pushed — dry run' : 'Pull request opened',
			subheading: dryRun
				? 'No pull request was opened. The branch is on your fork.'
				: 'One step left: the ticket does not know about it yet.',
			footerNote: 'Props are recorded on the ticket, not on the pull request.',
			backLabel: 'Back to destinations'
		};
	}
	if (step === 'failed') {
		return {
			heading: (PR_FAILURES[failureReason] || {}).title || DEFAULT_FAILURE_TITLE,
			subheading: 'Your patch is untouched. Every other destination is still open.',
			footerNote: 'You can try the pull request again at any time.',
			backLabel: 'Pick another destination'
		};
	}
	return {
		heading: 'Where this patch goes',
		subheading: 'Nothing is uploaded and no account is asked for until you continue.',
		footerNote: '',
		backLabel: ''
	};
}

/**
 * The account the panel should hold after signing in, signing out, or having an
 * authorization revoked under it.
 *
 * Every one of those replaces the account wholesale, and the test mode used to
 * go with it (#197): it is reported alongside the login but it does not belong
 * to it — it comes from an env switch the main process reads once, so it is
 * true for the whole run whoever is signed in. Losing it meant the card stopped
 * saying "dry run" at exactly the point the button could push something, and
 * the button went back to promising a pull request it would not open.
 *
 * An explicit `testMode` on the incoming account still wins; only an absent one
 * is filled in from what was already known.
 *
 * @param {Object} [previous] The account the panel holds now.
 * @param {Object} next       The account it is moving to.
 * @return {Object}
 */
function carryTestMode(previous, next) {
	const account = { ...next };
	if (account.testMode === undefined && previous && previous.testMode !== undefined) {
		account.testMode = previous.testMode;
	}
	return account;
}

/**
 * The sentence explaining a failed attempt. Falls back to whatever the flow
 * reported: an unrecognised reason is still worth showing, because the
 * alternative is a heading with nothing under it.
 *
 * @param {Object} [prError]
 * @return {string}
 */
function prFailureMessage(prError) {
	if (!prError) return '';
	return (PR_FAILURES[prError.reason] || {}).message || prError.error || '';
}

module.exports = {
	PR_FAILURES,
	DEFAULT_FAILURE_TITLE,
	patchScreenStep,
	patchScreenCopy,
	carryTestMode,
	prFailureMessage
};
