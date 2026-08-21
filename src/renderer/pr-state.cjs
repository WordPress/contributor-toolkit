// The colours a linked pull request's state is shown in (#227).
//
// The state used to render as grey text the same weight as the date beside it,
// separated by a middle dot, so the one word that says what happened to the
// work read as part of the timestamp. Colour makes the outcome legible at a
// glance — GitHub's own three, so the pill matches what the contributor sees
// after clicking through to the pull request itself.
//
// Two rules the colours are chosen under:
//
// - The colour accompanies the word, never replaces it. A bare dot tells
//   someone who cannot separate red from green less than the plain text did.
// - Red means "something failed" everywhere else in this window — a half-done
//   update, an error banner. A closed pull request is not a failure, so the
//   closed pill deliberately uses GitHub's red (#ffebe9/#82071e) rather than
//   this app's error pair (#fcf0f1 on a #d63638 border), and wears the same
//   borderless pill shape as the "Latest" marker instead of the bordered,
//   alert-shaped box the errors use.
'use strict';

// GitHub's light-theme state colours: the subtle background and the text
// foreground of each state's own label.
const PR_STATE_BADGES = {
	open: { label: 'open', background: '#dafbe1', color: '#116329' },
	merged: { label: 'merged', background: '#f5e8ff', color: '#6639ba' },
	closed: { label: 'closed', background: '#ffebe9', color: '#82071e' }
};

/**
 * The label and colours for one pull request's state.
 *
 * An unrecognised state reads as open, which is what the row has always done —
 * a list cached by an older build carries only `open` and `closed`, and
 * anything that is not closed has always been shown as open rather than
 * dropped or left blank.
 *
 * @param {string} state
 * @return {{label: string, background: string, color: string}}
 */
function prStateBadge(state) {
	const key = typeof state === 'string' ? state.toLowerCase() : '';
	return PR_STATE_BADGES[key] || PR_STATE_BADGES.open;
}

module.exports = { PR_STATE_BADGES, prStateBadge };
