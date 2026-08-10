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
	// And the sites being created right now, which the module refuses outright.
	// Without this the handler would be asking a question with half the facts,
	// and the answer would be to delete a tree a clone is writing into.
	assert.ok(Array.isArray(options.pending), 'the in-flight setups must reach the guard');
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
	// The handler parks the active ticket branch before updating (#108), which
	// reads the registry — so this needs a settings store, or `getStore()` would
	// start the real `import('electron-store')`. See the guard test below.
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': { branches: {} } } });
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './trunk-update': { updateToLatestTrunk } }
	});

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

// An update that dies after the forced checkout has already reset the tree
// (#184): the "incomplete" flag is still true, but the patch went with the
// reset, so its record cannot be allowed to outlive it — that is precisely the
// phantom the revert then cannot find.
test('git:update-trunk drops the applied-patch record when it fails after the checkout', async () => {
	const updateToLatestTrunk = spy(async () => {
		const e = new Error('worktree write failed');
		e.stage = 'checkout';
		e.worktreeReset = true;
		throw e;
	});
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'PR #8913', text: 'STORED' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './trunk-update': { updateToLatestTrunk } } });

	const event = createIpcEvent();
	const { updateId } = await main.invokeWith('git:update-trunk', event, '/sites/wp');
	await waitForSend(event, 'git:update-trunk:done');

	const done = await waitForDone(event, 'git:update-trunk:done', 'updateId', updateId);
	assert.equal(done.stage, 'checkout');
	assert.equal(settings.values.siteMeta['/sites/wp'].updateIncomplete, true);
	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch, null);
});

// The stage is coarser than the reset: it is set before the index walk and the
// ref write, either of which can fail with every file still in place. Reading
// it as "the tree was reset" would discard the only copy of a patch that is
// still applied, which is the failure #184 describes, inverted.
test('git:update-trunk keeps the applied-patch record when the checkout never started', async () => {
	const updateToLatestTrunk = spy(async () => {
		const e = new Error('could not read the index');
		e.stage = 'checkout';
		e.worktreeReset = false;
		throw e;
	});
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'PR #8913', text: 'STORED' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './trunk-update': { updateToLatestTrunk } } });

	const event = createIpcEvent();
	await main.invokeWith('git:update-trunk', event, '/sites/wp');
	await waitForSend(event, 'git:update-trunk:done');

	assert.equal(settings.values.siteMeta['/sites/wp'].updateIncomplete, true, 'the rebuild hint still applies');
	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch.text, 'STORED');
});

// A fetch failure moved nothing, so a patch still in the tree keeps its record.
test('git:update-trunk keeps the applied-patch record when the fetch fails', async () => {
	const updateToLatestTrunk = spy(async () => { throw new Error('offline'); });
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'PR #8913', text: 'STORED' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './trunk-update': { updateToLatestTrunk } } });

	const event = createIpcEvent();
	await main.invokeWith('git:update-trunk', event, '/sites/wp');
	await waitForSend(event, 'git:update-trunk:done');

	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch.text, 'STORED');
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

// The `git.add` loop that used to stage every untracked file before diffing was
// removed in #108 on the grounds that statusMatrix reports them unaided. This is
// the test that makes that claim falsifiable through the real handler: a new file
// must reach the patch, and the contributor's index must be no dirtier for it.
test('git:get-patch includes an untracked file without staging it (issues #108, #85)', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\n');
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\n');
	await git.add({ fs, dir, filepath: ['.gitignore', 'text.txt'] });
	await git.commit({ fs, dir, message: 'init', author: { name: 'test', email: 'test@example.com' } });

	fs.writeFileSync(path.join(dir, 'brand-new.php'), '<?php // a file the contributor added\n');
	// Ignored, and must stay out of the patch however the diff is computed.
	fs.mkdirSync(path.join(dir, 'node_modules'));
	fs.writeFileSync(path.join(dir, 'node_modules', 'junk.js'), 'noise\n');

	const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { ensureAutocrlf: async () => {} } } });
	const before = await git.statusMatrix({ fs, dir });
	const result = await main.invoke('git:get-patch', dir);

	assert.equal(result.ok, true);
	assert.match(result.patch, /brand-new\.php/, 'a new file is the common case and must be in the patch');
	assert.match(result.patch, /\+<\?php \/\/ a file the contributor added/);
	assert.doesNotMatch(result.patch, /node_modules/, 'gitignored paths stay out');
	assert.deepEqual(
		await git.statusMatrix({ fs, dir }),
		before,
		'generating a patch must not stage anything into the contributor\'s index (#85)'
	);
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

// --- git:save-patch -> src/patch-provenance.cjs (#166) -------------------

// A repository the patch path can actually run against, so the handler reaches
// the provenance step instead of stopping at the first git call.
async function fixtureRepo(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-handoff-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\n');
	await git.add({ fs, dir, filepath: 'text.txt' });
	const head = await git.commit({ fs, dir, message: 'init', author: { name: 'test', email: 'test@example.com' } });
	// Without it the handler falls back to fetching wordpress-develop.
	await git.writeRef({ fs, dir, ref: 'refs/remotes/origin/trunk', value: head });
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\nline2\n');
	return dir;
}

// The header is what makes a handed-off patch worth handing off: without it the
// file says nothing about who wrote it, and the props go to whoever pushes it.
// The values come from the store rather than from the caller, so the renderer
// cannot put someone else's handle or another site's base on a patch.
test('git:save-patch with handoff asks patch-provenance for the header and the name', async (t) => {
	const dir = await fixtureRepo(t);
	const buildProvenanceHeader = spy(() => '# header\n\n');
	const handoffFilename = spy(() => '62281.janedoe.diff');
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({
				siteMeta: { [dir]: { tracTicket: 62281, trunkOid: 'abcdef1234567890', trunkDate: '2026-08-05T09:14:00.000Z' } },
				preferences: { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Europe 2026' }
			}).stubs,
			'./patch-provenance.cjs': { buildProvenanceHeader, handoffFilename }
		}
	});

	// The dialog is canceled by default, which is far enough: both calls happen
	// before it, and nothing is written to the contributor's disk.
	await main.invoke('git:save-patch', dir, { handoff: true });

	assert.equal(buildProvenanceHeader.calls.length, 1);
	const details = buildProvenanceHeader.calls[0][0];
	assert.equal(details.handle, 'janedoe');
	assert.equal(details.event, 'WordCamp Europe 2026');
	assert.equal(details.ticketId, 62281);
	assert.equal(details.trunkOid, 'abcdef1234567890');
	assert.equal(details.trunkDate, '2026-08-05T09:14:00.000Z');
	assert.ok(details.generatedAt, 'the header has to be able to say when this was made');

	assert.deepEqual(handoffFilename.calls, [[{ handle: 'janedoe', ticketId: 62281 }]]);
	assert.equal(main.calls.showSaveDialog.length, 1);
	assert.equal(path.basename(main.calls.showSaveDialog[0].defaultPath), '62281.janedoe.diff');
});

// A handoff header names the base the patch was diffed against, and on a ticket
// branch that is the trunk the branch was born at — not the site's current
// trunk, which "Update to latest trunk" moves forward while existing branches
// stay where they were (#108). A header pointing at a commit the patch was never
// diffed against sends the mentor applying it to the wrong tree. The date is
// read off that same commit rather than the site record, so the two halves of
// the line cannot describe different commits.
test('git:save-patch with handoff dates the header from the branch base, not the site trunk', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-branch-base-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	const author = { name: 'test', email: 'test@example.com' };

	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\n');
	await git.add({ fs, dir, filepath: 'text.txt' });
	const bornAt = await git.commit({ fs, dir, message: 'trunk as it was', author });

	// Trunk moves on after the branch exists — the case the site record gets
	// right for trunk and wrong for every branch already open.
	await git.branch({ fs, dir, ref: 'ticket/62281', object: bornAt });
	fs.writeFileSync(path.join(dir, 'upstream.txt'), 'landed later\n');
	await git.add({ fs, dir, filepath: 'upstream.txt' });
	const trunkNow = await git.commit({ fs, dir, message: 'trunk today', author });
	await git.checkout({ fs, dir, ref: 'ticket/62281', force: true });
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\nthe contributor\n');

	const buildProvenanceHeader = spy(() => '# header\n\n');
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({
				siteMeta: {
					[dir]: {
						tracTicket: 62281,
						trunkOid: trunkNow,
						trunkDate: '2026-08-08T09:00:00.000Z',
						branches: { 'ticket/62281': { tracTicket: 62281, baseOid: bornAt } }
					}
				},
				preferences: { wporgHandle: 'janedoe' }
			}).stubs,
			'./patch-provenance.cjs': { buildProvenanceHeader, handoffFilename: () => '62281.janedoe.diff' }
		}
	});

	await main.invoke('git:save-patch', dir, { handoff: true });

	const details = buildProvenanceHeader.calls[0][0];
	assert.equal(details.trunkOid, bornAt, 'the header names the base the patch was diffed against');
	assert.notEqual(details.trunkOid, trunkNow);

	const { commit } = await git.readCommit({ fs, dir, oid: bornAt });
	assert.equal(details.trunkDate, new Date(commit.committer.timestamp * 1000).toISOString());
	assert.notEqual(details.trunkDate, '2026-08-08T09:00:00.000Z', 'the site record dates a different commit');
});

// The other callers — the Trac destination and the save-before-update prompt —
// produce the file that gets attached to a ticket, which carries no header by
// convention. A handler that headed every patch would change what those two do.
test('git:save-patch without options is the bare diff under the name it always had', async (t) => {
	const dir = await fixtureRepo(t);
	const buildProvenanceHeader = spy(() => '# header\n\n');
	const handoffFilename = spy(() => 'should-not-be-used.diff');
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({ preferences: { wporgHandle: 'janedoe' } }).stubs,
			'./patch-provenance.cjs': { buildProvenanceHeader, handoffFilename }
		}
	});

	await main.invoke('git:save-patch', dir);

	assert.deepEqual(buildProvenanceHeader.calls, []);
	assert.deepEqual(handoffFilename.calls, []);
	assert.equal(path.basename(main.calls.showSaveDialog[0].defaultPath), 'wordpress.patch');
});

// The two tests above stop at the dialog, so neither sees what is written. This
// one runs the real patch-provenance module all the way to the file, because
// the header being *above* the diff is the whole of its usefulness: the same
// lines appended after it would land inside the last hunk's context and stop
// the patch applying anywhere.
test('git:save-patch with handoff writes the header above the diff, and it still parses', async (t) => {
	const dir = await fixtureRepo(t);
	const target = path.join(dir, '..', `handoff-${process.pid}.diff`);
	t.after(() => fs.rmSync(target, { force: true }));

	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({
				siteMeta: { [dir]: { tracTicket: 62281 } },
				preferences: { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Europe 2026' }
			}).stubs
		}
	});
	main.dialogResults.showSaveDialog = { canceled: false, filePath: target };

	const result = await main.invoke('git:save-patch', dir, { handoff: true });
	assert.equal(result.ok, true, result.error);

	const written = fs.readFileSync(target, 'utf8');
	assert.ok(written.startsWith('# WordPress Contributor Toolkit patch\n'), written.slice(0, 200));
	assert.ok(written.includes('# Contributor: janedoe (wordpress.org)'));
	assert.ok(written.includes('# Event: WordCamp Europe 2026'));
	assert.ok(written.indexOf('# Generated:') < written.indexOf('---'), 'the header has to precede the diff');

	// The app reads its own patches back when someone applies one, so a mentor's
	// copy of this file has to survive the round trip.
	const parsed = require('../src/patch-plan.cjs').parsePatchFiles(written);
	assert.equal(parsed.ok, true, parsed.error);
	assert.deepEqual(parsed.files.map((f) => f.path), ['text.txt']);
});

// --- provenance:* -> src/wporg-handle.cjs + src/patch-provenance.cjs (#166) ---

// The handle becomes a filename and a line in a file other people read, so it
// is validated in the main process and not only in the window.
test('provenance:set-handle validates through wporg-handle before storing anything', async () => {
	const parseHandle = spy(() => ({ ok: false, error: 'nope' }));
	const settings = fakeSettingsStore();
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './wporg-handle.cjs': { parseHandle } }
	});

	const result = await main.invoke('provenance:set-handle', 'jane doe');

	assert.deepEqual(result, { ok: false, error: 'nope' });
	assert.deepEqual(parseHandle.calls, [['jane doe']]);
	assert.equal(settings.values.preferences, undefined, 'a refused handle must not be written');
});

test('provenance:set-handle stores the canonical handle the module returned, not what was typed', async () => {
	const parseHandle = spy(() => ({ ok: true, handle: 'janedoe' }));
	const settings = fakeSettingsStore();
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './wporg-handle.cjs': { parseHandle } }
	});

	assert.deepEqual(await main.invoke('provenance:set-handle', 'https://profiles.wordpress.org/JaneDoe/'), { ok: true, handle: 'janedoe' });
	assert.equal(settings.values.preferences.wporgHandle, 'janedoe');
});

// The event goes into the same header, so it is validated in the same place —
// and by the module that owns the header's line rules.
test('provenance:set-event validates through patch-provenance before storing anything', async () => {
	const parseEventName = spy(() => ({ ok: false, error: 'one line please' }));
	const settings = fakeSettingsStore();
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './patch-provenance.cjs': { parseEventName } }
	});

	const result = await main.invoke('provenance:set-event', 'WordCamp\n# Contributor: someoneelse');

	assert.deepEqual(result, { ok: false, error: 'one line please' });
	assert.deepEqual(parseEventName.calls, [['WordCamp\n# Contributor: someoneelse']]);
	assert.equal(settings.values.preferences, undefined, 'a refused event must not be written');
});

// Same shape as `sites:set-ticket`: clearing needs no second channel, and it
// must not be routed through the parser, which refuses an empty string. The
// event is the field this matters most for — a WordCamp ends.
test('provenance:set-handle and set-event forget the field on an empty ref', async () => {
	const parseHandle = spy(() => ({ ok: false, error: 'nope' }));
	const parseEventName = spy(() => ({ ok: false, error: 'nope' }));
	const settings = fakeSettingsStore({ preferences: { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Europe 2026' } });
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./wporg-handle.cjs': { parseHandle },
			'./patch-provenance.cjs': { parseEventName }
		}
	});

	assert.deepEqual(await main.invoke('provenance:set-handle', '   '), { ok: true, handle: null });
	assert.deepEqual(await main.invoke('provenance:set-event', ''), { ok: true, event: null });
	assert.equal(settings.values.preferences.wporgHandle, null);
	assert.equal(settings.values.preferences.contributionEvent, null);
	assert.deepEqual(parseHandle.calls, []);
	assert.deepEqual(parseEventName.calls, []);
});

// One read for both, because the window asks once on load.
test('provenance:get reads the remembered handle and event', async () => {
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({ preferences: { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Europe 2026' } }).stubs
		}
	});

	assert.deepEqual(await main.invoke('provenance:get'), {
		ok: true,
		handle: 'janedoe',
		event: 'WordCamp Europe 2026'
	});
});

// --- main must not take the windowsHide patch (#181) ---------------------
//
// The inverse of test/runner-wiring.test.cjs, which pins that the four runners
// DO call hideChildWindows(). Main must not: that patch forces `windowsHide` on
// every child_process entry point of the process, overriding even an explicit
// `false`, and main.js is what spawns the contributor's editor — a GUI
// application, which the flag starts with no window while the spawn still
// reports success.
//
// Until now that was a convention nobody had written down. "Hide the console
// flashes everywhere, do it once at startup" is the plausible-looking change
// that reinstates the bug, and nothing else here would fail:
// test/editor-launch.test.cjs injects its own spawn, so it never sees the real
// module at all.
//
// Asserted as a call that does not happen rather than by reading the flag off
// the real child_process, because patchChildProcess is a no-op off Windows —
// that version would be green on macOS whatever main.js did.
//
// Scoped to module evaluation, which is where "once at startup" lands. A call
// made lazily inside a handler would slip past this; it is also a much less
// likely shape, and the module header says what the rule is.
test('main.js does not apply the windowsHide patch when it loads', () => {
	const calls = [];
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'./hide-child-windows': {
				hideChildWindows: () => { calls.push('hideChildWindows'); },
				patchChildProcess: (cp) => { calls.push('patchChildProcess'); return cp; }
			}
		}
	});

	assert.ok(main.channels().length > 0, 'main.js registered no handlers, so it did not really load');
	assert.deepEqual(
		calls,
		[],
		'main.js patched its own child_process with windowsHide — every spawn in the process now carries the flag, including the editor launch (#181)'
	);
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
//
// Waited on the clock rather than on a count of event-loop turns, and the only
// way anything in this file should wait for a streamed message — a new inline
// tick loop is the bug below waiting to happen again. These
// handlers read the worktree to decide where per-branch state lives (#108), so
// how many turns a result takes is a property of the filesystem underneath —
// a fixed tick budget passed on macOS and ran out on Windows, where the same
// failing path lookup is slower. This returns as soon as the message lands, so
// the budget costs nothing in the normal case; do not tighten it back into a
// tick count.
async function waitForSend(event, channel, match = () => true, budgetMs = 4000) {
	const started = Date.now();
	while (Date.now() - started < budgetMs) {
		const hit = event.sent.find((m) => m.channel === channel && match(m));
		if (hit) return hit.payload;
		await new Promise((r) => setTimeout(r, 5));
	}
	throw new Error(`${channel} never arrived`);
}

async function waitForDone(event, channel, key, id) {
	return waitForSend(event, channel, (m) => m.payload[key] === id);
}

async function applyDone(event, applyId) {
	return waitForDone(event, 'git:apply-patch:done', 'applyId', applyId);
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

// The patch is gone from the tree but its record survived (#183/#184). Keeping
// the record would be a dead end: the revert can never succeed, and the
// one-patch-at-a-time guard would refuse every other patch on its behalf.
test('git:apply-patch clears the record when the revert finds no patch to undo', async () => {
	const applyPatchToDir = spy(async () => ({ ok: false, notApplied: true, error: 'That patch is not in this checkout any more.', applied: [], skipped: [] }));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'L', text: 'STORED' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './patch-apply': { applyPatchToDir } } });

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { reverse: true });
	const done = await applyDone(event, applyId);

	assert.equal(done.ok, false);
	assert.equal(done.notApplied, true, 'the renderer needs this to tell a resolution from a failure');
	assert.equal(done.recordCleared, true, 'claimed only when the store write actually landed');
	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch, null);
});

// The mirror of the above: a real failure must leave the record alone, or the
// patch stays in the tree with nothing offering to undo it.
test('git:apply-patch keeps the record when a revert fails for any other reason', async () => {
	const applyPatchToDir = spy(async () => ({ ok: false, error: 'src/a.php has moved on since the patch was written', applied: [], skipped: [] }));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { appliedPatch: { label: 'L', text: 'STORED' } } }
	});
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './patch-apply': { applyPatchToDir } } });

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { reverse: true });
	await applyDone(event, applyId);

	assert.equal(settings.values.siteMeta['/sites/wp'].appliedPatch.text, 'STORED');
});

// A store whose siteMeta write throws: the patch lands on disk but its revert
// record cannot be saved. Persistence is part of the transaction.
function storeThatFailsToPersist() {
	return {
		get: (key) => (key === 'sites' ? ['/sites/wp'] : {}),
		set: (key) => { if (key === 'siteMeta') throw new Error('disk full'); }
	};
}

test('git:apply-patch undoes the apply when its revert record cannot be saved', async () => {
	const applyPatchToDir = spy(async ({ reverse }) => ({ ok: true, applied: reverse ? [] : ['src/a.php'], skipped: [] }));
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'./settings-store': { getStore: async () => storeThatFailsToPersist() },
			'./patch-apply': { applyPatchToDir }
		}
	});

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { patchText: 'PATCH', label: 'L' });
	const done = await applyDone(event, applyId);

	assert.equal(done.ok, false);
	assert.match(done.error, /could not be saved/);
	// The forward apply, then the undo — the tree is put back to match what the
	// renderer is told rather than left with an unrevertable patch.
	assert.deepEqual(applyPatchToDir.calls.map((c) => c[0].reverse), [false, true]);
});

test('git:apply-patch reports applied-but-untracked when the undo also fails', async () => {
	const applyPatchToDir = spy(async ({ reverse }) =>
		reverse ? { ok: false, error: 'cannot undo' } : { ok: true, applied: ['src/a.php'], skipped: [] });
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'./settings-store': { getStore: async () => storeThatFailsToPersist() },
			'./patch-apply': { applyPatchToDir }
		}
	});

	const event = createIpcEvent();
	const { applyId } = await main.invokeWith('git:apply-patch', event, '/sites/wp', { patchText: 'PATCH', label: 'L' });
	const done = await applyDone(event, applyId);

	assert.equal(done.ok, false);
	assert.equal(done.appliedButUntracked, true);
	assert.deepEqual(done.files, ['src/a.php']);
	assert.match(done.error, /could not be undone/);
});

// --- linked-PR discovery (#109 / #11) ------------------------------------

test('git:fetch-pr-diff asks github-prs for the diff', async () => {
	const fetchPrDiff = spy(async () => ({ ok: true, text: 'DIFF' }));
	const main = loadMain({ stubs: { ...silentLogging(), './github-prs': { fetchPrDiff, fetchLinkedPrs: async () => ({}) } } });

	const result = await main.invoke('git:fetch-pr-diff', 7319);

	assert.deepEqual(fetchPrDiff.calls, [[7319]]);
	assert.deepEqual(result, { ok: true, text: 'DIFF' });
});

// git:list-ticket-patches reads the stored ticket, then delegates to github-prs
// and caches the result — reachable through the same fakeSettingsStore seam.
test('git:list-ticket-patches fetches the linked PRs for the stored ticket', async () => {
	const fetchLinkedPrs = spy(async () => ({ status: 'ok', items: [{ number: 7, title: 'x' }] }));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': { tracTicket: 62281 } } });
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './github-prs': { fetchLinkedPrs } } });

	const result = await main.invoke('git:list-ticket-patches', '/sites/wp');

	assert.deepEqual(fetchLinkedPrs.calls, [[62281]]);
	assert.equal(result.ok, true);
	assert.equal(result.ticket, 62281);
	assert.equal(result.prs.status, 'ok');
	assert.deepEqual(result.prs.items, [{ number: 7, title: 'x' }]);
});

test('git:list-ticket-patches falls back to the cached list when GitHub cannot be read', async () => {
	let call = 0;
	const fetchLinkedPrs = spy(async () => (++call === 1
		? { status: 'ok', items: [{ number: 7 }] }
		: { status: 'rate-limited', items: [], error: 'limit' }));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': { tracTicket: 62281 } } });
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './github-prs': { fetchLinkedPrs } } });

	await main.invoke('git:list-ticket-patches', '/sites/wp'); // populates the cache
	const result = await main.invoke('git:list-ticket-patches', '/sites/wp');

	assert.equal(result.prs.status, 'rate-limited');
	assert.deepEqual(result.prs.items, [{ number: 7 }], 'the last-known-good list is shown, not empty');
	assert.ok(result.prs.cachedAt, 'stamped with when it was last seen');
});

test('git:list-ticket-patches returns no-ticket without calling github-prs when none is linked', async () => {
	const fetchLinkedPrs = spy(async () => ({ status: 'ok', items: [] }));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': {} } });
	const main = loadMain({ stubs: { ...silentLogging(), ...settings.stubs, './github-prs': { fetchLinkedPrs } } });

	const result = await main.invoke('git:list-ticket-patches', '/sites/wp');

	assert.equal(result.prs.status, 'no-ticket');
	assert.deepEqual(fetchLinkedPrs.calls, []);
});

// The update has to run from trunk, so it parks the ticket first — and then has
// to put the contributor back. Stranding them on trunk while the panel still
// names the ticket means every patch comes out empty and the only way back to
// the work is to unlink and re-link.
test('git:update-trunk parks the ticket, updates, and returns to it (issue #108)', async () => {
	const switchToBranch = spy(async () => ({ switched: true, parked: true }));
	const currentBranchName = spy(async () => 'ticket/59234');
	const updateToLatestTrunk = spy(async () => ({
		upToDate: false, oldOid: 'old', newOid: 'new', lockfileChanged: false, trunkDate: '2026-01-01T00:00:00.000Z'
	}));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: {
			'/sites/wp': {
				tracTicket: 59234,
				currentBranch: 'ticket/59234',
				branches: { 'ticket/59234': { tracTicket: 59234, baseOid: 'abc' } }
			}
		}
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./trunk-update': { updateToLatestTrunk },
			'./ticket-branches': { switchToBranch, currentBranchName }
		}
	});

	const event = createIpcEvent();
	await main.invokeWith('git:update-trunk', event, '/sites/wp');
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(switchToBranch.calls.length, 2, 'parked onto trunk, then returned');
	assert.equal(switchToBranch.calls[0][1], 'trunk');
	assert.equal(switchToBranch.calls[0][2].baseOid, 'abc', 'parked onto its own branch point');
	assert.equal(switchToBranch.calls[1][1], 'ticket/59234', 'the contributor ends up back on their ticket');

	const meta = settings.values.siteMeta['/sites/wp'];
	assert.equal(meta.currentBranch, 'ticket/59234');
	assert.equal(meta.tracTicket, 59234, 'the panel and the worktree must agree on the ticket');
	assert.equal(meta.trunkOid, 'new');
	// The incomplete flag describes the ticket's tree, not the site's.
	assert.equal(meta.branches['ticket/59234'].updateIncomplete, true);
	assert.equal(meta.updateIncomplete, undefined, 'it must not be written at site level any more');
});

test('git:update-trunk says where the work went when the update fails (issue #108)', async () => {
	// On a ticket to begin with; on trunk once the handler has parked it. That
	// ordering is the whole point — the failure happens after the move.
	let onTrunk = false;
	const switchToBranch = spy(async () => { onTrunk = true; return { switched: true, parked: true }; });
	const currentBranchName = spy(async () => (onTrunk ? 'trunk' : 'ticket/59234'));
	const updateToLatestTrunk = spy(async () => { throw new Error('network is down'); });
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: {
			'/sites/wp': {
				tracTicket: 59234,
				currentBranch: 'ticket/59234',
				branches: { 'ticket/59234': { tracTicket: 59234, baseOid: 'abc' } }
			}
		}
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./trunk-update': { updateToLatestTrunk },
			'./ticket-branches': { switchToBranch, currentBranchName }
		}
	});

	const event = createIpcEvent();
	await main.invokeWith('git:update-trunk', event, '/sites/wp');
	await new Promise((resolve) => setImmediate(resolve));

	// Left on trunk: the registry must stop naming a ticket the worktree is not
	// on, or the panel says #59234 while every patch it produces is empty.
	assert.equal(settings.values.siteMeta['/sites/wp'].tracTicket, null);
	assert.ok(
		event.sent.some((m) => m.channel === 'git:update-trunk:log' && /is safe/.test(m.payload.data)),
		'the contributor is told their work is parked on the branch, not lost'
	);
});

// --- Ticket branches (#108) ----------------------------------------------
// The handlers own the registry half; every git operation belongs to
// src/ticket-branches.js, so these assert the delegation and the store writes
// that have to accompany it.

test('branches:list reports the branches on disk with their stored context', async () => {
	const listTicketBranches = spy(async () => ['ticket/59234', 'ticket/61002']);
	const currentBranchName = spy(async () => 'ticket/59234');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: {
			'/sites/wp': {
				branches: { 'ticket/59234': { baseOid: 'abc', lastUsedAt: 'yesterday' } },
				currentBranch: 'ticket/59234'
			}
		}
	});
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './ticket-branches': { listTicketBranches, currentBranchName } }
	});

	const result = await main.invoke('branches:list', '/sites/wp');

	assert.equal(result.ok, true);
	assert.equal(result.current, 'ticket/59234');
	assert.deepEqual(result.branches.map((b) => b.ticketId), [59234, 61002]);
	assert.equal(result.branches[0].baseOid, 'abc');
	assert.equal(result.branches[1].baseOid, null, 'a branch the registry has never seen still lists');
});

test('branches:switch delegates to ticket-branches and records the new active branch', async () => {
	const switchToBranch = spy(async () => ({ switched: true, from: 'ticket/59234', to: 'ticket/61002', parked: true }));
	const currentBranchName = spy(async () => 'ticket/59234');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { branches: { 'ticket/59234': { baseOid: 'abc' } }, currentBranch: 'ticket/59234' } }
	});
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './ticket-branches': { switchToBranch, currentBranchName } }
	});

	const result = await main.invoke('branches:switch', '/sites/wp', 'ticket/61002');

	assert.equal(switchToBranch.calls[0][1], 'ticket/61002');
	assert.equal(switchToBranch.calls[0][2].baseOid, 'abc', 'the branch being left is parked onto its own branch point');
	assert.equal(result.parked, true);
	// The ticket the rest of the app reads has to follow the branch, or the PR
	// list and the attachment panel would still be showing the old ticket's.
	assert.equal(settings.values.siteMeta['/sites/wp'].currentBranch, 'ticket/61002');
	assert.equal(settings.values.siteMeta['/sites/wp'].tracTicket, 61002);
});

test('branches:delete goes through ticket-branches and forgets the branch context', async () => {
	const deleteTicketBranch = spy(async () => ({ deleted: true, ref: 'ticket/61002' }));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: {
			'/sites/wp': {
				branches: { 'ticket/59234': { baseOid: 'abc' }, 'ticket/61002': { baseOid: 'def' } },
				currentBranch: 'ticket/61002'
			}
		}
	});
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './ticket-branches': { deleteTicketBranch } }
	});

	const result = await main.invoke('branches:delete', '/sites/wp', 'ticket/61002');

	assert.deepEqual(deleteTicketBranch.calls, [['/sites/wp', 'ticket/61002']]);
	assert.equal(result.ok, true);
	const meta = settings.values.siteMeta['/sites/wp'];
	assert.equal(meta.branches['ticket/61002'], undefined, 'a deleted branch must not linger in the switcher');
	assert.ok(meta.branches['ticket/59234'], 'the other ticket is untouched');
	assert.equal(meta.currentBranch, 'trunk');
});

test('branches:delete leaves the active ticket alone when deleting another one (issue #108)', async () => {
	const deleteTicketBranch = spy(async () => ({ deleted: true, ref: 'ticket/61002' }));
	const currentBranchName = spy(async () => 'ticket/59234');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: {
			'/sites/wp': {
				tracTicket: 59234,
				currentBranch: 'ticket/59234',
				branches: { 'ticket/59234': { baseOid: 'abc' }, 'ticket/61002': { baseOid: 'def' } }
			}
		}
	});
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './ticket-branches': { deleteTicketBranch, currentBranchName } }
	});

	// deleteTicketBranch only checks out trunk when the target IS current, so
	// resetting these unconditionally would unlink the ticket being worked on.
	await main.invoke('branches:delete', '/sites/wp', 'ticket/61002');

	const meta = settings.values.siteMeta['/sites/wp'];
	assert.equal(meta.currentBranch, 'ticket/59234', 'still on the ticket that was being worked on');
	assert.equal(meta.tracTicket, 59234);
	assert.equal(meta.branches['ticket/61002'], undefined);
});

test('the applied patch belongs to the ticket, not the site (issue #108)', async () => {
	const currentBranchName = spy(async () => 'ticket/61002');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: {
			'/sites/wp': {
				currentBranch: 'ticket/61002',
				// The site-level value: what a pre-#108 install left behind, and
				// what the migration copies onto the ticket it belonged to. It
				// must never be what the panel reads once a ticket is active.
				appliedPatch: { label: 'A.diff', text: 'x', files: ['f'] },
				branches: {
					'ticket/59234': { baseOid: 'abc', appliedPatch: { label: 'A.diff', text: 'x', files: ['f'] } },
					'ticket/61002': { baseOid: 'def', appliedPatch: null }
				}
			}
		}
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./trunk-update': { readTrunkInfo: async () => ({ trunkOid: 'o', trunkDate: 'd' }) },
			'./ticket-branches': { currentBranchName }
		}
	});

	const status = await main.invoke('site:status', '/sites/wp');

	// Reading it from the site would show ticket A's patch while on ticket B —
	// and offer a Revert that reverses A's hunks against B's tree.
	assert.equal(status.appliedPatch, null, 'the other ticket\'s applied patch must not leak here');
});

test('a checkout that died mid-switch blocks further switching (issue #108)', async () => {
	const switchToBranch = spy(async () => ({ switched: true }));
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { branches: {}, switchInProgress: { from: 'ticket/59234', to: 'ticket/61002' } } }
	});
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './ticket-branches': { switchToBranch } }
	});

	const result = await main.invoke('branches:switch', '/sites/wp', 'ticket/1');

	// Parking over a half-swapped worktree would commit the mixture on top of
	// the good WIP commit — and parking rewrites, so the real work would go.
	assert.equal(result.ok, false);
	assert.equal(result.code, 'switch-incomplete');
	assert.deepEqual(switchToBranch.calls, [], 'nothing is parked until the site is reconciled');
});

test('a site that cannot be migrated is retried, not stranded on the old shape (issue #108)', async () => {
	const startTicketBranch = spy(async () => { throw new Error('not a repository'); });
	const listTicketBranches = spy(async () => { throw new Error('not a repository'); });
	const currentBranchName = spy(async () => { throw new Error('not a repository'); });
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { tracTicket: 59234 } }
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./ticket-branches': { startTicketBranch, listTicketBranches, currentBranchName }
		}
	});

	await main.invoke('branches:switch', '/sites/wp', 'ticket/59234').catch(() => {});

	// Persisting `branches: {}` here would trip the "already migrated" guard and
	// the site would never get its branch, even once the volume is back.
	assert.equal(settings.values.siteMeta['/sites/wp'].branches, undefined);
	assert.equal(settings.values.siteMeta['/sites/wp'].tracTicket, 59234, 'the old shape is left intact');
});

test('branches:list never migrates — it must not create branches behind a read (issue #108)', async () => {
	const startTicketBranch = spy(async () => ({ ref: 'ticket/59234', baseOid: 'abc' }));
	const listTicketBranches = spy(async () => []);
	const currentBranchName = spy(async () => 'trunk');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { tracTicket: 59234 } }
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./ticket-branches': { startTicketBranch, listTicketBranches, currentBranchName }
		}
	});

	await main.invoke('branches:list', '/sites/wp');

	// A read can land while an install, a build or the Playground server is
	// running against that directory; creating a ref and moving HEAD there is
	// not something a list call gets to do.
	assert.deepEqual(startTicketBranch.calls, []);
});

test('the branch handlers refuse a path the app has no record of', async () => {
	const switchToBranch = spy(async () => ({}));
	const deleteTicketBranch = spy(async () => ({}));
	const settings = fakeSettingsStore({ sites: ['/sites/wp'] });
	const main = loadMain({
		stubs: { ...silentLogging(), ...settings.stubs, './ticket-branches': { switchToBranch, deleteTicketBranch } }
	});

	const switched = await main.invoke('branches:switch', '/somewhere/else', 'ticket/1');
	const deleted = await main.invoke('branches:delete', '/somewhere/else', 'ticket/1');

	assert.equal(switched.ok, false);
	assert.equal(deleted.ok, false);
	assert.deepEqual(switchToBranch.calls, [], 'no checkout on an unregistered path');
	assert.deepEqual(deleteTicketBranch.calls, [], 'no branch deletion on an unregistered path');
});

test('sites:set-ticket starts a branch for a ticket the site has not seen', async () => {
	const startTicketBranch = spy(async () => ({ ref: 'ticket/62281', baseOid: 'abc', ticketId: 62281 }));
	const listTicketBranches = spy(async () => []);
	const currentBranchName = spy(async () => 'trunk');
	const settings = fakeSettingsStore({ sites: ['/sites/wp'], siteMeta: { '/sites/wp': {} } });
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./ticket-branches': { startTicketBranch, listTicketBranches, currentBranchName }
		}
	});

	const result = await main.invoke('sites:set-ticket', '/sites/wp', '62281');

	assert.deepEqual(startTicketBranch.calls, [['/sites/wp', 62281]]);
	assert.equal(result.branch, 'ticket/62281');
	const meta = settings.values.siteMeta['/sites/wp'];
	assert.equal(meta.tracTicket, 62281);
	assert.equal(meta.branches['ticket/62281'].baseOid, 'abc', 'the branch point is recorded — it is the diff base');
});

test('sites:set-ticket switches back to a ticket the site already has, without re-branching', async () => {
	const startTicketBranch = spy(async () => ({}));
	const switchToBranch = spy(async () => ({ switched: true, parked: true }));
	const listTicketBranches = spy(async () => ['ticket/62281']);
	const currentBranchName = spy(async () => 'trunk');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { branches: { 'ticket/62281': { baseOid: 'abc' } }, currentBranch: 'trunk' } }
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./ticket-branches': { startTicketBranch, switchToBranch, listTicketBranches, currentBranchName }
		}
	});

	const result = await main.invoke('sites:set-ticket', '/sites/wp', '#62281');

	assert.deepEqual(startTicketBranch.calls, [], 'an existing ticket is resumed, never recreated');
	assert.equal(switchToBranch.calls[0][1], 'ticket/62281');
	assert.equal(result.ticket, 62281);
});

test('unlinking a ticket returns to trunk but keeps the branch and its work', async () => {
	const switchToBranch = spy(async () => ({ switched: true, parked: true }));
	const deleteTicketBranch = spy(async () => ({}));
	const currentBranchName = spy(async () => 'ticket/62281');
	const settings = fakeSettingsStore({
		sites: ['/sites/wp'],
		siteMeta: { '/sites/wp': { branches: { 'ticket/62281': { baseOid: 'abc' } }, currentBranch: 'ticket/62281' } }
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./ticket-branches': { switchToBranch, deleteTicketBranch, currentBranchName }
		}
	});

	const result = await main.invoke('sites:set-ticket', '/sites/wp', '');

	assert.equal(result.ticket, null);
	assert.equal(switchToBranch.calls[0][1], 'trunk');
	assert.deepEqual(deleteTicketBranch.calls, [], 'unlinking is not deleting — the work stays on its branch');
	assert.ok(settings.values.siteMeta['/sites/wp'].branches['ticket/62281'], 'the branch context survives');
});

// --- Trac attachments (#109 / #11) ---------------------------------------

test('trac:fetch-attachment goes through trac-view', async () => {
	const fetchAttachment = spy(async () => ({ ok: true, text: 'DIFF' }));
	const main = loadMain({ stubs: { ...silentLogging(), './trac-view': { fetchAttachment, openAndScrape: async () => ({}) } } });
	const url = 'https://core.trac.wordpress.org/raw-attachment/ticket/1/a.diff';

	const result = await main.invoke('trac:fetch-attachment', url);

	assert.deepEqual(fetchAttachment.calls, [[url]]);
	assert.deepEqual(result, { ok: true, text: 'DIFF' });
});

// --- editor:open / dir:show -> src/editor-launch.js, src/site-registry.js -

const SITE = '/Users/dev/sites/wp';
const EDITOR = '/Applications/Cursor.app';

// `editor:open` now asks editor-launch which detected application a path is; a
// stub that answers with one stands in for a machine that has it installed.
const matching = (candidate) => spy((wanted) => (wanted === candidate.path ? candidate : null));

test('editor:open asks editor-launch to open the site, with the registry as its boundary', async () => {
	const openSiteInEditor = spy(async () => ({ ok: true }));
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({ sites: [SITE] }).stubs,
			'./editor-launch': { openSiteInEditor, matchDetectedEditor: matching({ id: 'cursor', name: 'Cursor', path: EDITOR }) }
		}
	});

	assert.deepEqual(await main.invoke('editor:open', SITE, EDITOR), { ok: true });

	assert.equal(openSiteInEditor.calls.length, 1);
	const [sitePath, editorPath, options] = openSiteInEditor.calls[0];
	assert.equal(sitePath, SITE);
	assert.equal(editorPath, EDITOR);
	// Without these the module cannot decide anything: the registry is the
	// boundary, `statPath` is how it checks the application is still there, and
	// `spawn` is the effect it is being asked to guard.
	assert.deepEqual(options.sites, [SITE]);
	// The registry is not the whole boundary: a site still being cloned is not
	// in it yet, and opening that folder is the point of #180.
	assert.ok(Array.isArray(options.pending), 'the in-flight setups must reach the guard');
	assert.equal(typeof options.statPath, 'function');
	assert.equal(typeof options.spawn, 'function');
	assert.equal(options.platform, process.platform);
});

// The renderer names the application now, where it used to come out of the store
// — so "which applications may this app be asked to launch?" is answered here,
// and this is the test that says so. A path detection did not return is refused
// before the module that would spawn it is even reached.
test('editor:open refuses an application detection did not find', async () => {
	const openSiteInEditor = spy(async () => ({ ok: true }));
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({ sites: [SITE] }).stubs,
			'./editor-launch': { openSiteInEditor, matchDetectedEditor: matching({ id: 'cursor', name: 'Cursor', path: EDITOR }), REFUSAL_REASONS: { UNKNOWN_EDITOR: 'unknown-editor' } }
		}
	});

	const result = await main.invoke('editor:open', SITE, '/Applications/Something Else.app');

	assert.equal(result.ok, false);
	assert.equal(result.reason, 'unknown-editor');
	assert.deepEqual(openSiteInEditor.calls, []);
});

// The end of the wire, with the real module in place. This is the assertion that
// fails if the handler ever spawns an editor itself. Detection is the one thing
// stubbed, because the alternative is a test whose answer depends on which
// editors the machine running it happens to have installed.
test('editor:open does not spawn for a path the registry does not hold', async () => {
	const cp = { spawn: spy(() => { throw new Error('a refused open must not reach spawn'); }) };
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...fakeSettingsStore({ sites: [SITE] }).stubs,
			'./editor-launch': {
				...require(path.join(SRC_DIR, 'editor-launch.js')),
				matchDetectedEditor: matching({ id: 'cursor', name: 'Cursor', path: EDITOR })
			},
			child_process: cp
		}
	});

	const result = await main.invoke('editor:open', '/Users/dev/somewhere-else', EDITOR);

	assert.equal(result.ok, false);
	assert.equal(result.reason, 'unregistered-site');
	assert.deepEqual(cp.spawn.calls, []);
});

// No path is not a failure: it is "the one you are looking for is not in that
// list", which is the file dialog. Nothing is opened when it is dismissed.
test('editor:open with no application named goes to the file dialog', async () => {
	const openSiteInEditor = spy(async () => ({ ok: true }));
	const matchDetectedEditor = matching({ id: 'cursor', name: 'Cursor', path: EDITOR });
	const main = loadMain({
		stubs: { ...silentLogging(), ...fakeSettingsStore({ sites: [SITE] }).stubs, './editor-launch': { openSiteInEditor, matchDetectedEditor } }
	});

	assert.deepEqual(await main.invoke('editor:open', SITE, null), { ok: false, reason: 'cancelled' });
	assert.equal(main.calls.showOpenDialog.length, 1);
	assert.deepEqual(openSiteInEditor.calls, []);
	// The dialog's answer is the contributor's own; checking it against the
	// detection table would refuse exactly the editors that table misses.
	assert.deepEqual(matchDetectedEditor.calls, []);

	main.dialogResults.showOpenDialog = { canceled: false, filePaths: ['/Applications/Something Else.app'] };
	assert.deepEqual(await main.invoke('editor:open', SITE, null), { ok: true });
	assert.equal(openSiteInEditor.calls.length, 1);
	assert.equal(openSiteInEditor.calls[0][1], '/Applications/Something Else.app');
});

test('editor:list asks editor-launch what is installed, without a shell', async () => {
	const detectEditors = spy(() => [{ id: 'vscode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' }]);
	const main = loadMain({
		stubs: { ...silentLogging(), ...fakeSettingsStore().stubs, './editor-launch': { detectEditors } }
	});

	const result = await main.invoke('editor:list');

	assert.deepEqual(result.detected, [{ id: 'vscode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' }]);
	assert.equal(detectEditors.calls.length, 1);
	// `exists` is the whole of detection — a handler that passed something else,
	// or ran `which` beside this call, is what #24 was.
	assert.equal(typeof detectEditors.calls[0][0].exists, 'function');
	assert.equal(detectEditors.calls[0][0].platform, process.platform);
});

test('dir:show asks site-registry whether the path may be revealed', async () => {
	const revealRegisteredSite = spy(async () => ({ ok: true }));
	const main = loadMain({
		stubs: { ...silentLogging(), ...fakeSettingsStore({ sites: [SITE] }).stubs, './site-registry': { revealRegisteredSite } }
	});

	await main.invoke('dir:show', SITE);

	assert.equal(revealRegisteredSite.calls.length, 1);
	const [sitePath, options] = revealRegisteredSite.calls[0];
	assert.equal(sitePath, SITE);
	assert.deepEqual(options.sites, [SITE]);
	assert.ok(Array.isArray(options.pending), 'the in-flight setups must reach the guard');
	assert.equal(typeof options.reveal, 'function');
	assert.equal(typeof options.onRefused, 'function');
});

test('dir:show refuses a path the registry does not hold, and logs it', async () => {
	const logEvent = spy();
	const main = loadMain({
		stubs: { './logging': { ...silentLogging()['./logging'], logEvent }, ...fakeSettingsStore({ sites: [SITE] }).stubs }
	});

	const result = await main.invoke('dir:show', '/Users/dev/somewhere-else');

	assert.equal(result.ok, false);
	assert.deepEqual(main.calls.openPath, []);
	assert.equal(logEvent.calls.length, 1);
	assert.match(logEvent.calls[0][1], /refused to reveal \/Users\/dev\/somewhere-else/);

	assert.deepEqual(await main.invoke('dir:show', SITE), { ok: true });
	assert.deepEqual(main.calls.openPath, [SITE]);
});

// --- creating a site, and opening it while it is still being created -----
//
// This handler was listed as NOT_REACHABLE, on the grounds that it clones
// wordpress-develop over the network. It does not have to: `resolveStubs`
// resolves bare packages through `require.resolve`, so `isomorphic-git` is
// stubbable like any other module and the whole handler runs offline. That
// matters here beyond coverage — #180 is a bug about *when* things are true
// during the clone, and only a test that can be inside the clone can see it.

// Runs `wordpress:setup` with a stubbed clone, and calls `duringClone` at the
// moment the real clone would be running: the directory exists, nothing is in
// the store yet. `clone` can be made to fail instead.
async function runSetup({ duringClone, cloneFails = false, existing = [], extraStubs = {} } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-setup-'));
	for (const name of existing) fs.mkdirSync(path.join(root, name));

	const settings = fakeSettingsStore();
	const seen = [];
	let inside;

	const clone = async ({ dir }) => {
		if (duringClone) inside = await duringClone({ dir, root, main, settings });
		if (cloneFails) throw new Error('clone failed');
	};

	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'isomorphic-git': { clone },
			'./trunk-update': { ensureAutocrlf: async () => {}, readTrunkInfo: async () => ({ trunkOid: 'abc', trunkDate: '2026-01-01' }) },
			...extraStubs
		}
	});

	const event = createIpcEvent();
	const settled = await main.invokeWith('wordpress:setup', event, root, { siteName: 'demo', siteLabel: 'Demo' })
		.then((siteDir) => ({ siteDir }), (error) => ({ error }));

	for (const { channel, payload } of event.sent) if (channel === 'download:status') seen.push(payload);
	return { root, main, settings, inside, statuses: seen, ...settled };
}

test('the folder can be revealed while it is still being cloned, without being registered', async () => {
	const { root, settings, inside, siteDir } = await runSetup({
		duringClone: async ({ dir, main: m, settings: st }) => ({
			revealed: await m.invoke('dir:show', dir),
			openPathCalls: [...m.calls.openPath],
			registeredMidClone: structuredClone(st.values.sites)
		})
	});

	// The bug, stated: this was `{ ok: false, reason: 'unregistered-site' }`.
	assert.deepEqual(inside.revealed, { ok: true });
	assert.deepEqual(inside.openPathCalls, [path.join(root, 'demo')]);
	// And the reason it could not simply be registered early: nothing
	// half-finished may reach the store, where it would outlive the process.
	assert.deepEqual(inside.registeredMidClone, [], 'no phantom site while the clone runs');

	assert.equal(siteDir, path.join(root, 'demo'));
	assert.deepEqual(settings.values.sites, [siteDir], 'and it is registered once the clone finishes');
});

test('deleting a site is refused while its clone is running, and the directory survives', async () => {
	const { root, inside } = await runSetup({
		duringClone: async ({ dir, main: m }) => ({
			deleted: await m.invoke('sites:delete', dir),
			stillThere: fs.existsSync(dir)
		})
	});

	assert.equal(inside.deleted, false);
	assert.equal(inside.stillThere, true);
	assert.equal(fs.existsSync(path.join(root, 'demo')), true, 'the finished clone is still on disk');
});

test('a clone that fails leaves nothing registered and nothing in flight', async () => {
	const { root, main, settings, error } = await runSetup({ cloneFails: true });

	assert.match(String(error), /clone failed/);
	assert.deepEqual(settings.values.sites, []);
	assert.deepEqual(settings.values.siteMeta, {});
	// The entry is released however the setup ends, so the path is refused again
	// rather than staying openable — and, more importantly, staying undeletable.
	assert.equal((await main.invoke('dir:show', path.join(root, 'demo'))).ok, false);
});

test('a name already taken on disk is the one that opens, from the first moment', async () => {
	const { root, inside, siteDir } = await runSetup({
		existing: ['demo'],
		duringClone: async ({ dir, root: destDir, main: m }) => ({
			dir,
			collided: await m.invoke('dir:show', path.join(destDir, 'demo')),
			real: await m.invoke('dir:show', dir)
		})
	});

	assert.equal(siteDir, path.join(root, 'demo-2'));
	assert.equal(inside.dir, path.join(root, 'demo-2'));
	assert.deepEqual(inside.real, { ok: true });
	// The directory that merely shares the name is not the site being created,
	// and is not opened on its behalf.
	assert.equal(inside.collided.ok, false);
});

// The other half of #180, and the half the unit tests cannot see: they hand
// `pending` to the guard themselves, so they stay green if main stops sending
// it. This asserts the list main actually builds, at the one moment it matters.
test('the folder can be opened in an editor while it is still being cloned', async () => {
	const openSiteInEditor = spy(async () => ({ ok: true }));
	const { inside, siteDir } = await runSetup({
		extraStubs: {
			'./editor-launch': {
				openSiteInEditor,
				matchDetectedEditor: async () => ({ id: 'cursor', name: 'Cursor', path: EDITOR })
			}
		},
		duringClone: async ({ dir, main: m }) => ({
			opened: await m.invoke('editor:open', dir, EDITOR),
			handed: openSiteInEditor.calls.at(-1)[2]
		})
	});

	assert.deepEqual(inside.opened, { ok: true });
	assert.deepEqual(inside.handed.sites, [], 'the registry cannot know about it yet');
	assert.deepEqual(inside.handed.pending, [siteDir], 'so this is what lets the guard say yes');
});

test('the cloning status names the directory the guards are keyed on', async () => {
	const { statuses, siteDir } = await runSetup({ existing: ['demo'] });

	const cloning = statuses.find((p) => p.phase === 'cloning');
	// PR 3 has the window adopt this; it is only safe if it is the same string
	// the tracker holds, verbatim.
	assert.equal(cloning.target, siteDir);
});

// --- wp-debug:clear -> src/site-registry.js -------------------------------
//
// The Clear button under the debug.log panel. It empties
// build/wp-content/debug.log inside the named site, so it is behind the same
// registry boundary as sites:delete and dir:show — without it the renderer
// could name any path and have the app truncate a file under it.

test('wp-debug:clear asks site-registry whether the log may be emptied', async () => {
	const clearRegisteredSiteLog = spy(async () => ({ ok: true }));
	const main = loadMain({
		stubs: { ...silentLogging(), ...fakeSettingsStore({ sites: [SITE] }).stubs, './site-registry': { clearRegisteredSiteLog } }
	});

	await main.invoke('wp-debug:clear', SITE);

	assert.equal(clearRegisteredSiteLog.calls.length, 1);
	const [sitePath, options] = clearRegisteredSiteLog.calls[0];
	assert.equal(sitePath, SITE);
	assert.deepEqual(options.sites, [SITE]);
	assert.equal(typeof options.truncate, 'function');
	assert.equal(typeof options.onRefused, 'function');
});

test('wp-debug:clear refuses a path the registry does not hold, and logs it', async () => {
	const logEvent = spy();
	const main = loadMain({
		stubs: { './logging': { ...silentLogging()['./logging'], logEvent }, ...fakeSettingsStore({ sites: [SITE] }).stubs }
	});

	const result = await main.invoke('wp-debug:clear', '/Users/dev/somewhere-else');

	assert.equal(result.ok, false);
	assert.equal(result.reason, 'unregistered-site');
	assert.equal(logEvent.calls.length, 1);
	assert.match(logEvent.calls[0][1], /refused to clear the debug log for \/Users\/dev\/somewhere-else/);
});

test('wp-debug:reveal asks site-registry whether the log may be shown', async () => {
	const revealRegisteredSite = spy(async () => ({ ok: true }));
	const main = loadMain({
		stubs: { ...silentLogging(), ...fakeSettingsStore({ sites: [SITE] }).stubs, './site-registry': { revealRegisteredSite } }
	});

	await main.invoke('wp-debug:reveal', SITE);

	assert.equal(revealRegisteredSite.calls.length, 1);
	const [sitePath, options] = revealRegisteredSite.calls[0];
	assert.equal(sitePath, SITE);
	assert.deepEqual(options.sites, [SITE]);
	assert.equal(typeof options.reveal, 'function');
	assert.equal(typeof options.onRefused, 'function');
});

test('wp-debug:reveal refuses a path the registry does not hold, and logs it', async () => {
	const logEvent = spy();
	const main = loadMain({
		stubs: { './logging': { ...silentLogging()['./logging'], logEvent }, ...fakeSettingsStore({ sites: [SITE] }).stubs }
	});

	const result = await main.invoke('wp-debug:reveal', '/Users/dev/somewhere-else');

	assert.equal(result.ok, false);
	assert.deepEqual(main.calls.showItemInFolder, []);
	assert.equal(logEvent.calls.length, 1);
	assert.match(logEvent.calls[0][1], /refused to reveal the debug log for \/Users\/dev\/somewhere-else/);
});

// The path is what the panel displays, so a handler that started the tail but
// answered with a bare `true` would leave the line blank and Show in folder
// disabled, with nothing failing.
test('wp-debug:start answers with the log path', async () => {
	const main = loadMain({ stubs: { ...silentLogging(), ...fakeSettingsStore({ sites: [SITE] }).stubs } });

	const started = await main.invoke('wp-debug:start', SITE);

	assert.equal(started.ok, true);
	assert.equal(started.filePath, path.join(SITE, 'build', 'wp-content', 'debug.log'));
});

// --- opening a pull request (#167) ---------------------------------------

// Sign-in is two-legged: the handler returns as soon as there is a code to
// show, and the outcome of the wait arrives on an event. `settle` gives the
// background poll the turns it needs, since nothing the handler returns is tied
// to it.
const settle = () => new Promise((resolve) => setImmediate(resolve));

function fakeGithubAuth({ login = 'contributor', token = 'gho_test' } = {}) {
	return {
		getClientId: () => 'Ov23liTEST',
		requestDeviceCode: spy(async () => ({
			ok: true,
			userCode: 'WDJB-MJHT',
			verificationUri: 'https://github.com/login/device',
			deviceCode: 'dev-code',
			interval: 5,
			expiresAt: 1
		})),
		pollForToken: spy(async () => ({ ok: true, token })),
		fetchViewer: spy(async () => ({ ok: true, login }))
	};
}

test('github:sign-in asks github-auth for a code, then for the token and the account', async () => {
	const auth = fakeGithubAuth();
	const main = loadMain({ stubs: { ...silentLogging(), './github-auth.cjs': auth } });
	const event = createIpcEvent();

	const started = await main.invokeWith('github:sign-in', event);
	assert.equal(started.ok, true);
	assert.equal(started.userCode, 'WDJB-MJHT');
	assert.equal(started.verificationUri, 'https://github.com/login/device');
	// The token is what the whole design is about: it must not be on the way
	// back to the renderer, only the code the contributor types.
	assert.equal(JSON.stringify(started).includes('gho_test'), false);

	await settle();
	await settle();

	assert.equal(auth.requestDeviceCode.calls.length, 1);
	assert.equal(auth.pollForToken.calls.length, 1);
	assert.equal(auth.pollForToken.calls[0][0].deviceCode, 'dev-code');
	assert.deepEqual(auth.fetchViewer.calls, [['gho_test']]);
	assert.deepEqual(event.sent, [{ channel: 'github:sign-in:done', payload: { ok: true, login: 'contributor' } }]);
});

test('github:account reports the login the sign-in produced, and forgets it on sign-out', async () => {
	const auth = fakeGithubAuth({ login: 'janedoe' });
	const main = loadMain({ stubs: { ...silentLogging(), './github-auth.cjs': auth } });

	// testMode null is the load-bearing half: it is what keeps the test-mode
	// badge off a real contributor's screen in a shipped build.
	assert.deepEqual(await main.invoke('github:account'), { ok: true, login: null, configured: true, testMode: null });

	await main.invokeWith('github:sign-in', createIpcEvent());
	await settle();
	await settle();

	assert.equal((await main.invoke('github:account')).login, 'janedoe');
	await main.invoke('github:sign-out');
	assert.equal((await main.invoke('github:account')).login, null);
});

// The race the earlier shape had: the in-flight session became unreachable
// during fetchViewer, so Cancel in that window was a no-op and the contributor
// ended up signed in anyway. The fetchViewer here does not resolve until the
// cancel has landed.
test('github:sign-in-cancel during the account lookup wins: nothing is signed in', async () => {
	let releaseViewer;
	const auth = {
		...fakeGithubAuth(),
		fetchViewer: () => new Promise((resolve) => { releaseViewer = () => resolve({ ok: true, login: 'janedoe' }); })
	};
	const main = loadMain({ stubs: { ...silentLogging(), './github-auth.cjs': auth } });
	const event = createIpcEvent();

	await main.invokeWith('github:sign-in', event);
	// Let the poll resolve and the viewer lookup start.
	await settle();
	await settle();

	await main.invoke('github:sign-in-cancel');
	releaseViewer();
	await settle();

	assert.equal((await main.invoke('github:account')).login, null);
	// And the renderer heard nothing: a canceled sign-in has no outcome.
	assert.deepEqual(event.sent, []);
});

// The pull request and the .diff are two renderings of one walk, so they share
// a base — and on a ticket branch that base is the branch point, not HEAD.
// HEAD there is the parked WIP commit, against which the worktree matches: the
// pull request would have carried no files at all, and the commit it asked
// GitHub to build on would have been a commit GitHub has never seen.
test('github:open-pr builds on the branch point, not on the parked WIP commit (issues #108, #167)', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-wiring-pr-base-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const author = { name: 'test', email: 'test@example.com' };
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // trunk\n');
	await git.add({ fs, dir, filepath: 'wp-login.php' });
	const bornAt = await git.commit({ fs, dir, message: 'trunk', author });

	// The ticket branch, with its work already parked as a WIP commit — the
	// state a contributor is in every time they come back to a ticket.
	await git.branch({ fs, dir, ref: 'ticket/62281', object: bornAt });
	await git.checkout({ fs, dir, ref: 'ticket/62281', force: true });
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // the contribution\n');
	await git.add({ fs, dir, filepath: 'wp-login.php' });
	await git.commit({ fs, dir, message: 'wip', author, parent: [bornAt] });

	const auth = fakeGithubAuth({ login: 'janedoe' });
	const openPullRequest = spy(async () => ({ ok: true, url: 'u', number: 9, branch: 'trac-62281', exactBase: true }));
	const settings = fakeSettingsStore({
		sites: [dir],
		siteMeta: {
			[dir]: {
				tracTicket: 62281,
				currentBranch: 'ticket/62281',
				branches: { 'ticket/62281': { tracTicket: 62281, baseOid: bornAt } }
			}
		},
		preferences: { wporgHandle: 'janedoe' }
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./github-auth.cjs': auth,
			'./github-pr.cjs': { openPullRequest, buildPullRequestBody: () => 'BODY' }
		}
	});

	await main.invokeWith('github:sign-in', createIpcEvent());
	await settle();
	await settle();

	const result = await main.invoke('github:open-pr', dir, {});

	assert.equal(result.ok, true, result.error);
	const [args] = openPullRequest.calls[0];
	assert.equal(args.baseSha, bornAt, 'the parent has to be a commit upstream actually has');
	assert.deepEqual(args.files.map((f) => f.path), ['wp-login.php'], 'and the work has to be in it');
});

test('github:open-pr asks github-pr to open one, for the ticket this site is linked to', async (t) => {
	const dir = await fixtureRepo(t);
	const auth = fakeGithubAuth({ login: 'janedoe' });
	const openPullRequest = spy(async () => ({ ok: true, url: 'https://github.com/WordPress/wordpress-develop/pull/9', number: 9, branch: 'trac-62281', exactBase: true }));
	const buildPullRequestBody = spy(() => 'BODY');
	const settings = fakeSettingsStore({
		sites: [dir],
		siteMeta: { [dir]: { tracTicket: 62281 } },
		preferences: { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Europe 2026' }
	});
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./github-auth.cjs': auth,
			'./github-pr.cjs': { openPullRequest, buildPullRequestBody }
		}
	});

	await main.invokeWith('github:sign-in', createIpcEvent());
	await settle();
	await settle();

	const result = await main.invoke('github:open-pr', dir, { title: 'Fix the thing', notes: 'What it does, and how to see it.' });

	assert.equal(result.ok, true);
	assert.equal(result.number, 9);
	assert.equal(openPullRequest.calls.length, 1);
	const [args] = openPullRequest.calls[0];
	assert.equal(args.token, 'gho_test');
	assert.equal(args.login, 'janedoe');
	assert.equal(args.title, 'Fix the thing');
	assert.equal(args.body, 'BODY');
	// The ticket comes from the site's stored metadata, not from the caller: the
	// renderer must not be able to file against a different one.
	assert.equal(args.ticketId, 62281);
	// The notes are the caller's to supply — unlike the ticket, the handle and
	// the event, which are read from stored state so the renderer cannot claim
	// a different contributor or a different ticket than this site's.
	assert.deepEqual(buildPullRequestBody.calls, [[{ ticketId: 62281, handle: 'janedoe', event: 'WordCamp Europe 2026', notes: 'What it does, and how to see it.' }]]);
	// The changed file the fixture leaves in the working tree, in the shape the
	// tree API takes rather than as a diff.
	assert.deepEqual(args.files.map((f) => [f.path, f.kind]), [['text.txt', 'modify']]);
});

test('github:open-pr refuses before it reaches GitHub when nothing is signed in, or no ticket is linked', async (t) => {
	const dir = await fixtureRepo(t);
	const openPullRequest = spy(async () => ({ ok: true }));
	const auth = fakeGithubAuth();
	const settings = fakeSettingsStore({ sites: [dir], siteMeta: { [dir]: {} } });
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./github-auth.cjs': auth,
			'./github-pr.cjs': { openPullRequest, buildPullRequestBody: () => '' }
		}
	});

	assert.equal((await main.invoke('github:open-pr', dir, {})).reason, 'unauthorized');

	await main.invokeWith('github:sign-in', createIpcEvent());
	await settle();
	await settle();

	assert.equal((await main.invoke('github:open-pr', dir, {})).reason, 'no-ticket');
	assert.deepEqual(openPullRequest.calls, []);
});

test('github:open-pr forgets a revoked authorization rather than keep offering it', async (t) => {
	const dir = await fixtureRepo(t);
	const auth = fakeGithubAuth();
	const settings = fakeSettingsStore({ sites: [dir], siteMeta: { [dir]: { tracTicket: 1 } } });
	const main = loadMain({
		stubs: {
			...silentLogging(),
			...settings.stubs,
			'./github-auth.cjs': auth,
			'./github-pr.cjs': {
				openPullRequest: async () => ({ ok: false, reason: 'unauthorized', error: 'gone', stage: 'forking' }),
				buildPullRequestBody: () => ''
			}
		}
	});

	await main.invokeWith('github:sign-in', createIpcEvent());
	await settle();
	await settle();
	assert.notEqual((await main.invoke('github:account')).login, null);

	await main.invoke('github:open-pr', dir, {});

	assert.equal((await main.invoke('github:account')).login, null);
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
	'branches:list',
	'branches:switch',
	'branches:delete',
	'git:preview-patch',
	'git:apply-patch',
	'git:fetch-pr-diff',
	'git:list-ticket-patches',
	'trac:fetch-attachment',
	'editor:list',
	'editor:open',
	'dir:show',
	'wordpress:setup',
	'wp-debug:clear',
	'wp-debug:reveal',
	'provenance:set-handle',
	'provenance:set-event',
	'github:account',
	'github:sign-in',
	'github:open-pr'
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
	['provenance:get', 'electron-store read'],
	['smtp:get', 'electron-store read'],
	['smtp:clear', 'electron-store write'],
	['smtp:start', 'starts the in-process SMTP server'],
	['smtp:stop', 'stops the in-process SMTP server'],
	['wp-debug:start', 'tails a file'],
	['wp-debug:stop', 'stops a tail'],
	['github:sign-out', 'clears the in-memory token; asserted through github:account above'],
	['github:sign-in-cancel', 'sets a flag the in-flight poll reads']
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
	['trac:list-attachments', 'reads electron-store for the ticket before it can open the Trac window']
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
