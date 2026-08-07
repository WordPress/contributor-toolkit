// The gate in front of the recursive directory removal in `sites:delete`.
//
// `sites:delete` is handed a path and calls `fse.remove` on it — the least
// recoverable action reachable from the window. The renderer is the only caller
// and every call site passes a path the app itself registered, so nothing today
// misuses it. But the renderer also displays content the app does not author:
// child-process output from an install or a build, and the site being developed.
// This module is the step that keeps any future influence over that path from
// turning "delete this site" into "remove this directory".
//
// The `sites` array in the app's store is its own record of what it created or
// adopted, so it is the boundary: a request to remove anything not in it is not
// one the app should carry out. This is the same shape as external-url.js — a
// pure check, a safe log formatter, and a wrapper whose effects are injected so
// both branches can be tested without an Electron process.

const { describeRefused } = require('./safe-log');

// True only for a path the app has on record. Exact string match, the same
// convention `sites:add`/`sites:delete` already use (`sites.includes(sitePath)`,
// `filter((p) => p !== sitePath)`): the registry stores the paths verbatim, so a
// parent, a child, or a differently-normalized form is deliberately not a match.
// Anything that is not a non-empty string is refused rather than throwing.
function isRegisteredSite(sitePath, sites) {
	if (typeof sitePath !== 'string' || sitePath === '') return false;
	if (!Array.isArray(sites)) return false;
	return sites.includes(sitePath);
}

// A refused path is attacker-influenced by hypothesis, and it is about to be
// written into the file contributors attach to bug reports, so it has to stay on
// one line and it has to be bounded. safe-log.js is where both live, and why.
function describeRefusedSite(sitePath) {
	return describeRefused(sitePath);
}

// The `sites:delete` handler's body, kept out of main.js so both sides of the
// guard can be tested without an Electron process. `forget` drops the path from
// the store, `remove` is the real `fse.remove` in the app, and both are recording
// stubs in the tests. A path that is not registered performs neither: no store
// mutation and no removal, just a logged refusal.
async function deleteRegisteredSite(sitePath, { sites, forget, remove, onRefused } = {}) {
	if (!isRegisteredSite(sitePath, sites)) {
		if (typeof onRefused === 'function') onRefused(describeRefusedSite(sitePath));
		return false;
	}

	forget();
	await remove(sitePath);
	return true;
}

module.exports = {
	isRegisteredSite,
	describeRefusedSite,
	deleteRegisteredSite
};
