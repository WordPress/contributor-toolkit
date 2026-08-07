'use strict';

// The handlers in src/main.js delegate their decisions to small modules, and
// every other test in this directory talks to those modules. These tests talk to
// the handlers, and assert only one thing: that the handler still reaches its
// module, with the arguments the module expects.
//
// That is the gap #129 describes. `test/external-url.test.cjs` proves the guard
// refuses `file:` URLs; nothing proved the `url:open` handler still asks it. Take
// the call out of main.js and the module's own suite stays green while the app
// is unguarded — the module can be perfect and the wire cut.
//
// So these are deliberately shallow. What a module does with its arguments is
// the module's own test's job; what is here is the connection, and a handler
// that stops using its module has to fail something.
//
// The last test is a coverage guard: every channel main.js registers must be
// classified below, so a new handler cannot quietly arrive with its wiring
// untested.
//
// The harness lives here rather than in a helper file because `node --test`
// discovers every .cjs under test/ and would report the helper as a file of its
// own; the suite is run without a path on purpose (scripts/run-tests-electron.cjs).

const test = require('node:test');
const { after } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const git = require('isomorphic-git');

const SRC_DIR = path.join(__dirname, '..', 'src');
const MAIN_PATH = path.join(SRC_DIR, 'main.js');

// --- the harness ---------------------------------------------------------
//
// Loading main.js outside Electron needs only one thing replaced:
// `require('electron')`. Nothing in the startup path runs — `app.whenReady()`
// returns a promise that never settles — so the require registers handlers and
// does nothing else.

// A recording stand-in for the parts of `electron` main.js destructures. Every
// method a handler can reach has to exist here, because a missing one would
// throw inside the handler and read as a wiring failure.
function createElectronStub() {
	const handlers = new Map();
	const oneWay = new Map();
	const appEvents = new Map();
	const windows = [];
	const calls = {
		openExternal: [],
		openPath: [],
		showItemInFolder: [],
		showSaveDialog: [],
		showOpenDialog: [],
		applicationMenu: []
	};

	// What `dialog` returns is per-test: git:save-patch branches on `canceled`.
	const dialogResults = { showSaveDialog: { canceled: true }, showOpenDialog: { canceled: true } };

	class BrowserWindowStub {
		constructor(options) {
			this.options = options;
			this.loaded = [];
			this.sent = [];
			const self = this;
			this.webContents = {
				send: (channel, payload) => { self.sent.push({ channel, payload }); },
				on() {},
				once() {},
				setWindowOpenHandler() {},
				openDevTools() {}
			};
			windows.push(this);
		}
		loadFile(file) { this.loaded.push({ type: 'file', file }); }
		loadURL(url) { this.loaded.push({ type: 'url', url }); }
		on() {}
		once() {}
		show() {}
		close() {}
		static getAllWindows() { return windows; }
	}

	const electron = {
		app: {
			// Never settles: whatever the ready path does, it is not what these
			// tests are about, and leaving it unrun keeps the load side-effect-free.
			whenReady: () => new Promise(() => {}),
			on(event, listener) {
				if (!appEvents.has(event)) appEvents.set(event, []);
				appEvents.get(event).push(listener);
			},
			quit() {},
			exit() {},
			getPath: () => os.tmpdir(),
			getAppPath: () => path.join(SRC_DIR, '..'),
			getName: () => 'wordpress-contributor-toolkit',
			setName() {},
			getVersion: () => '0.0.0-test',
			isPackaged: false
		},
		BrowserWindow: BrowserWindowStub,
		Menu: {
			buildFromTemplate: (template) => ({ template }),
			setApplicationMenu: (menu) => { calls.applicationMenu.push(menu); }
		},
		ipcMain: {
			handle(channel, listener) { handlers.set(channel, listener); },
			handleOnce(channel, listener) { handlers.set(channel, listener); },
			// One-way channels are recorded separately rather than ignored: a
			// fire-and-forget renderer→main message is still a handler that can
			// stop calling its module, and a no-op here would hide it from the
			// coverage guard below — which exists to make exactly that impossible.
			on(channel, listener) { oneWay.set(channel, listener); },
			once(channel, listener) { oneWay.set(channel, listener); },
			removeHandler(channel) { handlers.delete(channel); }
		},
		dialog: {
			async showSaveDialog(options) {
				calls.showSaveDialog.push(options);
				return dialogResults.showSaveDialog;
			},
			async showOpenDialog(options) {
				calls.showOpenDialog.push(options);
				return dialogResults.showOpenDialog;
			}
		},
		shell: {
			async openExternal(url) { calls.openExternal.push(url); },
			async openPath(target) { calls.openPath.push(target); },
			showItemInFolder(target) { calls.showItemInFolder.push(target); }
		}
	};

	return { electron, handlers, oneWay, appEvents, windows, calls, dialogResults };
}

function clearSrcCache() {
	for (const filename of Object.keys(require.cache)) {
		if (filename.startsWith(SRC_DIR + path.sep)) delete require.cache[filename];
	}
}

// True for the real `electron` package, under any specifier that reaches it.
// Requiring it is not inert: node_modules/electron/index.js resolves the binary
// path at module scope and spawns Electron's installer when it is missing, so a
// cold checkout would start a download — into the same dist directory that
// test/electron-node-version.test.cjs spawns the binary from, at the same time,
// since node --test runs files concurrently. Hence the stub, and hence the test
// at the end of this file that pins it.
function isElectronPackage(request, resolvedId) {
	if (request === 'electron' || request.startsWith('electron/')) return true;
	return typeof resolvedId === 'string'
		&& resolvedId.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`);
}

// `stubs` is keyed by the specifier as main.js writes it ('./trunk-update',
// 'child_process', 'smtp-server'), and the value holds only the exports to
// replace: the rest of the real module is kept, so stubbing one function does
// not silently disable its neighbours.
//
// Populating this map requires the real modules, and some of them
// (src/logging.js) require `electron` — so it has to run with the hook already
// installed, not before it. That ordering is the whole reason this is called
// from inside loadMain's try block rather than ahead of it.
function resolveStubs(stubs, resolved) {
	for (const [specifier, overrides] of Object.entries(stubs)) {
		// require.resolve rather than the specifier itself: a builtin resolves to
		// its own name, but a package resolves to the file path the load hook will
		// compare against, and keying it by name would leave the stub unapplied.
		const id = specifier.startsWith('.')
			? require.resolve(path.join(SRC_DIR, specifier))
			: require.resolve(specifier);
		const stub = { ...require(id), ...overrides };
		resolved.set(id, stub);
		// A builtin is the same module under both spellings, and main.js writing
		// `require('node:child_process')` instead must not silently leave the stub
		// unapplied — that would spawn a real process on the way to failing.
		if (Module.isBuiltin(specifier)) {
			resolved.set(id.startsWith('node:') ? id.slice(5) : `node:${id}`, stub);
		}
	}

	return resolved;
}

// Stands in for the IpcMainInvokeEvent, recording what a handler streams back.
function createIpcEvent() {
	const sent = [];
	return {
		sent,
		sender: {
			send(channel, payload) { sent.push({ channel, payload }); },
			isDestroyed: () => false
		}
	};
}

// Records every call and returns a caller-chosen value, so a test can assert
// both that the module was reached and with what.
function spy(implementation = () => undefined) {
	const calls = [];
	const fn = (...args) => {
		calls.push(args);
		return implementation(...args);
	};
	fn.calls = calls;
	return fn;
}

// Returns the recorders plus `invoke`, which calls a handler the way ipcMain
// would.
function loadMain({ stubs = {} } = {}) {
	const recorder = createElectronStub();
	const stubbed = new Map();

	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (isElectronPackage(request)) return recorder.electron;

		let id;
		try {
			id = Module._resolveFilename(request, parent, isMain);
		} catch {
			return originalLoad.apply(this, arguments);
		}

		if (isElectronPackage(request, id)) return recorder.electron;
		if (stubbed.has(id)) return stubbed.get(id);
		return originalLoad.apply(this, arguments);
	};

	// Before and after: a previous load must not leave a stubbed src module in
	// the cache for the next one, and main.js itself has to be re-executed each
	// time so its handlers close over this load's stubs.
	clearSrcCache();
	try {
		// Inside the hook, deliberately: building the stubs requires the real
		// modules, and src/logging.js requires `electron`.
		resolveStubs(stubs, stubbed);
		require(MAIN_PATH);
	} finally {
		Module._load = originalLoad;
		clearSrcCache();
	}

	return {
		...recorder,
		channels: () => [...recorder.handlers.keys()],
		invoke(channel, ...args) {
			return this.invokeWith(channel, createIpcEvent(), ...args);
		},
		invokeWith(channel, event, ...args) {
			const handler = recorder.handlers.get(channel);
			if (!handler) throw new Error(`No handler registered for '${channel}'`);
			return handler(event, ...args);
		},
		// Runs every listener registered for an app lifecycle event, so hooks
		// like the before-quit child sweep are reachable without an app.
		async emitAppEvent(event, ...args) {
			for (const listener of recorder.appEvents.get(event) || []) await listener(...args);
		}
	};
}

// --- the wiring tests ----------------------------------------------------

// logging is stubbed everywhere: electron-log resolves its file path through
// `app.getPath`, which the electron stub only pretends to have, and a test has
// no business writing to the contributor's log file either way.
function silentLogging() {
	return {
		'./logging': {
			initLogging: () => {},
			getLogFilePath: () => '',
			logChildOutput: () => {},
			flushChildOutput: () => {},
			logEvent: () => {},
			logError: () => {}
		}
	};
}

// --- url:open -> src/external-url.js -------------------------------------

test('url:open asks external-url whether the address may be opened', async () => {
	const openExternalUrl = spy(async () => true);
	const main = loadMain({ stubs: { ...silentLogging(), './external-url': { openExternalUrl } } });

	await main.invoke('url:open', 'https://core.trac.wordpress.org');

	assert.equal(openExternalUrl.calls.length, 1);
	const [url, options] = openExternalUrl.calls[0];
	assert.equal(url, 'https://core.trac.wordpress.org');
	// The module cannot open anything by itself: it decides, and calls back with
	// the address it approved. Passing something other than these two functions
	// would leave the guard unable to act on its own answer.
	assert.equal(typeof options.openExternal, 'function');
	assert.equal(typeof options.onRefused, 'function');
});

// The end of the wire, with the real module in place: this is the assertion the
// issue is about. It fails if the handler stops consulting external-url, however
// it stops — deleted call, renamed export, or a `shell.openExternal(url)` added
// beside it.
test('url:open refuses a file: address and opens an http one', async () => {
	const logEvent = spy();
	const main = loadMain({ stubs: { './logging': { ...silentLogging()['./logging'], logEvent } } });

	assert.equal(await main.invoke('url:open', 'file:///etc/passwd'), false);
	assert.deepEqual(main.calls.openExternal, []);
	// Refusals are logged rather than dropped, so a caller that trips the guard
	// is visible in the file contributors attach to bug reports.
	assert.equal(logEvent.calls.length, 1);
	assert.equal(logEvent.calls[0][0], 'url');
	assert.match(logEvent.calls[0][1], /refused to open file:\/\/\/etc\/passwd/);

	assert.equal(await main.invoke('url:open', 'https://wordpress.org'), true);
	// The parsed href, not the caller's string: what was checked is what is
	// opened (see external-url.js).
	assert.deepEqual(main.calls.openExternal, ['https://wordpress.org/']);
});

// The settings store is an ESM-only dependency loaded through a dynamic import,
// which `Module._load` cannot intercept — so it lives behind src/settings-store.js
// and this stands in for it. Values are held in a plain object the test can read
// back, because "the store was not written" is half of what the delete gate
// promises (#145).
function fakeSettingsStore(initial = {}) {
	const values = { sites: [], siteMeta: {}, ...initial };
	const store = {
		// A copy, like the real one: `conf` re-reads and re-deserializes the file on
		// every `get`, so a handler that mutates what it read and never sets it back
		// loses the write in the app. Returning the live object here would let that
		// bug pass.
		get: (key) => structuredClone(values[key]),
		set: (key, value) => { values[key] = value; }
	};
	return { values, stubs: { './settings-store': { getStore: async () => store } } };
}

// --- sites:delete -> src/site-registry.js --------------------------------

test('sites:delete asks site-registry whether the path may be removed', async () => {
	const deleteRegisteredSite = spy(async () => true);
	const settings = fakeSettingsStore({ sites: ['/sites/wp'] });
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './site-registry': { deleteRegisteredSite } }
	});

	await main.invoke('sites:delete', '/sites/wp');

	assert.equal(deleteRegisteredSite.calls.length, 1);
	const [sitePath, options] = deleteRegisteredSite.calls[0];
	assert.equal(sitePath, '/sites/wp');
	// The module decides on the registry it is handed and acts through the
	// callbacks: without the store's own `sites` array it would be deciding
	// against nothing, and without the callbacks it could not act on its answer.
	assert.deepEqual(options.sites, ['/sites/wp']);
	assert.equal(typeof options.forget, 'function');
	assert.equal(typeof options.remove, 'function');
	assert.equal(typeof options.onRefused, 'function');
});

// The end of the wire, with the real module and the real `fse.remove` in place,
// on real directories: this is the assertion #145 is about. It fails if the
// handler stops consulting site-registry, however it stops — deleted call,
// renamed export, or a bare `fse.remove(sitePath)` added beside it.
test('sites:delete removes a registered directory and refuses an unregistered one', async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-delete-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));
	const registered = path.join(root, 'registered');
	const unregistered = path.join(root, 'unregistered');
	for (const dir of [registered, unregistered]) {
		fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
		fs.writeFileSync(path.join(dir, 'src', 'index.php'), '<?php\n');
	}

	const logEvent = spy();
	const settings = fakeSettingsStore({
		sites: [registered],
		siteMeta: { [registered]: { label: 'mine' }, [unregistered]: { label: 'not mine' } }
	});
	const main = loadMain({
		stubs: { './logging': { ...silentLogging()['./logging'], logEvent }, ...settings.stubs }
	});

	// A path the app never registered: neither the directory nor the store may
	// be touched, and the refusal is logged rather than dropped so a caller that
	// trips the guard is visible in the file contributors attach to bug reports.
	assert.equal(await main.invoke('sites:delete', unregistered), false);
	assert.equal(fs.existsSync(unregistered), true);
	assert.deepEqual(settings.values.sites, [registered]);
	assert.deepEqual(Object.keys(settings.values.siteMeta).sort(), [registered, unregistered].sort());
	assert.equal(logEvent.calls.length, 1);
	assert.equal(logEvent.calls[0][0], 'sites');
	assert.match(logEvent.calls[0][1], /refused to delete .*unregistered/);

	// And the other branch, so the guard cannot be passed by refusing everything.
	assert.equal(await main.invoke('sites:delete', registered), true);
	assert.equal(fs.existsSync(registered), false);
	assert.deepEqual(settings.values.sites, []);
	assert.deepEqual(Object.keys(settings.values.siteMeta), [unregistered]);
});

// --- site:status -> src/trunk-update.js ----------------------------------

test('site:status reports the trunk snapshot trunk-update read, not its own guess', async () => {
	const readTrunkInfo = spy(async () => ({ trunkOid: 'abc123', trunkDate: '2026-01-01T00:00:00Z' }));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': { initialized: true } } });
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './trunk-update': { readTrunkInfo } }
	});

	const status = await main.invoke('site:status', '/sites/wp');

	assert.deepEqual(readTrunkInfo.calls, [['/sites/wp']]);
	assert.equal(status.trunkOid, 'abc123');
	assert.equal(status.trunkDate, '2026-01-01T00:00:00Z');
	// Written through to siteMeta so the sidebar can render staleness dots from
	// siteMeta alone, without per-site git I/O (#94).
	assert.equal(settings.values.siteMeta['/sites/wp'].trunkOid, 'abc123');
});

// --- git:* -> src/trunk-update.js ----------------------------------------

test('git:worktree-dirty reports what trunk-update found, not its own guess', async () => {
	const collectDirtyFiles = spy(async () => ['src/wp-admin/edit.php', 'untracked.txt']);
	const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { collectDirtyFiles } } });

	const result = await main.invoke('git:worktree-dirty', '/sites/wp');

	assert.deepEqual(collectDirtyFiles.calls, [['/sites/wp']]);
	assert.deepEqual(result, {
		ok: true,
		dirty: true,
		changedCount: 2,
		files: ['src/wp-admin/edit.php', 'untracked.txt']
	});
});

test('git:discard-changes resets through trunk-update and clears the applied-patch record', async () => {
	const discardChanges = spy(async () => {});
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': { appliedPatch: { label: 'x' } } } });
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './trunk-update': { discardChanges } } });

	assert.deepEqual(await main.invoke('git:discard-changes', '/sites/wp'), { ok: true });
	assert.deepEqual(discardChanges.calls, [['/sites/wp']]);
	// The record is cleared with the reset, not left for a later trunk update to
	// clear — otherwise a failed update leaves a revert banner for a gone patch.
	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch, null);
});

test('git:update-trunk hands the update to trunk-update and streams its log back', async () => {
	let called;
	const started = new Promise((resolve) => { called = resolve; });
	// Never resolves: the handler's work after the update is store writes, which
	// are not what this test is about and need an Electron app to succeed.
	const updateToLatestTrunk = spy((options) => { called(options); return new Promise(() => {}); });
	const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { updateToLatestTrunk } } });

	const event = createIpcEvent();
	const { updateId } = await main.invokeWith('git:update-trunk', event, '/sites/wp');
	const options = await started;

	assert.equal(options.dir, '/sites/wp');
	assert.equal(options.url, 'https://github.com/WordPress/wordpress-develop.git');

	// The module reports progress by calling back, and the renderer only sees it
	// if the handler forwards it under the id it just handed out.
	options.onLog('Fetching…\n');
	assert.deepEqual(event.sent, [
		{ channel: 'git:update-trunk:log', payload: { updateId, data: 'Fetching…\n' } }
	]);
});

test('sites:add normalizes line endings before adopting a directory', async () => {
	// Throwing ends the handler at its first delegation, which is the only thing
	// under test — and it has to end there. The next line is a store write, and
	// this test hands the harness no settings store, so reaching it would start
	// the real `import('electron-store')`, whose own `import {app} from 'electron'`
	// loads the real electron package through the ESM loader, out of reach of the
	// hook. See the guard test below for why that must not happen.
	const ensureAutocrlf = spy(async () => { throw new Error('not a repository'); });
	const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { ensureAutocrlf } } });

	await main.invoke('sites:add', '/sites/wp').catch(() => {});

	assert.deepEqual(ensureAutocrlf.calls, [['/sites/wp']]);
});

// --- git:get-patch -> src/trunk-update.js + src/git-update.cjs -----------

// Patch generation is the one delegation that needs a real repository:
// normalizeEol is called per file, on content read out of the object store.
test('git:get-patch normalizes both sides of the diff through git-update', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\nline2\n');
	await git.add({ fs, dir, filepath: 'text.txt' });
	const head = await git.commit({ fs, dir, message: 'init', author: { name: 'test', email: 'test@example.com' } });
	// Without it the handler falls back to fetching wordpress-develop, and this
	// suite does not touch the network.
	await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/trunk', value: head });
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\nline2\nline3\n');

	const real = require('../src/git-update.cjs');
	const normalizeEol = spy(real.normalizeEol);
	const ensureAutocrlf = spy(async () => {});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'./git-update.cjs': { normalizeEol },
			'./trunk-update': { ensureAutocrlf }
		}
	});

	const result = await main.invoke('git:get-patch', dir);

	assert.equal(result.ok, true);
	assert.match(result.patch, /\+line3/);
	// A CRLF checkout is otherwise a diff of every line in the file (#94), so
	// both sides have to go through the module — the committed blob and what is
	// on disk now.
	assert.equal(normalizeEol.calls.length, 2);
	assert.deepEqual(ensureAutocrlf.calls, [[dir]]);
});

// The other two entry points into the same patch path. They differ only in what
// they do with the result — a window, or a save dialog — so what is checked here
// is that they go through it at all rather than assembling a diff of their own.
test('git:create-patch and git:save-patch generate the patch the same way', async () => {
	for (const channel of ['git:create-patch', 'git:save-patch']) {
		// Throwing ends the handler at its first delegation — which is also what
		// keeps this test off the network, since the next step fetches
		// wordpress-develop when the repository has no origin/trunk.
		const ensureAutocrlf = spy(async () => { throw new Error('not a repository'); });
		const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { ensureAutocrlf } } });

		await main.invoke(channel, '/sites/wp');

		assert.deepEqual(ensureAutocrlf.calls, [['/sites/wp']], channel);
	}
});

// --- npm:* -> src/npm-runner.js + src/kill-tree.js -----------------------

// The npm handlers run the real runNpmWithEngineRetry, which calls
// ensureNodeShimDir() before it gets as far as the stubbed spawn — and that
// writes the PATH shims to a temp directory keyed by pid. It is module-local, so
// it cannot be stubbed; sweeping it afterwards is what keeps this suite from
// leaving a directory of executable scripts behind on every run, on both
// runtimes and on Windows.
after(() => {
	fs.rmSync(path.join(os.tmpdir(), `electron-node-shims-${process.pid}`), { recursive: true, force: true });
});

// A child process that never was: enough of one for the handler to wire its
// output and exit up, and to be handed to killChildTree on quit.
function fakeChild() {
	const child = new EventEmitter();
	// setEncoding is a no-op here but has to exist: the Playground handlers call
	// it on both streams before they attach a listener.
	child.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
	child.stderr = Object.assign(new EventEmitter(), { setEncoding() {} });
	child.pid = 4242;
	child.exitCode = null;
	child.kill = spy();
	return child;
}

function stubbedSpawn() {
	const spawned = [];
	const children = [];
	const spawn = (command, args, options) => {
		spawned.push({ command, args, options });
		const child = fakeChild();
		children.push(child);
		return child;
	};
	return { spawn, spawned, children };
}

// What buildChildEnv is asked to build with. Reaching the module is not enough:
// it cannot invent a shim directory, so a call that arrived without one returns
// a PATH with the string "undefined" on the front and a child npm with no node
// to find — while npm-runner's own suite, which supplies its arguments, stays
// green. The Windows-only values are asserted as present rather than as strings,
// because they are null off Windows and dropping the argument is exactly how a
// Windows-only spawn failure ships from a green macOS run.
function assertChildEnvRequest(buildChildEnv, label) {
	assert.equal(buildChildEnv.calls.length, 1, `${label}: buildChildEnv was not called exactly once`);
	const request = buildChildEnv.calls[0][0];
	assert.equal(typeof request.shimDir, 'string', `${label}: no shim directory, so a child npm cannot find a node`);
	for (const key of ['spawnPatchPath', 'npmCliPath', 'npxCliPath']) {
		assert.ok(key in request, `${label}: buildChildEnv was called without ${key}`);
	}
}

// The three cross-platform decisions every spawn in main.js makes. No module
// owns them — they are options handed to child_process, not behaviour someone
// else can test — so this is the only thing that fails when one is deleted
// (#146).
function assertCrossPlatformSpawnOptions(options, label) {
	assert.equal(options.shell, false, `${label}: must not run through a shell`);
	assert.equal(options.windowsHide, true, `${label}: must not flash a console window on Windows`);
	// Group leader on POSIX, so killChildTree can signal the whole tree; on
	// Windows detaching buys nothing and taskkill /T does the job instead.
	assert.equal(
		options.detached,
		process.platform !== 'win32',
		`${label}: a POSIX child must lead its own process group or kill-tree cannot reach its descendants`
	);
}

test('npm:install spawns the runner with the environment npm-runner built', async () => {
	const env = { PATH: '/shims', npm_config_engine_strict: 'false' };
	const buildChildEnv = spy(() => env);
	const createEngineMismatchDetector = spy(() => ({ push: () => {}, found: false }));
	const cp = stubbedSpawn();

	const main = loadMain({
		stubs: {
			...silentLogging(),
			'child_process': { spawn: cp.spawn },
			'./npm-runner': { buildChildEnv, createEngineMismatchDetector }
		}
	});

	const { installId } = await main.invoke('npm:install', '/sites/wp');
	assert.ok(installId);

	assert.equal(cp.spawned.length, 1);
	assert.equal(path.basename(cp.spawned[0].args[0]), 'install-runner.js');
	// The environment is the whole point of npm-runner: it is what makes a child
	// npm find Electron's Node. A handler that assembled its own would break
	// "zero prerequisites" without failing any of npm-runner's own tests.
	assert.equal(cp.spawned[0].options.env, env);
	assert.equal(createEngineMismatchDetector.calls.length, 1);
	assertChildEnvRequest(buildChildEnv, 'npm:install');
	assertCrossPlatformSpawnOptions(cp.spawned[0].options, 'npm:install');
});

test('npm:install asks npm-runner whether an engine failure is worth retrying', async () => {
	const cp = stubbedSpawn();
	const shouldRetryWithRelaxedEngines = spy(() => true);
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'child_process': { spawn: cp.spawn },
			'./npm-runner': { shouldRetryWithRelaxedEngines }
		}
	});

	await main.invoke('npm:install', '/sites/wp');
	cp.children[0].emit('close', 1, null);

	assert.equal(shouldRetryWithRelaxedEngines.calls.length, 1);
	assert.equal(shouldRetryWithRelaxedEngines.calls[0][0].code, 1);
	// Saying yes has to actually start a second attempt — the retry is the
	// module's decision, but only the handler can act on it (#54).
	assert.equal(cp.spawned.length, 2);
});

test('npm:run-script spawns the script runner through npm-runner too', async () => {
	const env = { PATH: '/shims' };
	const buildChildEnv = spy(() => env);
	const cp = stubbedSpawn();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'child_process': { spawn: cp.spawn },
			'./npm-runner': { buildChildEnv }
		}
	});

	await main.invoke('npm:run-script', '/sites/wp', 'build', ['--quiet']);

	assert.equal(cp.spawned.length, 1);
	assert.equal(path.basename(cp.spawned[0].args[0]), 'script-runner.js');
	assert.deepEqual(cp.spawned[0].args.slice(1), ['/sites/wp', 'build', '--quiet']);
	assert.equal(cp.spawned[0].options.env, env);
	assertChildEnvRequest(buildChildEnv, 'npm:run-script');
	assertCrossPlatformSpawnOptions(cp.spawned[0].options, 'npm:run-script');
});

test('npm:kill ends the script tree rather than signalling the runner alone', async (t) => {
	const cp = stubbedSpawn();
	const killChildTree = spy();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'child_process': { spawn: cp.spawn },
			'./kill-tree': { killChildTree }
		}
	});

	const { runId } = await main.invoke('npm:run-script', '/sites/wp', 'build');
	// The handler arms a SIGKILL escalation three seconds out; faking the clock
	// keeps the suite from waiting for a timer whose only job is a last resort.
	t.mock.timers.enable({ apis: ['setTimeout'] });

	assert.deepEqual(await main.invoke('npm:kill', { runId }), { ok: true });

	// Same reason as the quit sweep: a script is a tree (runner -> npm -> shell ->
	// grunt), and child.kill() leaves everything past the first link running (#83).
	assert.deepEqual(killChildTree.calls, [[cp.children[0]]]);
	assert.deepEqual(cp.children[0].kill.calls, []);
});

// Spins until the stubbed spawn has been called `count` times, so a test can wait
// for a handler that spawns after an await without knowing how many microtasks
// that takes. Unlike reachSpawn it counts cumulatively, so several handlers can be
// driven to their spawns in one test.
async function waitForSpawnCount(cp, count) {
	for (let turn = 0; turn < 100 && cp.spawned.length < count; turn++) {
		await new Promise(setImmediate);
	}
	assert.equal(cp.spawned.length, count, `expected ${count} spawns, saw ${cp.spawned.length}`);
}

// The sweep walks four registries — installs, scripts, per-site Playground servers
// and the shared web server (#83). Only starting an install left the other three
// empty, so their spread lines swept nothing and deleting any of them kept this
// green (#160). Drive one child into each registry and assert every one goes
// through kill-tree, and none through child.kill().
test('quitting sweeps every kind of running child through kill-tree', async (t) => {
	const cp = stubbedSpawn();
	const killChildTree = spy();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			// npm:install's onDone reaches getStore(); stand it in so closing that
			// child on the way out does not pull in the real electron-store (and, in
			// turn, the real electron package the harness must never load).
			...fakeSettingsStore().stubs,
			...noSmtpServer(),
			...noWebProbe(),
			...webDirOnDisk(),
			'child_process': { spawn: cp.spawn },
			'./kill-tree': { killChildTree }
		}
	});

	// The two npm handlers register their child and resolve as soon as they spawn.
	// The two Playground handlers hold a promise until the server reports a URL, so
	// drive each only as far as its spawn; the child sits in its registry meanwhile.
	await main.invoke('npm:install', '/sites/wp');
	await main.invoke('npm:run-script', '/sites/wp', 'build');
	const pendingServer = main.invoke('playground:start', '/sites/wp');
	await waitForSpawnCount(cp, 3);
	const pendingWeb = main.invoke('playground-web:start');
	await waitForSpawnCount(cp, 4);

	// Settle the two held promises on the way out — closing each child fires the
	// close handler that resolves its start request — so a failed assertion below
	// does not leave the suite waiting their multi-second URL timers.
	t.after(async () => {
		for (const child of [cp.children[2], cp.children[3]]) child.emit('close', 0, null);
		await Promise.all([pendingServer, pendingWeb]);
	});

	await main.emitAppEvent('before-quit');

	// Every child — one from each registry — goes through kill-tree exactly once,
	// and none through child.kill(), which would leave each tree's descendants (a
	// Playground server's PHP-WASM worker among them) holding its port until the
	// machine restarts (#83, #160). Asserted order-independently: which registry the
	// sweep walks first is not observable behaviour, only that it misses none.
	const swept = killChildTree.calls.map(([child]) => child);
	assert.equal(swept.length, cp.children.length, 'the sweep skipped a registry');
	for (const child of cp.children) {
		assert.equal(swept.filter((c) => c === child).length, 1, 'each running child is swept exactly once');
		assert.deepEqual(child.kill.calls, []);
	}
});

// --- playground:* / playground-web:* -> the same two modules --------------

// Starting the per-site SMTP server ends by writing its port to electron-store,
// the dynamic ESM import this harness cannot replace (see the guard test below).
// Throwing from the SMTPServer constructor stops that path at its first line,
// and playground:start's own `.catch` turns it into "no SMTP" — the same shape
// as a machine where the port could not be bound, and the branch that falls back
// to port 25.
function noSmtpServer() {
	return {
		'smtp-server': {
			SMTPServer: function SMTPServerStub() { throw new Error('no SMTP server in tests'); }
		}
	};
}

// playground-web:start probes the port before spawning anything, and treats a
// reachable server as already started. A stubbed request that only ever errors
// keeps that decision off the machine's real network.
function noWebProbe() {
	return {
		'http': {
			get() {
				const request = new EventEmitter();
				request.destroy = () => {};
				request.setTimeout = () => {};
				setImmediate(() => request.emit('error', new Error('ECONNREFUSED')));
				return request;
			}
		}
	};
}

// The web server is served out of a `local-playground-web` directory that only
// exists in a built app, and the handler returns early without it.
function webDirOnDisk() {
	return { 'fs': { existsSync: () => true } };
}

// Both start handlers spawn after an await and then wait for the server to
// report a URL, holding a timer measured in tens of seconds until it does. So a
// test drives them to the spawn and no further, and closing the child on the way
// out settles the request — registered as a hook rather than a last line so a
// failed assertion does not leave the suite waiting that timer out.
async function reachSpawn(t, cp, pending) {
	for (let turn = 0; turn < 100 && cp.spawned.length === 0; turn++) {
		await new Promise(setImmediate);
	}
	t.after(async () => {
		for (const child of cp.children) child.emit('close', 0, null);
		await pending;
	});
	assert.equal(cp.spawned.length, 1, 'the handler never reached its spawn');
}

test('playground:start spawns the server runner with the environment npm-runner built', async (t) => {
	const env = { PATH: '/shims' };
	const buildChildEnv = spy(() => env);
	const cp = stubbedSpawn();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...noSmtpServer(),
			'child_process': { spawn: cp.spawn },
			'./npm-runner': { buildChildEnv }
		}
	});

	await reachSpawn(t, cp, main.invoke('playground:start', '/sites/wp'));

	assert.equal(path.basename(cp.spawned[0].args[0]), 'server-runner.js');
	assert.equal(cp.spawned[0].options.env, env);
	assertChildEnvRequest(buildChildEnv, 'playground:start');
	// The SMTP settings server-runner.js reads ride along as extras instead of
	// replacing the environment. Hand-building it here is what kept the Playground
	// path outside npm-runner's tests, and what made "zero prerequisites" hold on
	// the npm path but not this one (#146).
	assert.equal(buildChildEnv.calls[0][0].extraEnv.WP_MAIL_SMTP_HOST, '127.0.0.1');
	assert.equal(buildChildEnv.calls[0][0].extraEnv.WP_MAIL_SMTP_PORT, '25');
	assertCrossPlatformSpawnOptions(cp.spawned[0].options, 'playground:start');
});

test('playground-web:start spawns its runner through npm-runner too', async (t) => {
	const env = { PATH: '/shims' };
	const buildChildEnv = spy(() => env);
	const cp = stubbedSpawn();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...noWebProbe(),
			...webDirOnDisk(),
			'child_process': { spawn: cp.spawn },
			'./npm-runner': { buildChildEnv }
		}
	});

	await reachSpawn(t, cp, main.invoke('playground-web:start'));

	assert.equal(path.basename(cp.spawned[0].args[0]), 'playground-web-runner.js');
	assert.equal(cp.spawned[0].options.env, env);
	assertChildEnvRequest(buildChildEnv, 'playground-web:start');
	assertCrossPlatformSpawnOptions(cp.spawned[0].options, 'playground-web:start');
});

test('playground:stop ends the server tree rather than signalling the child', async (t) => {
	const cp = stubbedSpawn();
	const killChildTree = spy();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...noSmtpServer(),
			'child_process': { spawn: cp.spawn },
			'./kill-tree': { killChildTree }
		}
	});

	await reachSpawn(t, cp, main.invoke('playground:start', '/sites/wp'));

	assert.deepEqual(await main.invoke('playground:stop', '/sites/wp'), { ok: true });
	// The Playground server is a tree too — the runner spawns the PHP-WASM worker
	// — so stopping a site with child.kill() left it running (#146, same class as
	// #83).
	assert.deepEqual(killChildTree.calls, [[cp.children[0]]]);
	assert.deepEqual(cp.children[0].kill.calls, []);
});

test('playground-web:stop ends the web server tree rather than signalling the child', async (t) => {
	const cp = stubbedSpawn();
	const killChildTree = spy();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...noWebProbe(),
			...webDirOnDisk(),
			'child_process': { spawn: cp.spawn },
			'./kill-tree': { killChildTree }
		}
	});

	await reachSpawn(t, cp, main.invoke('playground-web:start'));

	assert.deepEqual(await main.invoke('playground-web:stop'), { ok: true });
	assert.deepEqual(killChildTree.calls, [[cp.children[0]]]);
	assert.deepEqual(cp.children[0].kill.calls, []);
});

// --- ticket handler (#109) -----------------------------------------------

test('sites:set-ticket validates the reference through trac-ticket', async () => {
	const settings = fakeSettingsStore({ sites: ['/sites/wp'] });
	const parseTicketRef = spy(() => ({ ok: false, error: 'not a ticket' }));
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './renderer/trac-ticket.cjs': { parseTicketRef } }
	});

	const result = await main.invoke('sites:set-ticket', '/sites/wp', '62281');

	assert.deepEqual(parseTicketRef.calls, [['62281']]);
	assert.deepEqual(result, { ok: false, error: 'not a ticket' });
});

test('sites:set-ticket refuses unregistered site paths before writing metadata', async () => {
	const settings = fakeSettingsStore({ sites: ['/sites/wp'] });
	const parseTicketRef = spy(() => ({ ok: true, id: 62281 }));
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './renderer/trac-ticket.cjs': { parseTicketRef } }
	});

	const result = await main.invoke('sites:set-ticket', '/sites/unknown', '62281');

	assert.deepEqual(result, { ok: false, error: 'Site is not registered' });
	assert.deepEqual(parseTicketRef.calls, []);
	assert.deepEqual(settings.values.siteMeta, {});
});

// --- apply handlers (#11) ------------------------------------------------

test('git:preview-patch reads the patch through patch-plan', async () => {
	const parsePatchFiles = spy(() => ({ ok: false, error: 'unreadable' }));
	const main = loadMain({ stubs: { ...silentLogging(), './patch-plan.cjs': { parsePatchFiles, planApply: () => ({}) } } });

	const result = await main.invoke('git:preview-patch', '/sites/wp', 'PATCH TEXT');

	assert.deepEqual(parsePatchFiles.calls, [['PATCH TEXT']]);
	assert.deepEqual(result, { ok: false, error: 'unreadable' });
});

// git:apply-patch reads the store for its guard before delegating, which is the
// seam fakeSettingsStore stands in for — so it is a wired handler, not a hole.
// It streams, so its result comes back on the :done channel, not the return.
async function applyDone(event, applyId, cap = 50) {
	for (let i = 0; i < cap; i++) {
		const hit = event.sent.find((m) => m.channel === 'git:apply-patch:done' && m.payload.applyId === applyId);
		if (hit) return hit.payload;
		await new Promise((r) => setImmediate(r));
	}
	throw new Error('git:apply-patch never reported done');
}

test('git:apply-patch refuses an unregistered site path before touching patch-apply', async () => {
	const applyPatchToDir = spy(async () => ({ ok: true, applied: [], skipped: [] }));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'] });
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './patch-apply': { applyPatchToDir } } });

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/unknown', { patchText: 'P' });

	assert.deepEqual(await applyDone(event, applyId), { applyId, ok: false, error: 'Site is not registered' });
	assert.deepEqual(applyPatchToDir.calls, []);
});

test('git:apply-patch delegates a forward apply to patch-apply and records it', async () => {
	const applyPatchToDir = spy(async () => ({ ok: true, applied: ['src/a.php'], skipped: [] }));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'] });
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './patch-apply': { applyPatchToDir } } });

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { patchText: 'PATCH', label: 'PR 11705' });
	const done = await applyDone(event, applyId);

	assert.equal(done.ok, true);
	assert.equal(applyPatchToDir.calls.length, 1);
	const [args] = applyPatchToDir.calls[0];
	assert.equal(args.dir, '/sites/wp');
	assert.equal(args.patchText, 'PATCH');
	assert.equal(args.reverse, false);
	// The revert record is what makes Revert possible; without it the patch is
	// applied but silently unrevertable.
	const stored = settings.values.siteMeta['/sites/wp'].appliedPatch;
	assert.equal(stored.label, 'PR 11705');
	assert.equal(stored.text, 'PATCH');
	assert.deepEqual(stored.files, ['src/a.php']);
});

test('git:apply-patch refuses a second patch while one is already applied', async () => {
	const applyPatchToDir = spy(async () => ({ ok: true, applied: [], skipped: [] }));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'first', text: 'X' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './patch-apply': { applyPatchToDir } } });

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { patchText: 'SECOND' });
	const done = await applyDone(event, applyId);

	assert.equal(done.ok, false);
	assert.match(done.error, /already applied/);
	assert.deepEqual(applyPatchToDir.calls, []);
});

test('git:apply-patch reverts using the stored patch text and clears the record', async () => {
	const applyPatchToDir = spy(async () => ({ ok: true, applied: ['src/a.php'], skipped: [] }));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'L', text: 'STORED' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './patch-apply': { applyPatchToDir } } });

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { reverse: true });
	const done = await applyDone(event, applyId);

	assert.equal(done.ok, true);
	const [args] = applyPatchToDir.calls[0];
	assert.equal(args.reverse, true);
	assert.equal(args.patchText, 'STORED', 'a revert applies the patch the app stored, not the renderer');
	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch, null);
});

// --- the harness's own guard ---------------------------------------------

// Requiring the real `electron` package is not a harmless fallback: its
// index.js resolves the binary path at module scope and spawns the installer
// when it is missing. On a cold checkout that means a download starting from
// this file while test/electron-node-version.test.cjs is spawning the binary out
// of the same dist directory — node --test runs files concurrently — which
// leaves a half-written framework and fails that test, not this one. It is also
// invisible locally, where the binary is already there.
//
// Two holes this closes, both of which reached the package on a cold checkout:
// stubs are built by merging over the real module, so stubbing src/logging.js
// means requiring it and it requires `electron` — that require has to happen
// with the hook already installed. And a handler that reaches the real
// `getStore()` starts `import('electron-store')`, which imports `electron`
// through the ESM loader, where `Module._load` does not apply and no hook can
// help. That is what src/settings-store.js is a seam for: a test whose handler
// touches the store stubs it (fakeSettingsStore above), and the rest stop short.
test('the harness never loads the real electron package', () => {
	loadMain({ stubs: silentLogging() });

	const loaded = Object.keys(require.cache)
		.filter((file) => file.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`));

	assert.deepEqual(loaded, [], 'the real electron package was required; the stub did not cover this path');
});

// --- coverage guard ------------------------------------------------------

// Channels whose wiring is asserted above.
const WIRED = new Set([
	'url:open',
	'git:worktree-dirty',
	'git:discard-changes',
	'git:update-trunk',
	'git:get-patch',
	'git:create-patch',
	'git:save-patch',
	'sites:add',
	'sites:delete',
	'site:status',
	'npm:install',
	'npm:run-script',
	'npm:kill',
	'playground:start',
	'playground:stop',
	'playground-web:start',
	'playground-web:stop',
	'sites:set-ticket',
	'git:preview-patch',
	'git:apply-patch'
]);

// Channels with no module to reach: they read or write electron-store, drive a
// dialog, or look at a path. Logging calls do not count as delegation — nothing
// branches on them. A channel here is a claim that there is no module call to
// delete.
const NO_DELEGATION = new Map([
	['sites:mark-update-complete', 'electron-store write'],
	['sites:get', 'electron-store read'],
	['sites:getAll', 'electron-store read'],
	['sites:set-skip-init', 'electron-store write'],
	['sites:mark-initialized', 'electron-store write'],
	['sites:forget', 'electron-store write'],
	['sites:set-label', 'electron-store write'],
	['dialog:choose-dir', 'opens the directory dialog'],
	['dialog:choose-patch-file', 'opens the file-open dialog and reads the chosen file'],
	['playground-web:available', 'checks a path on disk'],
	['smtp:get', 'electron-store read'],
	['smtp:clear', 'electron-store write'],
	['smtp:start', 'starts the in-process SMTP server'],
	['smtp:stop', 'stops the in-process SMTP server'],
	['wp-debug:start', 'tails a file'],
	['wp-debug:stop', 'stops a tail']
]);

// There used to be a third list here, UNWIRED_INVARIANTS: the Playground and
// kill handlers, which held the spawn and kill invariants inline instead of
// reaching a module, so deleting `detached:` from playground:start left this
// suite green. #146 routed them through buildChildEnv and killChildTree, and the
// options no module owns are asserted directly by
// assertCrossPlatformSpawnOptions — so they are ordinary WIRED entries now. If
// another handler ever earns that list back, it belongs here, named, rather than
// folded into NO_DELEGATION.

// Channels that do delegate, but whose call sits behind something this harness
// cannot stand in for yet. Each one is a known hole, not an oversight.
const NOT_REACHABLE = new Map([
	['wordpress:setup', 'calls ensureAutocrlf and readTrunkInfo only after cloning wordpress-develop over the network']
]);

const CLASSIFIED = [...WIRED, ...NO_DELEGATION.keys(), ...NOT_REACHABLE.keys()];

test('every IPC channel is classified: wired, or explicitly not', () => {
	const main = loadMain({ stubs: silentLogging() });
	const registered = main.channels();

	const unclassified = registered.filter((channel) => !CLASSIFIED.includes(channel));
	assert.deepEqual(
		unclassified,
		[],
		`New IPC handler(s) with no wiring test. Add a test above and list the channel in WIRED, ` +
		`or record why there is nothing to wire in NO_DELEGATION / NOT_REACHABLE.`
	);

	// A one-way channel is a handler too, and would otherwise arrive invisible to
	// this guard. There are none today; the day there is one, it gets classified
	// like everything else.
	assert.deepEqual([...main.oneWay.keys()], [], 'ipcMain.on channels are not covered by this guard yet');

	// The other direction: a channel that was renamed or removed must not leave a
	// stale entry behind, claiming coverage nothing provides any more.
	const stale = CLASSIFIED.filter((channel) => !registered.includes(channel));
	assert.deepEqual(stale, [], 'Classified channels that main.js no longer registers');
});
