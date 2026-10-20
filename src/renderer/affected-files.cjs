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
 * Each file says whether its revert button is offered (#669): every file of
 * the contributor's, and the change's own files they edited, a patch's only
 * when its text was kept, since that is what the file goes back to. Neither
 * end of a file the patch renames has one: it goes back with the whole patch.
 *
 * @param {Object}  root0
 * @param {?Object} [root0.appliedPatch] From `site:status`.
 * @param {?Object} [root0.pullRequest]  From `site:status`.
 * @param {?Object} [root0.unsubmitted]  From `git:unsubmitted-work`: `{ entries, editedSinceChange, renamedByChange }`.
 * @return {{change: ?{label: string, files: Array<{path: string, alsoEdited: boolean, canRevert: boolean}>}, yours: Array<{path: string, added: boolean, canRevert: boolean}>}}
 */
function changedFileGroups({ appliedPatch = null, pullRequest = null, unsubmitted = null } = {}) {
	const changeFiles = affectedFiles({ appliedPatch, pullRequest });
	const edited = new Set(unsubmitted?.editedSinceChange || []);
	const renamed = new Set(unsubmitted?.renamedByChange || []);
	let change = null;
	if (changeFiles.length) {
		let label = __('From the patch');
		if (!Array.isArray(appliedPatch?.files)) {
			// translators: %d: the number of a pull request on GitHub.
			label = sprintf(__('From PR #%d'), pullRequest.number);
		}
		const revertable = !Array.isArray(appliedPatch?.files) || Boolean(appliedPatch.kept);
		change = { label, files: changeFiles.map((path) => ({ path, alsoEdited: edited.has(path), canRevert: revertable && edited.has(path) && !renamed.has(path) })) };
	}
	const theirs = new Set(changeFiles);
	const yours = (unsubmitted?.entries || [])
		.filter((entry) => !theirs.has(entry.path))
		.map((entry) => ({ path: entry.path, added: Boolean(entry.added), canRevert: !renamed.has(entry.path) }));
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
 * @return {{title: string, description: string, confirm: string, done: string}} The question, and what is said once it is done.
 */
function revertFileQuestion(file, { fromChange = false, pullRequest = null } = {}) {
	if (file.added && !fromChange) {
		return {
			// translators: %s: the path of a file in the site.
			title: sprintf(__('Delete %s?'), file.path),
			description: `${__('You created this file.')} ${__('This can’t be undone.')}`,
			confirm: __('Delete file'),
			// translators: %s: the path of a file in the site.
			done: sprintf(__('%s deleted.'), file.path)
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
		confirm: __('Revert file'),
		// translators: %s: the path of a file in the site.
		done: sprintf(__('%s reverted.'), file.path)
	};
}

/**
 * A `git:revert-file` reply turned into something the list can render. The
 * handler's refusals and failures are whole sentences already; a reply with
 * none still says something.
 *
 * @param {*} res
 * @return {{ok: true, dirty?: boolean, changedCount?: number}|{ok: false, message: string}}
 */
function revertOutcome(res) {
	if (res && res.ok) {
		return typeof res.dirty === 'boolean'
			? { ok: true, dirty: res.dirty, changedCount: res.changedCount }
			: { ok: true };
	}
	if (res && res.error) return { ok: false, message: res.error };
	// translators: %s: why the file could not be reverted.
	return { ok: false, message: sprintf(__('Could not revert the file: %s'), __('Unknown error')) };
}

/**
 * The paths as the rows of a tree, every folder open: a folder's subfolders
 * before its files, each in the order the patch first reached it. A folder
 * whose only content is one folder shares that folder's row, as GitHub and
 * VS Code draw them (#677), so `tests/phpunit/tests/ajax` is one row, not four.
 *
 * @param {string[]} files Repository-relative paths, `/`-separated.
 * @return {Array<{kind: 'folder'|'file', key: string, name: string, path?: string, level: number, positionInSet: number, setSize: number}>}
 */
function affectedFileTree(files) {
	const root = { folders: new Map(), files: [] };
	for (const file of files) {
		let node = root;
		for (const part of file.split('/').slice(0, -1)) {
			if (!node.folders.has(part)) node.folders.set(part, { folders: new Map(), files: [] });
			node = node.folders.get(part);
		}
		node.files.push(file);
	}
	const rows = [];
	const walk = (node, prefix, level) => {
		const children = [...node.folders.keys(), ...node.files];
		children.forEach((child, index) => {
			const position = { level, positionInSet: index + 1, setSize: children.length };
			if (index >= node.folders.size) {
				rows.push({ kind: 'file', key: child, name: child.split('/').pop(), path: child, ...position });
				return;
			}
			let name = child;
			let folder = node.folders.get(child);
			while (folder.folders.size === 1 && !folder.files.length) {
				const [[only, inner]] = folder.folders;
				name = `${name}/${only}`;
				folder = inner;
			}
			rows.push({ kind: 'folder', key: `${prefix}${name}/`, name, ...position });
			walk(folder, `${prefix}${name}/`, level + 1);
		});
	};
	walk(root, '', 1);
	return rows;
}

/**
 * The rows still in view with some folders closed: a closed folder keeps its
 * own row and hides everything under it, however deep.
 *
 * @param {Array}       rows      From affectedFileTree.
 * @param {Set<string>} collapsed The keys of the closed folders.
 * @return {Array}
 */
function visibleAffectedRows(rows, collapsed) {
	return rows.filter((row) => ![...collapsed].some((key) => row.key !== key && row.key.startsWith(key)));
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

module.exports = { affectedFiles, affectedFileTree, changedFileGroups, fileOpenTarget, revertFileQuestion, revertOutcome, visibleAffectedRows };
