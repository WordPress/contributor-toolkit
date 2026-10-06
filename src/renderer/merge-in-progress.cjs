// What the app says about a merge started outside it (#352).
//
// Nothing the app runs leaves the index unmerged; a contributor's or a
// mentor's own Git does, with `git merge`, `git rebase`, `git cherry-pick`,
// `git revert` or `git apply --3way` in the checkout. While that operation is
// open, every app write that would reset the worktree refuses (main.js,
// `mergeInProgressBlock`) and the site card shows the notice, and both read
// from here so the two never drift. The app offers no way to finish or abandon
// it: the state was made at a terminal, so the sentence names the terminal
// commands that end it, per kind. Free of Node for the same reason as
// legacy-site.cjs: the renderer bundle imports it, `node --test` requires it,
// and main requires it too, each with its own catalog loaded.
'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');

// translators: %s: the Git command that ends the operation, such as git commit. Leave "git add" as it is: it is a command.
const resolveThenRun = (command) => sprintf(__('resolve the files, then git add them and run %s'), command);

/**
 * How each kind of operation ends, in Git's own words. `title` names the
 * operation; `finish` is the step once the files are resolved; `resolve`
 * says what to do with the files first, when any are still unmerged. A
 * function, so the words are read in the language applied when it is called.
 *
 * @param {string} kind
 * @return {{title: string, resolve: string, finish: string, abandon: string}}
 */
function kindWords(kind) {
	switch (kind) {
		case 'rebase': return {
			title: __('A rebase started outside the app is in progress.'),
			resolve: resolveThenRun('git rebase --continue'),
			finish: 'git rebase --continue',
			abandon: 'git rebase --abort'
		};
		case 'cherry-pick': return {
			title: __('A cherry-pick started outside the app is in progress.'),
			resolve: resolveThenRun('git cherry-pick --continue'),
			finish: 'git cherry-pick --continue',
			abandon: 'git cherry-pick --abort'
		};
		case 'revert': return {
			title: __('A revert started outside the app is in progress.'),
			resolve: resolveThenRun('git revert --continue'),
			finish: 'git revert --continue',
			abandon: 'git revert --abort'
		};
		case 'apply': return {
			title: __('A three-way patch apply started outside the app is in progress.'),
			// translators: Leave "git add" as it is: it is a command.
			resolve: __('resolve the files, then git add them'),
			// translators: Leave "git add" as it is: it is a command.
			finish: __('git add the files'),
			abandon: sprintf(
				'git restore --staged --worktree -- <%s>',
				// translators: Stands in a Git command, inside angle brackets, for the files to type there.
				__('every file the patch touched, not only the ones in conflict')
			)
		};
		default: return {
			title: __('A merge started outside the app is in progress.'),
			resolve: resolveThenRun('git commit'),
			finish: 'git commit',
			abandon: 'git merge --abort'
		};
	}
}

const LISTED = 5;

/**
 * "a, b and c", or "a, b, c and 4 more files" past the first few: the card is
 * not a file list, and the terminal that made the state can print one.
 *
 * @param {string[]} paths
 * @return {string}
 */
function listPaths(paths) {
	const shown = paths.slice(0, LISTED);
	const rest = paths.length - shown.length;
	if (rest > 0) {
		return sprintf(
			// translators: 1: the first few paths, separated by commas. 2: how many more files there are.
			_n('%1$s and %2$d more file', '%1$s and %2$d more files', rest),
			shown.join(', '),
			rest
		);
	}
	if (shown.length <= 1) return shown.join('');
	return sprintf(
		// translators: 1: paths, separated by commas. 2: the last path.
		__('%1$s and %2$s'),
		shown.slice(0, -1).join(', '),
		shown[shown.length - 1]
	);
}

/**
 * The notice for a checkout with an operation open, as the card shows it,
 * or null for every other checkout. The title names the operation; the body
 * names the files still unmerged and the two ways out.
 *
 * @param {Object}                           [root0]
 * @param {?{kind: string, paths: string[]}} [root0.mergeInProgress] What `site:status` reported.
 * @return {{title: string, body: string}|null}
 */
function mergeInProgressNotice({ mergeInProgress = null } = {}) {
	if (!mergeInProgress) return null;
	const kind = kindWords(mergeInProgress.kind);
	const paths = Array.isArray(mergeInProgress.paths) ? mergeInProgress.paths : [];
	const body = paths.length > 0
		? sprintf(
			// translators: 1: the files in conflict. 2: what to do in a terminal to finish. 3: the Git command that abandons it.
			__('It has conflicts in %1$s. Finish it from a terminal (%2$s) or abandon it (%3$s) before using the app on this site. Until then, linking tickets, applying patches, discarding changes and updating trunk are refused here.'),
			listPaths(paths),
			kind.resolve,
			kind.abandon
		)
		: sprintf(
			// translators: 1: the Git command that finishes it. 2: the Git command that abandons it.
			__('Its conflicts are resolved but it is not finished. Finish it from a terminal (%1$s) or abandon it (%2$s) before using the app on this site. Until then, linking tickets, applying patches, discarding changes and updating trunk are refused here.'),
			kind.finish,
			kind.abandon
		);
	return { title: kind.title, body };
}

/**
 * The one-line refusal main returns from every write while the operation is
 * open: the notice, as a sentence.
 *
 * @param {{kind: string, paths: string[]}} mergeInProgress
 * @return {string}
 */
function mergeInProgressError(mergeInProgress) {
	const notice = mergeInProgressNotice({ mergeInProgress });
	return `${notice.title} ${notice.body}`;
}

/**
 * The refusal when the read itself failed: the app does not know whether an
 * operation is open, and a write that guessed "no" would erase one. Nothing
 * was changed, so trying again is the whole advice.
 *
 * @param {*} reason The error the read threw.
 * @return {string}
 */
function mergeCheckFailedError(reason) {
	const why = reason && reason.message ? String(reason.message).trim() : String(reason || '').trim();
	if (!why) {
		return __('The app could not check whether a merge is in progress in this checkout, so nothing was changed. If a Git command is running in it from a terminal, let it finish, then try again.');
	}
	return sprintf(
		// translators: %s: Git's own error message, which is in English.
		__('The app could not check whether a merge is in progress in this checkout, so nothing was changed. If a Git command is running in it from a terminal, let it finish, then try again. (%s)'),
		why
	);
}

module.exports = { mergeInProgressNotice, mergeInProgressError, mergeCheckFailedError };
