// The files the change on the checkout touched, in the site's details (#669),
// and what one click on one of them does. Pure, like site-details.cjs: the
// renderer bundle imports it and `node --test` requires it directly.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');

/**
 * The paths to list, in the order the change made them, or none when nothing
 * is applied. An empty list is no section at all. The change is the applied
 * patch, or the pull request checked out, which lists what it changed from
 * trunk; a pull request checked out before the app recorded that has no list.
 *
 * @param {Object}  root0
 * @param {?Object} [root0.appliedPatch] From `site:status`: `{ label, files, ... }`.
 * @param {?Object} [root0.pullRequest]  From `site:status`: `{ number, files, ... }`.
 * @return {string[]}
 */
function affectedFiles({ appliedPatch = null, pullRequest = null } = {}) {
	if (Array.isArray(appliedPatch?.files)) return appliedPatch.files;
	return Array.isArray(pullRequest?.files) ? pullRequest.files : [];
}

/**
 * "Changed files", in two groups (#669): the applied change's own files, each
 * marked when the contributor has changed it since, and every other file
 * changed on the branch, which is the contributor's, each marked when new.
 * A file is in one group only. With nothing applied there is no change group;
 * before the first answer about the tree there are no files of the
 * contributor's to list.
 *
 * @param {Object}  root0
 * @param {?Object} [root0.appliedPatch] From `site:status`.
 * @param {?Object} [root0.pullRequest]  From `site:status`.
 * @param {?Object} [root0.unsubmitted]  From `git:unsubmitted-work`: `{ entries, editedSinceChange }`.
 *                                       Each file says whether its revert button is offered (#669): every file of
 *                                       the contributor's, and the change's own files they edited, a patch's only
 *                                       when its text was kept, since that is what the file goes back to.
 *
 * @return {{change: ?{label: string, files: Array<{path: string, alsoEdited: boolean, canRevert: boolean}>}, yours: Array<{path: string, added: boolean, canRevert: boolean}>}}
 */
function changedFileGroups({ appliedPatch = null, pullRequest = null, unsubmitted = null } = {}) {
	const changeFiles = affectedFiles({ appliedPatch, pullRequest });
	const edited = new Set(unsubmitted?.editedSinceChange || []);
	let change = null;
	if (changeFiles.length) {
		let label = __('From the patch');
		if (!Array.isArray(appliedPatch?.files)) {
			// translators: %d: the number of a pull request on GitHub.
			label = sprintf(__('From PR #%d'), pullRequest.number);
		}
		const revertable = !Array.isArray(appliedPatch?.files) || Boolean(appliedPatch.kept);
		change = { label, files: changeFiles.map((path) => ({ path, alsoEdited: edited.has(path), canRevert: revertable && edited.has(path) })) };
	}
	const theirs = new Set(changeFiles);
	const yours = (unsubmitted?.entries || [])
		.filter((entry) => !theirs.has(entry.path))
		.map((entry) => ({ path: entry.path, added: Boolean(entry.added), canRevert: true }));
	return { change, yours };
}

/**
 * What a file's revert button asks first (#669): what the file goes back to,
 * or, for a file the contributor created, that it goes.
 *
 * @param {{path: string, added?: boolean}} file
 * @param {Object}                          [root1]
 * @param {boolean}                         [root1.fromChange]  The file is the applied patch's or pull request's.
 * @param {?Object}                         [root1.pullRequest] The checked-out pull request, `{ number }`.
 * @return {{title: string, description: string, confirm: string}}
 */
function revertFileQuestion(file, { fromChange = false, pullRequest = null } = {}) {
	if (file.added && !fromChange) {
		return {
			// translators: %s: the path of a file in the site.
			title: sprintf(__('Delete %s?'), file.path),
			description: `${__('You created this file.')} ${__('This can’t be undone.')}`,
			confirm: __('Delete file')
		};
	}
	let what = __('Your changes to it are removed.');
	if (fromChange && pullRequest) {
		// translators: %d: a pull request number.
		what = sprintf(__('Your edits to it are removed, and it goes back to how PR #%d has it.'), pullRequest.number);
	} else if (fromChange) {
		what = __('Your edits to it are removed, and it goes back to how the patch left it.');
	}
	return {
		// translators: %s: the path of a file in the site.
		title: sprintf(__('Revert %s?'), file.path),
		description: `${what} ${__('This can’t be undone.')}`,
		confirm: __('Revert file')
	};
}

/**
 * Where a click on a file sends it: the first editor detection found, which
 * is the first the site menu's "Open in" offers, or the file manager when
 * there is none. The file manager rather than nothing, so the link always
 * does something.
 *
 * @param {Object} root0
 * @param {Array}  [root0.editors] Detected applications, `{ name, path }`, in detection's order.
 * @return {{kind: 'editor', path: string}|{kind: 'reveal'}}
 */
function fileOpenTarget({ editors = [] } = {}) {
	const first = Array.isArray(editors) ? editors[0] : null;
	return first ? { kind: 'editor', path: first.path } : { kind: 'reveal' };
}

module.exports = { affectedFiles, changedFileGroups, fileOpenTarget, revertFileQuestion };
