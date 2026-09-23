'use strict';

const fs = require('fs');
const path = require('path');

// The contents of the `node`, `npm` and `npx` shims the app writes onto PATH for
// every child process it starts (see ensureNodeShimDir in main.js), plus the one
// resolver that decides which binary they exec (nodeExecPath, #518). String
// building and a single existence probe, no electron, so both the property these
// shims must hold and the resolver's fallback can be unit-tested without
// spawning anything or having a bundle on disk.
//
// That property is the preload. The shims point at Electron running under
// ELECTRON_RUN_AS_NODE, and Electron keeps `process.versions.electron` set in
// that mode — which makes every yargs-based tool misread its own arguments and,
// for a task runner, spawn itself without end (#275, and see
// electron-node-compat.js for the mechanism).
//
// The preload is passed as an explicit `--require` argument rather than through
// NODE_OPTIONS. NODE_OPTIONS is how win-spawn-patch.js reaches descendants, and
// it is the right tool there — it has to reach a process several levels down that
// we never invoke ourselves. Here we are the one invoking the process, and
// measurement showed NODE_OPTIONS did not survive every chain reliably: an
// argument does, always, because it is not inherited at all. It also confines the
// patch to processes that actually go through the shim, instead of leaking into
// every unrelated Node process a build happens to start. The one other route to
// Electron-as-Node is the Windows spawn patch, which redirects `spawn('node')`
// straight to the binary; it re-attaches the same `--require` from
// WPTK_NODE_COMPAT_PATH so both routes present the same runtime.

// Set alongside the flag so the preload only acts when the app asked for it —
// requiring the module in a test must not mutate the test's own process.
const COMPAT_FLAG = 'WPTK_NODE_COMPAT';

// `--require` is separated from the arguments the caller passed, so a shim
// invoked as `node -e …` still ends up as `node --require … -e …`.
function requireArgs(compatPath) {
	return compatPath ? `--require "${compatPath}" ` : '';
}

// POSIX shims are bash scripts. The compat path is interpolated into a quoted
// argument, so spaces are safe; unlike NODE_OPTIONS, nothing re-tokenises it.
function posixShim({ execPath, compatPath, cliPath = null }) {
	const flag = compatPath ? `${COMPAT_FLAG}=1 ` : '';
	const cli = cliPath ? `"${cliPath}" ` : '';
	return `#!/usr/bin/env bash\n${flag}ELECTRON_RUN_AS_NODE=1 "${execPath}" ${requireArgs(compatPath)}${cli}"$@"\n`;
}

// Windows shims are .cmd/.bat. Backslashes inside a quoted command-line argument
// are literal — the escaping problem that forces forward slashes in NODE_OPTIONS
// does not exist here, so the path goes in as the OS spells it.
function windowsShim({ execPath, compatPath, cliPath = null }) {
	const flag = compatPath ? `set ${COMPAT_FLAG}=1\r\n` : '';
	const cli = cliPath ? `"${cliPath}" ` : '';
	return `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n${flag}"${execPath}" ${requireArgs(compatPath)}${cli}%*\r\n`;
}

// Which binary the shims, and the runner spawns in main.js, should exec (#518).
//
// On macOS a process that assigns `process.title` is checked in with
// LaunchServices by libuv's darwin implementation, and LaunchServices registers
// it under the Info.plist of the bundle the binary lives in. The main bundle has
// no LSUIElement, so such a process becomes a Foreground app and the Dock shows
// a tile for it. A Gutenberg build runs a dozen workers that set their title to
// `exec`, and npm sets its own; Core's grunt sets none, which is why only
// Gutenberg ever showed this. The `… Helper.app` bundle beside the main binary
// carries LSUIElement and is the same Electron (identical process.versions), so
// running Electron-as-Node through it registers nothing.
//
// Anywhere else the answer is process.execPath, unchanged — this must not touch
// the filesystem on Windows or Linux, where there is nothing to look for.
//
// `platform` and `exists` are injected so the resolver stays testable without a
// bundle on disk, which is the whole reason this module avoids electron and fs
// everywhere else.
function nodeExecPath({
	execPath = process.execPath,
	platform = process.platform,
	exists = fs.existsSync
} = {}) {
	if (platform !== 'darwin') return execPath;
	// …/Foo.app/Contents/MacOS/Foo → …/Foo.app/Contents/Frameworks/Foo Helper.app/Contents/MacOS/Foo Helper
	const contents = path.dirname(path.dirname(execPath));
	const name = path.basename(execPath);
	const helper = path.join(
		contents,
		'Frameworks',
		`${name} Helper.app`,
		'Contents',
		'MacOS',
		`${name} Helper`
	);
	// A layout without that Helper — an unusual repackaging, a future rename —
	// falls back to what the app did before this fix: the Dock tiles come back,
	// nothing breaks.
	return exists(helper) ? helper : execPath;
}

function nodeShim({ execPath, compatPath, platform = process.platform }) {
	const build = platform === 'win32' ? windowsShim : posixShim;
	return build({ execPath, compatPath });
}

function cliShim({ execPath, compatPath, cliPath, platform = process.platform }) {
	const build = platform === 'win32' ? windowsShim : posixShim;
	return build({ execPath, compatPath, cliPath });
}

module.exports = { nodeShim, cliShim, nodeExecPath, COMPAT_FLAG };
