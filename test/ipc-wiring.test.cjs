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

// `stubs` is keyed by the specifier as main.js writes it ('./trunk-update',
// 'child_process'), and the value holds only the exports to replace: the rest of
// the real module is kept, so stubbing one function does not silently disable
// its neighbours.
function resolveStubs(stubs) {
	const resolved = new Map();

	for (const [specifier, overrides] of Object.entries(stubs)) {
		const id = specifier.startsWith('.')
			? require.resolve(path.join(SRC_DIR, specifier))
			: specifier;
		const stub = { ...require(id), ...overrides };
		resolved.set(id, stub);
		// A builtin is the same module under both spellings, and main.js writing
		// `require('node:child_process')` instead must not silently leave the stub
		// unapplied — that would spawn a real process on the way to failing.
		if (!specifier.startsWith('.')) {
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
	const stubbed = resolveStubs(stubs);
	const recorder = createElectronStub();

	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (request === 'electron') return recorder.electron;

		let id;
		try {
			id = Module._resolveFilename(request, parent, isMain);
		} catch {
			return originalLoad.apply(this, arguments);
		}

		if (stubbed.has(id)) return stubbed.get(id);
		return originalLoad.apply(this, arguments);
	};

	// Before and after: a previous load must not leave a stubbed src module in
	// the cache for the next one, and main.js itself has to be re-executed each
	// time so its handlers close over this load's stubs.
	clearSrcCache();
	try {
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

test('git:discard-changes goes through trunk-update', async () => {
	const discardChanges = spy(async () => {});
	const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { discardChanges } } });

	assert.deepEqual(await main.invoke('git:discard-changes', '/sites/wp'), { ok: true });
	assert.deepEqual(discardChanges.calls, [['/sites/wp']]);
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
	const ensureAutocrlf = spy(async () => {});
	const main = loadMain({ stubs: { ...silentLogging(), './trunk-update': { ensureAutocrlf } } });

	// The handler goes on to write to electron-store, which has no app to live
	// in here and rejects. Irrelevant: ensureAutocrlf comes first, and whether it
	// was reached is the whole question.
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
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.pid = 4242;
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
	assert.equal(buildChildEnv.calls.length, 1);
	assert.equal(createEngineMismatchDetector.calls.length, 1);
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
});

test('quitting sweeps running children through kill-tree', async () => {
	const cp = stubbedSpawn();
	const killChildTree = spy();
	const main = loadMain({
		stubs: {
			...silentLogging(),
			'child_process': { spawn: cp.spawn },
			'./kill-tree': { killChildTree }
		}
	});

	await main.invoke('npm:install', '/sites/wp');
	await main.emitAppEvent('before-quit');

	// Not child.kill(): the children are trees (runner -> npm -> shell -> grunt)
	// and only kill-tree ends the whole one (#83).
	assert.deepEqual(killChildTree.calls, [[cp.children[0]]]);
	assert.deepEqual(cp.children[0].kill.calls, []);
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
	'npm:install',
	'npm:run-script'
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
	['sites:delete', 'electron-store write plus a directory removal'],
	['sites:set-label', 'electron-store write'],
	['dialog:choose-dir', 'opens the directory dialog'],
	['playground-web:available', 'checks a path on disk'],
	['smtp:get', 'electron-store read'],
	['smtp:clear', 'electron-store write'],
	['smtp:start', 'starts the in-process SMTP server'],
	['smtp:stop', 'stops the in-process SMTP server'],
	['wp-debug:start', 'tails a file'],
	['wp-debug:stop', 'stops a tail']
]);

// The uncomfortable list. These handlers call no module — they hold the spawn
// and kill invariants inline instead: the child environment built by hand rather
// than by buildChildEnv, `shell: false`, `windowsHide: true`, `detached` on
// POSIX, and `child.kill()` where the npm paths use killChildTree. So they carry
// exactly the kind of guard #129 is about, and deleting `detached:` from
// playground:start still leaves this suite green.
//
// Wiring them means either giving them the modules the npm handlers use, or
// asserting the spawn options directly — a decision about main.js, not about
// this file, which is why it is recorded here rather than quietly folded into
// NO_DELEGATION. Follow-up.
const UNWIRED_INVARIANTS = new Map([
	['npm:kill', 'signals with child.kill() rather than killChildTree'],
	['playground:start', 'hand-builds the child env and the spawn options for server-runner.js'],
	['playground:stop', 'stops a spawned server with child.kill()'],
	['playground-web:start', 'hand-builds the child env and the spawn options for playground-web-runner.js'],
	['playground-web:stop', 'stops a spawned server with child.kill()']
]);

// Channels that do delegate, but whose call sits behind something this harness
// cannot stand in for yet. Each one is a known hole, not an oversight.
const NOT_REACHABLE = new Map([
	['site:status', 'reads electron-store before calling readTrunkInfo, and the store is a dynamic ESM import that Module._load cannot replace'],
	['wordpress:setup', 'calls ensureAutocrlf and readTrunkInfo only after cloning wordpress-develop over the network']
]);

const CLASSIFIED = [...WIRED, ...NO_DELEGATION.keys(), ...UNWIRED_INVARIANTS.keys(), ...NOT_REACHABLE.keys()];

test('every IPC channel is classified: wired, or explicitly not', () => {
	const main = loadMain({ stubs: silentLogging() });
	const registered = main.channels();

	const unclassified = registered.filter((channel) => !CLASSIFIED.includes(channel));
	assert.deepEqual(
		unclassified,
		[],
		`New IPC handler(s) with no wiring test. Add a test above and list the channel in WIRED, ` +
		`or record why there is nothing to wire in NO_DELEGATION / UNWIRED_INVARIANTS / NOT_REACHABLE.`
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
