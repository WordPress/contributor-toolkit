'use strict';

// The screenshot harness (scripts/screenshots/) redirects the app's userData with
// TOOLKIT_USER_DATA_DIR so a seeded settings.json is read instead of the
// contributor's real site registry. That redirect is deliberately narrow: it
// must work in a dev run and be dead in a packaged app, because an installed
// build that honours it could be pointed at an attacker-chosen store path
// through nothing but an environment variable.
//
// These tests load src/main.js under a stubbed `electron` (the same
// Module._load trick as test/ipc-wiring.test.cjs) and assert both sides of
// that guard — cut either condition in main.js and one of them fails.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const MAIN_PATH = path.join(__dirname, '..', 'src', 'main.js');

function createElectronStub({ isPackaged, setPathThrows = false }) {
	const setPathCalls = [];
	class BrowserWindowStub {
		static getAllWindows() { return []; }
		on() {}
		once() {}
	}
	return {
		setPathCalls,
		electron: {
			app: {
				isPackaged,
				setPath: (name, value) => {
					setPathCalls.push({ name, value });
					// Electron throws here when the directory does not exist.
					if (setPathThrows) throw new Error('Failed to set path');
				},
				// Never settles: nothing in the ready path is under test here.
				whenReady: () => new Promise(() => {}),
				on() {},
				quit() {},
				exit() {},
				getPath: () => os.tmpdir(),
				getAppPath: () => path.join(__dirname, '..'),
				getName: () => 'wordpress-contributor-toolkit',
				setName() {},
				getVersion: () => '0.0.0-test'
			},
			BrowserWindow: BrowserWindowStub,
			Menu: { buildFromTemplate: (t) => ({ t }), setApplicationMenu() {} },
			ipcMain: { handle() {}, handleOnce() {}, on() {}, once() {} },
			dialog: {},
			shell: {}
		}
	};
}

// main.js runs the guard at require time, so each case needs a fresh load:
// swap Module._load, set the environment, require, then restore everything.
function loadMainWith({ isPackaged, envValue, setPathThrows = false }) {
	const stub = createElectronStub({ isPackaged, setPathThrows });
	const originalLoad = Module._load;
	const originalEnv = process.env.TOOLKIT_USER_DATA_DIR;
	if (envValue === undefined) delete process.env.TOOLKIT_USER_DATA_DIR;
	else process.env.TOOLKIT_USER_DATA_DIR = envValue;
	Module._load = function (request, parent, isMain) {
		if (request === 'electron') return stub.electron;
		return originalLoad.call(this, request, parent, isMain);
	};
	try {
		delete require.cache[require.resolve(MAIN_PATH)];
		require(MAIN_PATH);
	} finally {
		Module._load = originalLoad;
		delete require.cache[require.resolve(MAIN_PATH)];
		if (originalEnv === undefined) delete process.env.TOOLKIT_USER_DATA_DIR;
		else process.env.TOOLKIT_USER_DATA_DIR = originalEnv;
	}
	return stub.setPathCalls;
}

test('dev run with TOOLKIT_USER_DATA_DIR set redirects userData to that dir', () => {
	const target = path.join(os.tmpdir(), 'wpct-userdata-test');
	const calls = loadMainWith({ isPackaged: false, envValue: target });
	assert.deepEqual(calls, [{ name: 'userData', value: target }]);
});

test('dev run without the variable leaves userData alone', () => {
	const calls = loadMainWith({ isPackaged: false, envValue: undefined });
	assert.deepEqual(calls, []);
});

test('a directory that no longer exists does not stop the app from starting', () => {
	// setPath throws when the target is missing — a stale variable in a shell
	// profile, or a temp directory the OS has reaped. This runs at module scope,
	// before any logging or window exists, so an uncaught throw here would be a
	// stack on stdout and a launch that never happens.
	const target = path.join(os.tmpdir(), 'wpct-userdata-gone');
	let calls;
	assert.doesNotThrow(() => {
		calls = loadMainWith({ isPackaged: false, envValue: target, setPathThrows: true });
	});
	assert.deepEqual(calls, [{ name: 'userData', value: target }]);
});

test('a packaged app ignores TOOLKIT_USER_DATA_DIR entirely', () => {
	const calls = loadMainWith({
		isPackaged: true,
		envValue: path.join(os.tmpdir(), 'wpct-userdata-test')
	});
	assert.deepEqual(calls, []);
});
