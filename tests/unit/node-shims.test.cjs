const test = require('node:test');
const assert = require('node:assert/strict');

const { nodeShim, cliShim, nodeExecPath, COMPAT_FLAG } = require('../../src/node-shims.cjs');

const EXEC = {
	darwin: '/Applications/App.app/Contents/MacOS/App',
	win32: 'C:\\Program Files\\App\\App.exe'
};
const COMPAT = {
	darwin: '/tmp/electron-node-shims-42/electron-node-compat.js',
	win32: 'C:\\Users\\JuanMa\\AppData\\Local\\Temp\\electron-node-shims-42\\electron-node-compat.js'
};

// Every shim, on every platform, has to carry the preload. Missing it on one of
// them is exactly the shape of this bug: a build that runs away only through
// whichever entry point was forgotten.
test('every shim preloads the compat patch, on every platform', () => {
	for (const platform of ['darwin', 'win32']) {
		const shims = {
			node: nodeShim({ execPath: EXEC[platform], compatPath: COMPAT[platform], platform }),
			npm: cliShim({
				execPath: EXEC[platform],
				compatPath: COMPAT[platform],
				cliPath: 'npm-cli.js',
				platform
			})
		};

		for (const [name, script] of Object.entries(shims)) {
			assert.ok(
				script.includes(`--require "${COMPAT[platform]}"`),
				`${platform} ${name} shim does not preload the patch`
			);
			assert.ok(script.includes(COMPAT_FLAG), `${platform} ${name} shim does not set the flag`);
			assert.ok(script.includes('ELECTRON_RUN_AS_NODE=1'), `${platform} ${name} shim`);
		}
	}
});

// The caller's own arguments must arrive untouched and *after* ours — a shim
// invoked as `node -e …` has to end up as `node --require … -e …`, not the other
// way round, or the script never runs.
test('the preload precedes the arguments the caller passed', () => {
	const posix = nodeShim({ execPath: EXEC.darwin, compatPath: COMPAT.darwin, platform: 'darwin' });
	assert.ok(posix.endsWith('"$@"\n'));
	assert.ok(posix.indexOf('--require') < posix.indexOf('"$@"'));

	const win = nodeShim({ execPath: EXEC.win32, compatPath: COMPAT.win32, platform: 'win32' });
	assert.ok(win.trimEnd().endsWith('%*'));
	assert.ok(win.indexOf('--require') < win.indexOf('%*'));
});

// The npm/npx shims run a CLI script; it has to sit between the preload and the
// caller's arguments, or npm would read `--require` as one of its own.
test('a CLI shim keeps the preload, the CLI and the arguments in order', () => {
	const npm = cliShim({
		execPath: EXEC.darwin,
		compatPath: COMPAT.darwin,
		cliPath: '/app/node_modules/npm/bin/npm-cli.js',
		platform: 'darwin'
	});

	assert.ok(npm.indexOf('--require') < npm.indexOf('npm-cli.js'));
	assert.ok(npm.indexOf('npm-cli.js') < npm.indexOf('"$@"'));
});

// Paths are interpolated into quoted arguments, so a space must not split them.
// This is the failure mode that would only ever appear on someone else's machine.
test('a path with spaces stays one argument', () => {
	const spaced = '/Users/Juan Ma/Library/Application Support/electron-node-compat.js';
	const shim = nodeShim({ execPath: '/Apps/My App/App', compatPath: spaced, platform: 'darwin' });

	assert.ok(shim.includes(`--require "${spaced}"`));
	assert.ok(shim.includes('"/Apps/My App/App"'));
});

// Windows keeps its native separators here. Unlike NODE_OPTIONS — which Node
// re-tokenises, eating backslashes as escapes — a quoted command-line argument
// is taken literally, so there is nothing to work around.
test('the Windows shim keeps backslashes in the preload path', () => {
	const shim = nodeShim({ execPath: EXEC.win32, compatPath: COMPAT.win32, platform: 'win32' });

	assert.ok(shim.includes(`--require "${COMPAT.win32}"`));
	assert.ok(shim.includes('\\'));
	assert.ok(shim.startsWith('@echo off\r\n'));
});

// Copying the patch out of the bundle is best-effort. Without it the shim must
// still be a working shim — a build that cannot be patched has to keep running.
test('a shim without a patch to preload is still a valid shim', () => {
	const posix = nodeShim({ execPath: EXEC.darwin, compatPath: null, platform: 'darwin' });
	assert.equal(posix, `#!/usr/bin/env bash\nELECTRON_RUN_AS_NODE=1 "${EXEC.darwin}" "$@"\n`);
	assert.ok(!posix.includes(COMPAT_FLAG));

	const win = nodeShim({ execPath: EXEC.win32, compatPath: null, platform: 'win32' });
	assert.ok(!win.includes('--require'));
	assert.ok(!win.includes(COMPAT_FLAG));
	assert.ok(win.includes('%*'));
});

// --- nodeExecPath: which binary the shims exec (#518) ---------------------

// The two macOS layouts the app actually runs in.
const PACKAGED = '/Applications/WordPress Contributor Toolkit.app/Contents/MacOS/WordPress Contributor Toolkit';
const PACKAGED_HELPER = '/Applications/WordPress Contributor Toolkit.app/Contents/Frameworks/WordPress Contributor Toolkit Helper.app/Contents/MacOS/WordPress Contributor Toolkit Helper';
const DEV = '/repo/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron';
const DEV_HELPER = '/repo/node_modules/electron/dist/Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper';

// Records what was probed as well as answering, so a test can assert that the
// non-macOS paths never look at the filesystem at all.
function probe(present = []) {
	const asked = [];
	const exists = (p) => {
		asked.push(p);
		return present.includes(p);
	};
	exists.asked = asked;
	return exists;
}

// The packaged bundle is the one the bug was reported against: the main binary
// has no LSUIElement, the Helper does, so this is the whole fix in one line.
test('on macOS the packaged bundle resolves to its Helper', () => {
	const exists = probe([PACKAGED_HELPER]);
	assert.equal(nodeExecPath({ execPath: PACKAGED, platform: 'darwin', exists }), PACKAGED_HELPER);
});

// `npm start` runs from Electron's own dist, whose Helper is named after
// Electron rather than the product. Same derivation, different name — if the
// rule were hardcoded to the product name, development would silently keep the
// old behaviour and the bug would only be fixed for people who never see it.
test('on macOS the development Electron.app resolves to its Helper', () => {
	const exists = probe([DEV_HELPER]);
	assert.equal(nodeExecPath({ execPath: DEV, platform: 'darwin', exists }), DEV_HELPER);
});

// A layout with no Helper must degrade to what the app did before the fix: Dock
// tiles come back, builds still run. Spawning a path that is not there would
// turn a cosmetic bug into a build that never starts.
test('on macOS a missing Helper falls back to the main binary', () => {
	const exists = probe([]);
	assert.equal(nodeExecPath({ execPath: PACKAGED, platform: 'darwin', exists }), PACKAGED);
	assert.deepEqual(exists.asked, [PACKAGED_HELPER]);
});

// Windows and Linux have no such bundle, and #497/#512 fixed their symptom a
// different way. They must return the binary untouched and not even look.
test('off macOS the binary is returned untouched, with no filesystem probe', () => {
	for (const [platform, execPath] of [['win32', EXEC.win32], ['linux', '/opt/app/app']]) {
		const exists = probe([]);
		assert.equal(nodeExecPath({ execPath, platform, exists }), execPath);
		assert.deepEqual(exists.asked, [], `${platform} probed the filesystem`);
	}
});

// The resolved path is what gets interpolated into a shim, and every macOS
// bundle path has spaces in it. The Helper adds two more path components that
// each contain one, so this is the case most likely to break quoting.
test('a Helper path with spaces survives into a working shim', () => {
	const exists = probe([PACKAGED_HELPER]);
	const execPath = nodeExecPath({ execPath: PACKAGED, platform: 'darwin', exists });
	const shim = nodeShim({ execPath, compatPath: COMPAT.darwin, platform: 'darwin' });

	assert.ok(shim.includes(`"${PACKAGED_HELPER}"`));
	assert.ok(shim.includes(`--require "${COMPAT.darwin}"`));
	assert.ok(shim.includes('ELECTRON_RUN_AS_NODE=1'));
});
