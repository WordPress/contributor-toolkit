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

// Line breaks, and everything else that would let a refused path end a log line
// and start another one.
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/g;

// A refused path is attacker-influenced by hypothesis, and it is about to be
// written into the file contributors attach to bug reports. It has to stay on
// one line — a newline would otherwise let it forge a second entry in the app's
// own timestamp-and-scope format — and it has to be bounded so a very long path
// cannot flood the file. Control characters are escaped rather than dropped so
// the line still says what the caller actually sent; truncation comes after
// escaping, since escaping is what decides the final length.
//
// This is the same concern, and the same escaping, as `describeRefusedUrl` in
// external-url.js. If a third caller ever needs it, the two should move into a
// shared safe-log helper rather than gain a third copy.
function describeRefusedSite(sitePath) {
	if (typeof sitePath !== 'string') return `<${sitePath === null ? 'null' : typeof sitePath}>`;

	const oneLine = sitePath.replace(CONTROL_CHARACTERS, (c) => {
		const code = c.codePointAt(0);
		return code <= 0xff
			? `\\x${code.toString(16).padStart(2, '0')}`
			: `\\u${code.toString(16).padStart(4, '0')}`;
	});

	if (oneLine.length <= 120) return oneLine;
	return `${oneLine.slice(0, 120)}…`;
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
