// The gate in front of `shell.openExternal`.
//
// `openExternal` hands an address to whatever application the OS has registered
// for its scheme, which is a much wider action than "show this page in the
// browser". A `file:` address opens an arbitrary local path in its associated
// application — on Windows that can mean running it rather than viewing it —
// and every other scheme registered on the machine is reachable the same way.
//
// The renderer is the only caller and every call site passes an http/https
// address, so nothing today misuses it. But the renderer also displays content
// the app does not author: child-process output from an install or a build, and
// the site being developed. The server URL the app auto-opens is itself parsed
// out of the Playground server's stdout. This module is the step that keeps any
// future influence over that string from turning into an action on the
// contributor's machine.
//
// Widen ALLOWED_URL_SCHEMES only for a scheme the app actually needs, and only
// after asking what the OS does with it.

const ALLOWED_URL_SCHEMES = ['http:', 'https:'];

// Scheme is read off the parsed URL rather than the raw string, so casing and
// leading whitespace ('FILE:', ' file:') are normalized before the comparison
// instead of being a way around it. An address Node can't parse is refused
// rather than passed on to the OS to interpret.
function isAllowedExternalUrl(url) {
	if (typeof url !== 'string' || url.trim() === '') return false;

	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return false;
	}

	return ALLOWED_URL_SCHEMES.includes(parsed.protocol);
}

// Truncated because a refused address is attacker-influenced by hypothesis, and
// the log is a file people paste into issue threads.
function describeRefusedUrl(url) {
	if (typeof url !== 'string') return `<${url === null ? 'null' : typeof url}>`;
	if (url.length <= 120) return url;
	return `${url.slice(0, 120)}…`;
}

// The `url:open` handler's body, kept out of main.js so both sides of the guard
// can be tested without an Electron process: `openExternal` is the real
// `shell.openExternal` in the app and a recording stub in the tests.
async function openExternalUrl(url, { openExternal, onRefused } = {}) {
	if (!isAllowedExternalUrl(url)) {
		if (typeof onRefused === 'function') onRefused(describeRefusedUrl(url));
		return false;
	}

	await openExternal(url);
	return true;
}

module.exports = {
	ALLOWED_URL_SCHEMES,
	isAllowedExternalUrl,
	describeRefusedUrl,
	openExternalUrl
};
