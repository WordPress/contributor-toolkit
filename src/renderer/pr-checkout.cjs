'use strict';

// Shared by the IPC refusals and the Apply panel; no Electron or Git imports.
//
// `returnTo` is a work-item branch under either namespace (#251,
// ticket-branches.js): `ticket/N` on a Core site, `issue/N` on a Gutenberg
// one. `noun` is what that site calls it, `ticket` unless told otherwise. The
// headline is not here: it follows the build watch, so `appliedBannerState`
// in watch-activity.cjs owns it (#509).
function describePrCheckout({ returnTo, hasEdits = false, noun = 'ticket' }) {
	const workItem = /^(?:ticket|issue)\/(\d+)$/.exec(returnTo || '');
	return {
		body: workItem
			? `Your ${noun} changes are saved separately and return when you revert this PR.`
			: 'Reverting this PR returns to trunk.',
		edits: hasEdits
			? 'Your edits here stay with your local copy of the PR.'
			: 'Edits you make here stay with your local copy of the PR.',
		backLabel: 'Revert this PR'
	};
}

function prSubmissionRefusal(number) {
	return `PR #${number} is applied. Its author's commits are this checkout's history, so it cannot be submitted as your work. Revert this PR first.`;
}

function prCheckoutRefusal({ code, number, error }) {
	switch (code) {
		case 'pr-has-edits': return `PR #${number} has moved on GitHub and your copy has edits on top. Discard those edits before updating it, or keep the copy you have.`;
		case 'pr-branch-exists': return `This site already has a branch named pr/${number} that the app did not make. Rename or delete that branch from a terminal before trying again.`;
		case 'already-checked-out': return `PR #${number} is already checked out. Revert it before applying it again.`;
		case 'bad-pr-number': return 'Enter a positive whole pull request number.';
		case 'not-on-pr': return 'No pull request is checked out on this site.';
		case 'no-pr-head': return 'This pull request has no recorded starting point, so the app cannot safely save its edits. Save a patch before changing branches.';
		default: return error || 'Could not switch this pull request. Check the log and try again.';
	}
}

function describePrPreview({ number, files = [], needsInstall = false, exists = false, moved = false, hasEdits = false, state = null }) {
	const count = files.length;
	let headline = `PR #${number} changes ${count} file${count === 1 ? '' : 's'}.`;
	if (exists && hasEdits && moved) headline = `PR #${number} has moved on GitHub, but your copy has edits on top.`;
	else if (exists && moved) headline = `PR #${number} has moved on GitHub; your local copy will be updated.`;
	else if (exists) headline = `PR #${number} is already on this site; you will switch to your local copy.`;
	return {
		headline,
		actionLabel: exists && moved && hasEdits ? 'Return to saved copy' : 'Apply and rebuild',
		closedNote: state === 'closed' ? 'This pull request is closed. You can still check out its last head to investigate it.' : '',
		installNote: needsInstall ? 'It changes package-lock.json, so dependencies will be installed before the rebuild.' : ''
	};
}

module.exports = { describePrCheckout, describePrPreview, prSubmissionRefusal, prCheckoutRefusal };
