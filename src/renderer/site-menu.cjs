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
// down under a pointer that was aiming at something else. In a list of their
// own they are added at its end, under the one row that is always there, so
// that row does not move either.
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
 * The applications a folder can be opened in, in order: the way to choose any
 * application, which is always there and so is first, where nothing that
 * arrives later can move it; each one detection found, by its own name; and
 * a row that says detection is still running, which cannot be pressed and is
 * last, so that its going moves nothing that can be.
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
	const items = [
		{ id: 'open-in-other', label: __('Other application…') },
		...(editors || []).map((editor) => ({ id: 'open-in', label: editor.name, path: editor.path }))
	];
	if (detecting) items.push({ id: 'detecting', label: __('Looking for applications…'), disabled: true });
	return items;
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
 * @return {Array<{id: string, label: string, items?: Array, disabled?: boolean, description?: string, separated?: boolean}>}
 */
function siteMenuItems({ platform, editors = [], detecting = false, isPending = false, isDeleting = false, updateHeld = '' } = {}) {
	const update = { id: 'update-trunk', label: __('Update to latest trunk') };
	const items = [
		{ id: 'rename', label: __('Rename…') },
		{ id: 'copy-path', label: __('Copy path') },
		{ id: 'show-in-file-manager', label: fileManagerLabel(platform) },
		updateHeld ? { ...update, disabled: true, description: updateHeld } : update,
		// translators: the label of a menu that lists applications, each by its name: "Open in" and then, in the menu, "Visual Studio Code".
		{ id: 'open-in-menu', label: __('Open in'), items: openInItems({ editors, detecting }) }
	];
	if (!isPending) {
		items.push(isDeleting
			? { id: 'deleting', label: __('Deleting…'), disabled: true, separated: true }
			: { id: 'delete', label: __('Delete site'), separated: true });
	}
	return items;
}

module.exports = { siteMenuItems, openInItems, fileManagerLabel, updateHeldReason };
