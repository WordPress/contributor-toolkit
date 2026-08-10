// What the window says when a folder will not open.
//
// There were two of these. The editor menu grew a real one in #209 — a branch
// per reason, each saying what the contributor can do next — while revealing
// the folder in the file manager kept the string it shipped with: the `error`
// field, or the words "unknown error" when there was none.
//
// A refusal is precisely the case with no `error` field: main declined on
// purpose and returned a `reason` instead. So the failure the app understood
// best was the one it described as unknown, which is #180 as the contributor
// meets it — a button that does nothing, explained by a sentence that explains
// nothing.
//
// Pure and dependency-free for the same reason as setup-steps.cjs: the renderer
// bundle imports it, `node --test` requires it directly, and neither needs a DOM.
'use strict';

// An OS-supplied message is quoted rather than replaced — it is the only part of
// these failures the app did not write, and usually the only part that says
// which of a dozen things went wrong.
//
// "unknown error" as the fallback is #209's wording, kept deliberately. Here it
// is honest: the attempt failed and nothing came back to say why. What #180 was
// about is the opposite case — a refusal, where the app knows exactly why and
// has a `reason` — and that never reaches this function's fallback.
function quote(error) {
	const text = typeof error === 'string' ? error.trim() : '';
	return text || 'unknown error';
}

/**
 * The sentence for a failed attempt to open a site's folder.
 *
 * `picked` says which of the two situations 'unlaunchable-editor' is: an
 * application detection offered that has since moved, or one the contributor
 * just pointed at that is not an application at all. Main cannot tell them
 * apart — the guard is the same — but the caller knows which it asked for, and
 * the two need different next steps.
 *
 * @param {Object}  result           What the main process returned.
 * @param {Object}  [options]
 * @param {boolean} [options.picked]
 * @return {string}
 */
function describeOpenFailure(result, { picked = false } = {}) {
	if (result?.reason === 'unlaunchable-editor') {
		return picked
			? 'That is not an application this app can open a folder in.'
			: 'That application is no longer where it was. Choose another.';
	}
	if (result?.reason === 'unknown-editor') {
		return 'That application is no longer where it was. Choose another.';
	}
	if (result?.reason === 'spawn-failed') {
		return `The application would not start: ${quote(result.error)}`;
	}
	// The file manager's own refusal, from `shell.openPath` — a different verb
	// from the editor's, and the one case here that carries the OS's message.
	if (result?.reason === 'open-failed') {
		return `The file manager would not open the folder: ${quote(result.error)}`;
	}
	if (result?.reason === 'unregistered-site') {
		return 'This app has no record of that folder, so it will not open it.';
	}
	if (result?.reason === 'unavailable') {
		return `Could not reach the app's main process: ${quote(result.error)}`;
	}
	// Both callers share this now, so it says nothing about an application —
	// "could not open it in an application" is not what happened when the file
	// manager is what failed.
	return 'Could not open the folder.';
}

// The reasons another application is a way out of. The notice's only affordance
// is "Choose application…", and beside the other reasons it is a dead end that
// looks like a fix: `openSiteInEditor` checks the folder before it looks at the
// editor (see editor-launch.js), so answering a refused *folder* by picking a
// different application returns the identical sentence.
const PICKING_HELPS = new Set(['unlaunchable-editor', 'unknown-editor', 'spawn-failed']);

/**
 * The whole notice for an attempt to open a site's folder, or null when there
 * is nothing to say.
 *
 * This, rather than `describeOpenFailure`, is what the window calls. The two
 * callers used to decide separately whether there was a failure at all and what
 * to render beside it, which is how one of them ended up printing its own
 * "unknown error" for a refusal that had a perfectly good reason (#180). One
 * function means one answer.
 *
 * A closed dialog is not a failure: saying something about it would be the app
 * arguing with a decision the contributor just made.
 *
 * @param {Object}  result           What the main process returned.
 * @param {Object}  [options]
 * @param {boolean} [options.picked]
 * @return {?{message: string, offerPicker: boolean}}
 */
function noticeForOpenResult(result, { picked = false } = {}) {
	if (result?.ok || result?.reason === 'cancelled') return null;

	return {
		message: describeOpenFailure(result, { picked }),
		offerPicker: PICKING_HELPS.has(result?.reason)
	};
}

module.exports = { describeOpenFailure, noticeForOpenResult };
