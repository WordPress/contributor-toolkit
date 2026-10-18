// Where a new site goes, and what its folder is called.
//
// Two decisions the Create site modal makes before `setupWordPress` is ever
// called, both of them string work on paths the renderer cannot hand to Node's
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

module.exports = { sanitizeSiteFolder, resolveTargetDir, FALLBACK_FOLDER };
