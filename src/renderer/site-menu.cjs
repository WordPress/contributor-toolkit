// What the site's menu offers (#556): everything that is done to a site as a
// whole, in the header of its page.
//
// Opening the folder is here too. It used to be a menu of its own beside the
// path, and it is still a menu of its own, under "Open in": the applications
// in it are whatever detection found, each by its name, with "Other
// application…" always offered. Detection is a shortcut, and an application it
// misses is not one this app refuses to use.
//
// It is a menu under the menu for a second reason. Detection runs as the menu
// opens and answers when it answers, so the rows it adds arrive after the
// menu is on screen. In the menu's own list they would push "Delete site"
// down under a pointer that was aiming at something else; in a list of their
// own, nothing a contributor is about to press moves.
'use strict';

const { __ } = require('@wordpress/i18n');

/**
 * What the file manager is called where the app is running. It has a name on
 * the two platforms that have one; everywhere else it is called what it is.
 *
 * @param {string} [platform] `process.platform`, as the preload reports it.
 * @return {string}
 */
function fileManagerLabel(platform) {
	if (platform === 'darwin') return __('Show in Finder');
	if (platform === 'win32') return __('Show in Explorer');
	return __('Show in file manager');
}

/**
 * The applications a folder can be opened in, in order: each one detection
 * found, by its own name; a row that says detection is still running, which
 * cannot be pressed; and the way to choose any other, which is always there.
 *
 * A list that is still counting is not an empty list, and the difference has
 * to be visible: without the row, a slow sweep looks exactly like a machine
 * with no editors on it.
 *
 * @param {Object}  root0
 * @param {Array}   [root0.editors]   Detected applications, `{ name, path }`.
 * @param {boolean} [root0.detecting] Detection is still running.
 * @return {Array<{id: string, label: string, path?: string, disabled?: boolean}>}
 */
function openInItems({ editors = [], detecting = false } = {}) {
	const items = (editors || []).map((editor) => ({ id: 'open-in', label: editor.name, path: editor.path }));
	if (detecting) items.push({ id: 'detecting', label: __('Looking for applications…'), disabled: true });
	items.push({ id: 'open-in-other', label: __('Other application…') });
	return items;
}

/**
 * The menu's items, in order. `id` says what an item does. The `open-in-menu`
 * item opens a menu of its own, whose items are in `items`. `separated` asks
 * for a line above.
 *
 * The list is the same whatever detection finds and however long it takes:
 * what changes is inside "Open in".
 *
 * Deleting is not offered while the site is still being cloned: it would
 * remove a directory the app is writing into. The main process refuses it
 * either way, and not offering a control that cannot work is the answer a
 * contributor sees. While a deletion runs, the item says so and cannot be
 * pressed again, so a second request cannot race the first.
 *
 * @param {Object}  root0
 * @param {string}  [root0.platform]   For the file manager's name.
 * @param {Array}   [root0.editors]    Detected applications, `{ name, path }`.
 * @param {boolean} [root0.detecting]  Detection is still running.
 * @param {boolean} [root0.isPending]  The site is still being set up.
 * @param {boolean} [root0.isDeleting] The site is being deleted.
 * @return {Array<{id: string, label: string, items?: Array, disabled?: boolean, separated?: boolean}>}
 */
function siteMenuItems({ platform, editors = [], detecting = false, isPending = false, isDeleting = false } = {}) {
	const items = [
		{ id: 'rename', label: __('Rename…') },
		{ id: 'copy-path', label: __('Copy path') },
		{ id: 'show-in-file-manager', label: fileManagerLabel(platform) },
		{ id: 'update-trunk', label: __('Update to latest trunk') },
		{ id: 'open-in-menu', label: __('Open in'), items: openInItems({ editors, detecting }) }
	];
	if (!isPending) {
		items.push(isDeleting
			? { id: 'deleting', label: __('Deleting…'), disabled: true, separated: true }
			: { id: 'delete', label: __('Delete site'), separated: true });
	}
	return items;
}

module.exports = { siteMenuItems, openInItems, fileManagerLabel };
