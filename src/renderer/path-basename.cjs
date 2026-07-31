// The renderer has no Node `path` module, and the site paths it displays come
// from the main process in the platform's native form — forward slashes on
// macOS/Linux, backslashes on Windows. Splitting on '/' alone showed the full
// `C:\...` path in the sidebar for any site without a stored label (#87).
'use strict';

/** Last path segment on any platform; the input itself when there is none. */
function pathBasename(p) {
	const s = String(p ?? '');
	return s.split(/[\\/]/).filter(Boolean).pop() || s;
}

module.exports = { pathBasename };
