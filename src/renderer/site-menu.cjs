// What the site's menu offers (#556): everything that is done to a site as a
// whole, in the header of its page.
//
// Opening the folder is here too. It used to be a menu of its own beside the
// path, and it is still a menu of its own, under "Open in": the applications
// in it are whatever detection found, each by its name, with "Other
// application…" always offered. Detection is a shortcut, and an application it
// misses is not one this app refuses to use.
//
// It is a menu under the menu for a second reason. Detection answers when it
// answers, so the rows it adds can arrive after the menu is on screen. In the
// menu's own list they would push "Delete site" down under a pointer that was
// aiming at something else. In a list of their own, they move nothing but
// "Other application…", which is last.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');

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
 * cannot be pressed; and last the way to choose any application, which is
 * always there (#738, to the design's order).
 *
 * A list that is still counting is not an empty list, and the difference has
 * to be visible: without the row, a slow sweep looks exactly like a machine
 * with no editors on it.
 *
 * An application detection finds is added after the ones before it, so none
 * moves. "Other application…" does move down as they arrive; detection runs
 * as a site opens, so they have usually arrived before the menu does.
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
 * What an item of `openInItems` asks `editor:open` for: the application's
 * path, null for "Other application…" (main's file dialog), or undefined for
 * an item that opens nothing. The site's menu and the menu beside a changed
 * file (#738) both answer an item through this, so the two cannot drift.
 *
 * @param {{id: string, path?: string}} item
 * @return {?string|undefined}
 */
function openInEditorPath(item) {
	if (item?.id === 'open-in') return item.path;
	if (item?.id === 'open-in-other') return null;
	return undefined;
}

/**
 * Why an update to the latest trunk cannot start, or '' when it can.
 *
 * An update rewrites the whole checkout, then installs and builds, so it does
 * not start under an update, an install or a build that is already running.
 * This is the one answer to that: the update's own guard asks it, and the
 * menu's item and the button of the notice on an old site are held with it
 * as their reason.
 *
 * The update leads, since its own install and build are running too while it
 * is, and naming one of those would name a step of the thing that is really
 * in the way. Then the two the contributor can wait out, as in
 * `ticketActionDisabledReason`.
 *
 * A terminal held by anything else, a command typed there for one, is not
 * here: the update is refused then where it starts, in `beginTrunkUpdate`,
 * with a line in the terminal.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.isUpdating] An update is under way.
 * @param {boolean} [root0.installing] An install is running.
 * @param {boolean} [root0.building]   A build is running.
 * @return {string} The reason, or ''.
 */
function updateHeldReason({ isUpdating = false, installing = false, building = false } = {}) {
	if (isUpdating) return __('Wait for the trunk update to finish.');
	if (installing) return __('Wait for the installation to finish.');
	if (building) return __('Wait for the build to finish.');
	return '';
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
 * Updating is held while an update, an install or a build is running, and
 * the item says which under its name, in `description`: the update's own
 * guard refuses it then, and an item that could be chosen and did nothing
 * would say nothing either.
 *
 * @param {Object}  root0
 * @param {string}  [root0.platform]   For the file manager's name.
 * @param {Array}   [root0.editors]    Detected applications, `{ name, path }`.
 * @param {boolean} [root0.detecting]  Detection is still running.
 * @param {boolean} [root0.isPending]  The site is still being set up.
 * @param {boolean} [root0.isDeleting] The site is being deleted.
 * @param {string}  [root0.updateHeld] Why an update cannot start, as `updateHeldReason` says it, or '' when it can.
 * @param {?string} [root0.preferred]  The editor chosen in Settings (#738), by id, or null for "Ask each time".
 * @return {Array<{id: string, label: string, items?: Array, disabled?: boolean, description?: string, separated?: boolean}>}
 */
function siteMenuItems({ platform, editors = [], detecting = false, isPending = false, isDeleting = false, updateHeld = '', preferred = null } = {}) {
	const update = { id: 'update-trunk', label: __('Update to latest trunk') };
	// With an editor chosen in Settings and found on this machine, "Open in"
	// is that editor and nothing else. Until detection finds it, or once it is
	// gone, the menu asks as it does with none chosen.
	const chosen = preferred ? (editors || []).find((editor) => editor.id === preferred) : null;
	let openIn;
	if (chosen) {
		// translators: %s is the name of the editor chosen in Settings, for example "Visual Studio Code".
		openIn = { id: 'open-in', label: sprintf(__('Open in %s'), chosen.name), path: chosen.path };
	} else {
		// translators: the label of a menu that lists applications, each by its name: "Open in" and then, in the menu, "Visual Studio Code".
		openIn = { id: 'open-in-menu', label: __('Open in'), items: openInItems({ editors, detecting }) };
	}
	const items = [
		{ id: 'rename', label: __('Rename…') },
		{ id: 'copy-path', label: __('Copy path') },
		{ id: 'show-in-file-manager', label: fileManagerLabel(platform) },
		updateHeld ? { ...update, disabled: true, description: updateHeld } : update,
		openIn
	];
	if (!isPending) {
		items.push(isDeleting
			? { id: 'deleting', label: __('Deleting…'), disabled: true, separated: true }
			: { id: 'delete', label: __('Delete site'), separated: true });
	}
	return items;
}

module.exports = { siteMenuItems, openInItems, openInEditorPath, fileManagerLabel, updateHeldReason };
