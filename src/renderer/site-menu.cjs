// What the site's menu offers (#556): everything that is done to a site as a
// whole, in the header of its page.
//
// Opening the folder is here too. It used to be a menu of its own beside the
// path, and the applications in it are still whatever detection found, each
// named, with "other application" always offered: detection is a shortcut,
// and an application it misses is not one this app refuses to use.
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
 * The menu's items, in order. `id` says what an item does; an `open-in` item
 * also carries the application's `path`. `separated` asks for a line above.
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
 * @return {Array<{id: string, label: string, path?: string, disabled?: boolean, separated?: boolean}>}
 */
function siteMenuItems({ platform, editors = [], detecting = false, isPending = false, isDeleting = false } = {}) {
	const items = [
		{ id: 'rename', label: __('Rename…') },
		{ id: 'copy-path', label: __('Copy path') },
		{ id: 'show-in-file-manager', label: fileManagerLabel(platform) },
		{ id: 'update-trunk', label: __('Update to latest trunk') },
		...(editors || []).map((editor) => ({
			id: 'open-in',
			// translators: %s: the name of an application, such as Visual Studio Code.
			label: sprintf(__('Open in %s'), editor.name),
			path: editor.path
		}))
	];
	// A menu that is still counting is not an empty menu, and the difference
	// has to be visible: without this, a slow sweep looks exactly like a
	// machine with no editors on it.
	if (detecting) items.push({ id: 'detecting', label: __('Looking for applications…'), disabled: true });
	items.push({ id: 'open-in-other', label: __('Open in other application…') });
	if (!isPending) {
		items.push(isDeleting
			? { id: 'deleting', label: __('Deleting…'), disabled: true, separated: true }
			: { id: 'delete', label: __('Delete site'), separated: true });
	}
	return items;
}

module.exports = { siteMenuItems, fileManagerLabel };
