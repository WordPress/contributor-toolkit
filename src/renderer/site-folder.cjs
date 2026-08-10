// Where a new site goes, and what its folder is called.
//
// Three decisions the Create site modal makes before `setupWordPress` is ever
// called, all of them string work on paths the renderer cannot hand to Node's
// `path` module: it has none. The chosen root arrives in the platform's native
// form — `C:\Users\me` on Windows, `/Users/me` elsewhere — so joining a folder
// name onto it means picking the separator by looking at the string.
//
// They lived inside the component until #216, where nothing in the suite could
// reach them: `index.jsx` cannot be loaded without a DOM, so a wrong separator,
// or a name sanitised down to nothing, was visible only by creating a site by
// hand on the platform in question.
'use strict';

// Everything a folder name may not contain on Windows, which is the stricter of
// the two platforms. One rule everywhere keeps a name from working on macOS and
// failing on Windows.
const ILLEGAL_FOLDER_CHARS = /[\\/:*?"<>|]+/g;

// What a name that sanitises down to nothing becomes. Any folder is better than
// the alternative, which is creating the site directly in the chosen root.
const FALLBACK_FOLDER = 'wordpress-site';

/**
 * A site name as typed, turned into a folder name that is legal everywhere.
 *
 * @param {*} value
 * @return {string}
 */
function sanitizeSiteFolder(value) {
	return String(value ?? '')
		.replace(ILLEGAL_FOLDER_CHARS, '-')
		.replace(/\s+/g, '-')
		.replace(/^-+|-+$/g, '') || FALLBACK_FOLDER;
}

/**
 * The chosen root joined to the folder name, using the separator the root
 * already uses.
 *
 * A root written entirely in backslashes is Windows and gets a backslash.
 * Everything else — including the mixed separators Windows itself accepts —
 * gets a forward slash, which Windows also accepts.
 *
 * @param {*} root
 * @param {*} folder
 * @return {string}
 */
function resolveTargetDir(root, folder) {
	if (!root) return String(folder ?? '');
	const normalizedRoot = String(root).replace(/[\\/]+$/, '');
	const separator = /\\/.test(normalizedRoot) && !normalizedRoot.includes('/') ? '\\' : '/';
	return `${normalizedRoot}${separator}${folder}`;
}

/**
 * The directory an `<input type="file" webkitdirectory>` selection points at.
 *
 * Nothing reaches this by the intended route: the input's click and keyboard
 * handlers are intercepted and go to the native dialog. It runs only when a
 * folder is dropped onto the control — a route the app deliberately does not
 * support, decided in #228 and closed there. Extracted as it stood, dead branch
 * included, because #216 is a refactor and not the place to change what it
 * answers:
 *
 * - `path` plus `webkitRelativePath`, and `path` alone, are the two shapes this
 *   was written for. Electron removed the `path` augmentation on `File` in v32
 *   in favour of `webUtils.getPathForFile`; this app pins Electron 43 and
 *   bridges no `webUtils`, so neither branch is reachable.
 * - What is left is the input's own `value`, which is a fiction: a file input's
 *   value is empty or the literal `C:\fakepath\` prefix on every platform. So a
 *   dropped folder resolves to '' or to `C:\fakepath`, and the modal presents
 *   the second as a real destination.
 *
 * @param {*} file       The first entry of the input's `files` list.
 * @param {*} inputValue The input's `value`, read only when `file` has no path.
 * @return {string} The directory without a trailing separator, or '' when none
 *                  could be derived.
 */
function directoryFromFileEntry(file, inputValue) {
	const relative = file?.webkitRelativePath || '';
	const rawPath = file?.path || '';
	let resolved = '';

	if (rawPath) {
		if (relative) {
			resolved = rawPath.slice(0, rawPath.length - relative.length);
		} else {
			resolved = rawPath.replace(/[\\/][^\\/]*$/, '');
		}
	}

	if (!resolved && inputValue) {
		resolved = String(inputValue).replace(/[^\\/]*$/, '');
	}

	return resolved.replace(/[\\/]+$/, '');
}

module.exports = { sanitizeSiteFolder, resolveTargetDir, directoryFromFileEntry, FALLBACK_FOLDER };
