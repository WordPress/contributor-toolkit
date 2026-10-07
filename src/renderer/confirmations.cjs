'use strict';

/**
 * The queue behind the app's "that worked" confirmations (#253).
 *
 * Actions used to complete silently, or leave an inline sentence the
 * contributor may not be looking at, and none of the success notices reached a
 * screen reader. This is the one place a completed action is confirmed: a
 * transient message that the toast stack renders and speaks (#557). The
 * reducer holds the list; the renderer only dispatches and paints. What the
 * messages say is here too, where a branch or a value chooses it.
 *
 * Kept as a pure module so it can be unit tested without a DOM: the renderer
 * bundle imports it, `node --test` requires it directly. The `id` comes from a
 * running counter rather than a timestamp or random value so the reducer
 * stays deterministic under test.
 *
 * Tone drives accessibility, not just colour:
 *   - `success` speaks politely and clears itself on a timer — a confirmation
 *     the contributor does not have to act on.
 *   - `error` speaks assertively and stays until dismissed, so it is not gone
 *     before it has been read. Supported here so successes and errors can share
 *     one mechanism (#253). The first error emitter is the site deletion
 *     that half-happened (#381).
 */

const { __, sprintf } = require('@wordpress/i18n');

// At most this many confirmations are kept on screen at once. A burst — a
// double-click, a chain of steps finishing together — collapses to the most
// recent few rather than stacking into a wall.
const MAX_NOTICES = 3;

const initialConfirmations = { seq: 0, notices: [] };

function politenessFor(tone) {
	return tone === 'error' ? 'assertive' : 'polite';
}

/**
 * @param {Object} state  The queue: `{ seq, notices }`.
 * @param {Object} action `{ type: 'add', content, tone }` or `{ type: 'remove', id }`.
 */
function confirmationReducer(state = initialConfirmations, action = {}) {
	switch (action.type) {
		case 'add': {
			const content = action.content;
			// Nothing to announce, nothing to queue.
			if (!content) return state;
			const tone = action.tone === 'error' ? 'error' : 'success';

			// Ignore a repeat of what is already on top: a double-click on Save
			// should read as one confirmation, not two identical ones.
			const newest = state.notices[state.notices.length - 1];
			if (newest && newest.content === content && newest.tone === tone) {
				return state;
			}

			const seq = state.seq + 1;
			const notice = {
				id: seq,
				content,
				tone,
				politeness: politenessFor(tone),
				explicitDismiss: tone === 'error'
			};
			const notices = [...state.notices, notice].slice(-MAX_NOTICES);
			return { seq, notices };
		}
		case 'remove': {
			const notices = state.notices.filter((n) => n.id !== action.id);
			// Referential stability matters to React: an id that matched nothing
			// should not hand back a fresh array and a needless re-render.
			if (notices.length === state.notices.length) return state;
			return { seq: state.seq, notices };
		}
		default:
			return state;
	}
}

/**
 * The confirmation line for a completed pull-request attempt (#253). A dry run
 * (WP_DEV_ENV_GITHUB_DRY_RUN) stops after the branch and opens no request, so it
 * says so rather than announcing a "pull request #undefined". Kept here, beside
 * the rest of the confirmation logic, because it is a user-read string chosen by
 * a branch — the kind that must not live untested in index.jsx.
 *
 * @param {{ ok?: boolean, dryRun?: boolean, number?: number, url?: string }} res The main process's result.
 */
function prConfirmationMessage(res = {}) {
	if (res.dryRun) return __('Dry run — branch created, no pull request opened');
	// Named because two repositories are possible now (#251): a number alone
	// does not say whether it landed on wordpress-develop or gutenberg. Read
	// from the pull request's own URL, not from the site's type: with the
	// sandbox override set the two differ, and the URL is where it went.
	const match = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/.exec(String(res.url || ''));
	// translators: 1: the number of a pull request. 2: the repository it was opened on, such as WordPress/gutenberg.
	if (match) return sprintf(__('Opened pull request #%1$s on %2$s'), res.number, match[1]);
	// translators: %s: the number of a pull request.
	return sprintf(__('Opened pull request #%s'), res.number);
}

/**
 * The notice for a site deletion, or null when there is nothing to say (#381).
 *
 * Only a failure speaks. The registry entry now stays in place until the folder
 * is gone, so the message says the deletion can be retried after the contributor
 * releases whatever still holds the directory. It names the path and carries
 * the error code because "could not be deleted" without either is the kind of
 * report a mentor cannot act on.
 *
 * @param {{ ok?: boolean, reason?: string, path?: string, code?: string }} res The main process's result.
 */
function deleteFailureMessage(res = {}) {
	if (res.ok !== false || res.reason !== 'remove-failed') return null;
	if (res.code) {
		// translators: 1: an error code of the system, such as EBUSY. 2: the path of a folder.
		return sprintf(__('The site is still listed because its folder could not be deleted (%1$s). Close anything using it, then try again. Folder: %2$s'), res.code, res.path);
	}
	// translators: %s: the path of a folder.
	return sprintf(__('The site is still listed because its folder could not be deleted. Close anything using it, then try again. Folder: %s'), res.path);
}

/**
 * The notice for a site that could not be set up (#557): that it could not,
 * and what went wrong, as it was reported. The setup runs for minutes after
 * the dialog that asked for it has closed, so this is the one place its
 * failure is said.
 *
 * @param {*} error What the setup was rejected with.
 * @return {string} The sentence.
 */
function setupFailureMessage(error) {
	// translators: %s: what went wrong, as the system reported it.
	return sprintf(__('The site could not be created. %s'), String(error));
}

/**
 * The line the setup log gets for a status from main: one sentence per phase,
 * since the phase itself is a code. A phase this version does not know is
 * still a status.
 *
 * @param {string} [phase] The phase main reported, 'cloning' or 'done'.
 * @return {string} The sentence.
 */
function setupStatusLine(phase) {
	switch (phase) {
		case 'cloning': return __('Status: cloning');
		case 'done': return __('Status: done');
		default: return __('Status update');
	}
}

/**
 * What the terminal says as the setup chain ends, for the way it ended
 * (`setupOutcome` in update-plan.cjs): each names where the rest of the work
 * now lives. Empty for an outcome this version does not know.
 *
 * @param {string} outcome 'done', 'stopped', 'failed-install' or 'failed-build'.
 * @return {string} The sentence, or ''.
 */
function setupEndMessage(outcome) {
	switch (outcome) {
		case 'done': return __('Setup complete — start the dev server when you are ready.');
		case 'stopped': return __('Setup stopped. The remaining steps are in the checklist above — run them whenever you are ready.');
		case 'failed-install':
			// translators: %s: the command that installs dependencies, npm install.
			return sprintf(__('%s failed — setup stopped here. Its output is above; retry the install from the checklist.'), 'npm install');
		case 'failed-build': return __('The build failed — dependencies are installed. Its output is above; retry the build from the checklist.');
		default: return '';
	}
}

/**
 * What a Copy button says about the press just made.
 *
 * @param {string} [state] 'copied', 'failed', or anything else for not yet pressed.
 * @return {string} The label.
 */
function copyButtonLabel(state) {
	switch (state) {
		case 'copied': return __('Copied');
		case 'failed': return __('Could not copy');
		default: return __('Copy');
	}
}

/**
 * The confirmation for a patch or a pull request that is in the checkout and
 * built, or taken back out. The apply flow names what it did with a verb and
 * a noun, which it also prints in the terminal; here each pair it has is a
 * sentence of its own, so that it can be translated whole.
 *
 * @param {string} verb 'Applied', 'Reverted', 'Checked out' or 'Restored'.
 * @param {string} noun 'patch', 'pull request', 'previous branch' or 'saved work'.
 * @return {string} The sentence.
 */
function applyDoneMessage(verb, noun) {
	const sentences = {
		'Applied patch': __('Applied the patch'),
		'Reverted patch': __('Reverted the patch'),
		'Checked out pull request': __('Checked out the pull request'),
		'Restored previous branch': __('Restored the previous branch'),
		'Restored saved work': __('Restored the saved work')
	};
	return sentences[`${verb} ${noun}`] || `${verb} the ${noun}`;
}

/**
 * The confirmation for a patch saved to a file.
 *
 * @param {string} fileName The file's name, without its folder.
 * @return {string} The sentence.
 */
function patchSavedMessage(fileName) {
	// translators: %s: the name of a file.
	return sprintf(__('Patch saved to %s'), fileName);
}

/**
 * The confirmation for edits saved to a file before trunk was updated over
 * them.
 *
 * @param {string} fileName The file's name, without its folder.
 * @return {string} The sentence.
 */
function savedAndResetMessage(fileName) {
	// translators: %s: the name of a file.
	return sprintf(__('Saved your changes to %s and reset the working tree'), fileName);
}

// How long a confirmation that clears itself is on screen: what the
// snackbars before it had (#253).
const TOAST_LIFETIME_MS = 6000;

/**
 * How a confirmation is drawn as a toast: the notice's colour, and how long
 * it stays. One that has to be dismissed stays until it is.
 *
 * @param {Object} notice A notice of the queue: `{ tone, explicitDismiss }`.
 * @return {{intent: string, lifetime: ?number}} The notice's intent, and its lifetime in milliseconds or null.
 */
function toastView(notice = {}) {
	return {
		intent: notice.tone === 'error' ? 'error' : 'success',
		lifetime: notice.explicitDismiss ? null : TOAST_LIFETIME_MS
	};
}

module.exports = { initialConfirmations, confirmationReducer, prConfirmationMessage, deleteFailureMessage, setupFailureMessage, setupStatusLine, setupEndMessage, copyButtonLabel, applyDoneMessage, patchSavedMessage, savedAndResetMessage, toastView, MAX_NOTICES, TOAST_LIFETIME_MS };
