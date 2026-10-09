'use strict';

// The screenshot harness (scripts/screenshots/) redirects the app's userData with
// TOOLKIT_USER_DATA_DIR so a seeded settings.json is read instead of the
// contributor's real site registry. That redirect is deliberately narrow: it
// must work in a dev run and be dead in a packaged app, because an installed
// build that honours it could be pointed at an attacker-chosen store path
// through nothing but an environment variable.
//
// These tests load src/main.js under a stubbed `electron` (the same
// Module._load trick as tests/unit/ipc-wiring.test.cjs) and assert both sides of
// that guard — cut either condition in main.js and one of them fails.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');

const MAIN_PATH = path.join(__dirname, '..', '..', 'src', 'main.js');

function createElectronStub({ isPackaged, setPathThrows = false }) {
	const setPathCalls = [];
	const activationPolicyCalls = [];
	class BrowserWindowStub {
		static getAllWindows() { return []; }
		on() {}
		once() {}
	}
	return {
		setPathCalls,
		activationPolicyCalls,
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
				getAppPath: () => path.join(__dirname, '..', '..'),
				getName: () => 'wordpress-contributor-toolkit',
				setName() {},
				getVersion: () => '0.0.0-test',
				// The `wpct://` registration runs at require time too (#464).
				requestSingleInstanceLock: () => true,
				setAsDefaultProtocolClient: () => true,
				setActivationPolicy: (policy) => activationPolicyCalls.push(policy)
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
function loadMainWith({ isPackaged, envValue, setPathThrows = false, hideWindows }) {
	const stub = createElectronStub({ isPackaged, setPathThrows });
	const originalLoad = Module._load;
	const originalEnv = process.env.TOOLKIT_USER_DATA_DIR;
	const originalHide = process.env.TOOLKIT_HIDE_WINDOWS;
	if (envValue === undefined) delete process.env.TOOLKIT_USER_DATA_DIR;
	else process.env.TOOLKIT_USER_DATA_DIR = envValue;
	if (hideWindows === undefined) delete process.env.TOOLKIT_HIDE_WINDOWS;
	else process.env.TOOLKIT_HIDE_WINDOWS = hideWindows;
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
		if (originalHide === undefined) delete process.env.TOOLKIT_HIDE_WINDOWS;
		else process.env.TOOLKIT_HIDE_WINDOWS = originalHide;
	}
	return stub;
}

test('dev run with TOOLKIT_USER_DATA_DIR set redirects userData to that dir', () => {
	const target = path.join(os.tmpdir(), 'wpct-userdata-test');
	const calls = loadMainWith({ isPackaged: false, envValue: target }).setPathCalls;
	assert.deepEqual(calls, [{ name: 'userData', value: target }]);
});

test('dev run without the variable leaves userData alone', () => {
	const calls = loadMainWith({ isPackaged: false, envValue: undefined }).setPathCalls;
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
		calls = loadMainWith({ isPackaged: false, envValue: target, setPathThrows: true }).setPathCalls;
	});
	assert.deepEqual(calls, [{ name: 'userData', value: target }]);
});

test('a packaged app ignores TOOLKIT_USER_DATA_DIR entirely', () => {
	const calls = loadMainWith({
		isPackaged: true,
		envValue: path.join(os.tmpdir(), 'wpct-userdata-test')
	}).setPathCalls;
	assert.deepEqual(calls, []);
});

// TOOLKIT_HIDE_WINDOWS (TESTING.md) is the same kind of switch: honoured in a dev
// run with a throwaway profile, which the journeys always have, and dead
// otherwise. A packaged app, or a plain `npm start` from a shell the variable
// was left exported in, must never start with no window and no Dock icon. Only
// its module-scope half is reachable here; what it does to the window is
// ipc-wiring's. The macOS and the other branch each run on their own platform
// in unit-tests.yml.
const PROFILE = path.join(os.tmpdir(), 'wpct-userdata-test');

test('an e2e run with TOOLKIT_HIDE_WINDOWS=1 keeps the app out of the Dock on macOS, and does nothing elsewhere', () => {
	const calls = loadMainWith({ isPackaged: false, envValue: PROFILE, hideWindows: '1' }).activationPolicyCalls;
	assert.deepEqual(calls, process.platform === 'darwin' ? ['accessory'] : []);
});

test('a dev run without TOOLKIT_HIDE_WINDOWS leaves the activation policy alone', () => {
	assert.deepEqual(loadMainWith({ isPackaged: false, envValue: PROFILE }).activationPolicyCalls, []);
});

test('a plain npm start ignores TOOLKIT_HIDE_WINDOWS left exported in its shell', () => {
	assert.deepEqual(loadMainWith({ isPackaged: false, hideWindows: '1' }).activationPolicyCalls, []);
});

test('a packaged app ignores TOOLKIT_HIDE_WINDOWS entirely', () => {
	assert.deepEqual(loadMainWith({ isPackaged: true, envValue: PROFILE, hideWindows: '1' }).activationPolicyCalls, []);
});
