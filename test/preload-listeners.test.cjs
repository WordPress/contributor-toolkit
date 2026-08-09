'use strict';

// src/preload.js is the only place that decides which renderer callback an
// install or script event belongs to, and the only place that unsubscribes when
// a run ends. Both decisions live in closures that never leave the module, so
// nothing else in the suite can reach them (#149).
//
// Two failure modes are what this file pins:
//
//  - cross-run bleed. The `on()` listeners are per-run but the channel is
//    global: every install's log handler sees every other install's log events
//    and is expected to drop them by comparing ids. Deleting that comparison
//    changes nothing a user sees until two runs overlap, and then one run's
//    output lands in the other's terminal.
//  - listener leak. Both handlers are removed by the done handler, and only for
//    the run it belongs to. Removing one but not the other, or removing them
//    only when the run succeeded, leaves a dead listener on a global channel for
//    the lifetime of the window. That is the shape of #86, and #43 is in this
//    same bridge.
//
// The module needs `electron` at import time, which is what left it untested.
// Nothing else about it needs Electron, so the seam is the same Module._load
// hook test/ipc-wiring.test.cjs uses for main.js — no production code changes
// for the sake of the test. The require is inert here: exposeInMainWorld just
// hands the api object back.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const PRELOAD_PATH = path.join(__dirname, '..', 'src', 'preload.js');

// True for the real `electron` package under any specifier that reaches it, the
// same test as in test/ipc-wiring.test.cjs and for the same reason: requiring it
// is not inert. node_modules/electron/index.js resolves the binary path at module
// scope and spawns the installer when it is missing, so a cold checkout would
// start a download into the directory test/electron-node-version.test.cjs spawns
// from — concurrently, since node --test runs files in parallel. preload.js only
// requires 'electron' today, so the narrow check would be enough; it is written
// wide because the day it requires a src/ helper that pulls electron in turn (as
// src/logging.js does), a narrow check fails silently and only on a cold checkout.
function isElectronPackage(request, resolvedId) {
	if (request === 'electron' || request.startsWith('electron/')) return true;
	return typeof resolvedId === 'string'
		&& resolvedId.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`);
}

// Stands in for ipcRenderer, and records rather than dispatches. `emit` is the
// main process's `event.sender.send`: it runs every listener currently
// subscribed to the channel, which is what makes a stale listener observable —
// a removed one simply is not called.
function createIpcRenderer({ invokeResults = {} } = {}) {
	const listeners = new Map();
	const invocations = [];

	return {
		invocations,
		async invoke(channel, ...args) {
			invocations.push({ channel, args });
			const result = invokeResults[channel];
			return typeof result === 'function' ? result(...args) : result;
		},
		on(channel, listener) {
			if (!listeners.has(channel)) listeners.set(channel, []);
			listeners.get(channel).push(listener);
		},
		removeListener(channel, listener) {
			const registered = listeners.get(channel);
			if (!registered) return;
			const at = registered.indexOf(listener);
			if (at !== -1) registered.splice(at, 1);
		},
		listenerCount(channel) {
			return (listeners.get(channel) || []).length;
		},
		// A copy, so a handler unsubscribing mid-dispatch cannot shorten the list
		// being iterated — Electron's own EventEmitter dispatches this way, and the
		// done handler removes itself while it runs.
		emit(channel, payload) {
			for (const listener of [...(listeners.get(channel) || [])]) listener({}, payload);
		}
	};
}

// Loads preload.js against a fake `electron` and returns the api object it
// exposed, plus the ipcRenderer it was given. The module is dropped from the
// cache each time so every test gets its own listener table.
function loadPreload(options = {}) {
	const ipcRenderer = createIpcRenderer(options);
	let api;
	const electron = {
		contextBridge: {
			exposeInMainWorld(key, value) {
				assert.equal(key, 'api');
				api = value;
			}
		},
		ipcRenderer
	};

	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (isElectronPackage(request)) return electron;
		let id;
		try {
			id = Module._resolveFilename(request, parent, isMain);
		} catch {
			return originalLoad.apply(this, arguments);
		}
		if (isElectronPackage(request, id)) return electron;
		return originalLoad.apply(this, arguments);
	};

	delete require.cache[require.resolve(PRELOAD_PATH)];
	try {
		require(PRELOAD_PATH);
	} finally {
		Module._load = originalLoad;
		delete require.cache[require.resolve(PRELOAD_PATH)];
	}

	assert.ok(api, 'preload.js did not expose an api object');
	return { api, ipcRenderer };
}

// Records what a renderer callback pair was handed.
function recorder() {
	const logs = [];
	const done = [];
	return { logs, done, onLog: (p) => logs.push(p), onDone: (p) => done.push(p) };
}

// The two run kinds differ only in their channel names and the key they
// correlate on, so they are described as data and share the assertions below. A
// third per-run subscription (updateTrunk) has the same shape; it is out of
// scope for #149 and deliberately not covered here.
const RUNS = [
	{
		name: 'runNpmInstall',
		idKey: 'installId',
		invokeChannel: 'npm:install',
		logChannel: 'npm:install:log',
		doneChannel: 'npm:install:done',
		start: (api, callbacks) => api.runNpmInstall('/sites/wp', callbacks.onLog, callbacks.onDone)
	},
	{
		name: 'runNpmScript',
		idKey: 'runId',
		invokeChannel: 'npm:run-script',
		logChannel: 'npm:run-script:log',
		doneChannel: 'npm:run-script:done',
		start: (api, callbacks) => api.runNpmScript('/sites/wp', 'build', [], callbacks.onLog, callbacks.onDone)
	}
];

// Hands out a fresh id per invoke, so two overlapping runs in one test get
// different ones without the test having to sequence the invokes itself.
function idSequence(idKey, ids) {
	let next = 0;
	return () => ({ [idKey]: ids[next++] });
}

for (const run of RUNS) {
	test(`${run.name} drops events belonging to another run`, async () => {
		const { api, ipcRenderer } = loadPreload({
			invokeResults: { [run.invokeChannel]: idSequence(run.idKey, ['mine']) }
		});
		const mine = recorder();

		await run.start(api, mine);

		ipcRenderer.emit(run.logChannel, { [run.idKey]: 'someone-else', type: 'stdout', data: 'not mine\n' });
		ipcRenderer.emit(run.doneChannel, { [run.idKey]: 'someone-else', code: 0 });

		assert.deepEqual(mine.logs, [], 'another run\'s output reached this run\'s callback');
		assert.deepEqual(mine.done, [], 'another run\'s completion reached this run\'s callback');

		// The foreign done event must not have unsubscribed this run either —
		// otherwise the run goes silent from here on.
		ipcRenderer.emit(run.logChannel, { [run.idKey]: 'mine', type: 'stdout', data: 'mine\n' });
		assert.deepEqual(mine.logs, [{ [run.idKey]: 'mine', type: 'stdout', data: 'mine\n' }]);
	});

	// Both exit codes, because the removal sits inside the done handler and a
	// version that unsubscribed only on success would still pass a happy-path
	// test — while leaking a listener on exactly the runs contributors hit most.
	for (const code of [0, 1]) {
		test(`${run.name} removes both listeners when the run ends with code ${code}`, async () => {
			const { api, ipcRenderer } = loadPreload({
				invokeResults: { [run.invokeChannel]: idSequence(run.idKey, ['mine']) }
			});
			const mine = recorder();

			await run.start(api, mine);
			assert.equal(ipcRenderer.listenerCount(run.logChannel), 1);
			assert.equal(ipcRenderer.listenerCount(run.doneChannel), 1);

			ipcRenderer.emit(run.doneChannel, { [run.idKey]: 'mine', code });

			assert.deepEqual(mine.done, [{ [run.idKey]: 'mine', code }]);
			assert.equal(ipcRenderer.listenerCount(run.logChannel), 0, 'log listener outlived the run');
			assert.equal(ipcRenderer.listenerCount(run.doneChannel), 0, 'done listener outlived the run');

			// And nothing arriving afterwards can still reach the callbacks.
			ipcRenderer.emit(run.logChannel, { [run.idKey]: 'mine', type: 'stdout', data: 'late\n' });
			ipcRenderer.emit(run.doneChannel, { [run.idKey]: 'mine', code });
			assert.deepEqual(mine.logs, []);
			assert.deepEqual(mine.done, [{ [run.idKey]: 'mine', code }]);
		});
	}

	test(`${run.name} keeps two overlapping runs apart`, async () => {
		const { api, ipcRenderer } = loadPreload({
			invokeResults: { [run.invokeChannel]: idSequence(run.idKey, ['first', 'second']) }
		});
		const first = recorder();
		const second = recorder();

		await run.start(api, first);
		await run.start(api, second);

		ipcRenderer.emit(run.logChannel, { [run.idKey]: 'first', type: 'stdout', data: 'a\n' });
		ipcRenderer.emit(run.logChannel, { [run.idKey]: 'second', type: 'stderr', data: 'b\n' });

		assert.deepEqual(first.logs, [{ [run.idKey]: 'first', type: 'stdout', data: 'a\n' }]);
		assert.deepEqual(second.logs, [{ [run.idKey]: 'second', type: 'stderr', data: 'b\n' }]);

		// Finishing the first run unsubscribes the first run only. Removing by
		// channel rather than by handler would take the second run's listeners
		// with it and leave a live run with no output.
		ipcRenderer.emit(run.doneChannel, { [run.idKey]: 'first', code: 0 });
		assert.equal(ipcRenderer.listenerCount(run.logChannel), 1);
		assert.equal(ipcRenderer.listenerCount(run.doneChannel), 1);

		ipcRenderer.emit(run.logChannel, { [run.idKey]: 'second', type: 'stdout', data: 'c\n' });
		ipcRenderer.emit(run.doneChannel, { [run.idKey]: 'second', code: 0 });

		assert.equal(second.logs.length, 2);
		assert.deepEqual(second.done, [{ [run.idKey]: 'second', code: 0 }]);
		assert.deepEqual(first.done, [{ [run.idKey]: 'first', code: 0 }]);
		assert.equal(ipcRenderer.listenerCount(run.logChannel), 0);
		assert.equal(ipcRenderer.listenerCount(run.doneChannel), 0);
	});

	// The callbacks are optional in the signature, and the done handler reads
	// `onDone` only after it has already unsubscribed — but a caller passing
	// neither must not leave the listeners behind on a global channel.
	test(`${run.name} still unsubscribes when no callbacks were given`, async () => {
		const { api, ipcRenderer } = loadPreload({
			invokeResults: { [run.invokeChannel]: idSequence(run.idKey, ['mine']) }
		});

		await run.start(api, {});

		ipcRenderer.emit(run.logChannel, { [run.idKey]: 'mine', type: 'stdout', data: 'x\n' });
		ipcRenderer.emit(run.doneChannel, { [run.idKey]: 'mine', code: 0 });

		assert.equal(ipcRenderer.listenerCount(run.logChannel), 0);
		assert.equal(ipcRenderer.listenerCount(run.doneChannel), 0);
	});
}

// --- GitHub sign-in (#167) -----------------------------------------------
//
// The same listener-leak shape as the run subscriptions above, in a bridge with
// one difference that matters: the subscription is made *before* the invoke,
// because the outcome event can arrive at any point after it and missing it
// would leave the card waiting forever on a sign-in that already finished. That
// ordering is what creates the leak this pins — a sign-in that never starts has
// no outcome coming, and the listener left behind would fire on the next one.

test('signInToGithub subscribes before invoking, and unsubscribes once the outcome arrives', async () => {
	const { api, ipcRenderer } = loadPreload({
		invokeResults: { 'github:sign-in': () => ({ ok: true, userCode: 'WDJB-MJHT' }) }
	});
	const outcomes = [];

	const started = await api.signInToGithub((payload) => outcomes.push(payload));

	assert.deepEqual(started, { ok: true, userCode: 'WDJB-MJHT' });
	assert.equal(ipcRenderer.listenerCount('github:sign-in:done'), 1);

	ipcRenderer.emit('github:sign-in:done', { ok: true, login: 'janedoe' });

	assert.deepEqual(outcomes, [{ ok: true, login: 'janedoe' }]);
	assert.equal(ipcRenderer.listenerCount('github:sign-in:done'), 0);

	// A second event on a global channel must reach nobody: the card is done
	// with this sign-in, and a callback firing again would overwrite the
	// account it just settled on.
	ipcRenderer.emit('github:sign-in:done', { ok: false, reason: 'denied' });
	assert.equal(outcomes.length, 1);
});

test('signInToGithub leaves no listener behind when the sign-in never starts', async () => {
	const { api, ipcRenderer } = loadPreload({
		invokeResults: { 'github:sign-in': () => ({ ok: false, reason: 'not-configured', error: 'no application' }) }
	});
	const outcomes = [];

	const started = await api.signInToGithub((payload) => outcomes.push(payload));

	assert.equal(started.ok, false);
	assert.equal(ipcRenderer.listenerCount('github:sign-in:done'), 0);

	// The next sign-in's outcome must not reach the callback from the one that
	// failed to start.
	ipcRenderer.emit('github:sign-in:done', { ok: true, login: 'someone-else' });
	assert.deepEqual(outcomes, []);
});

// The path with neither outcome nor failed start: a cancelled sign-in. The
// main process deliberately goes quiet, so nothing arrives to trigger the
// self-removal — cancel itself has to drop the listener, or every
// sign-in→cancel cycle leaks one for the life of the window and a later
// successful sign-in fires all the stale callbacks.
test('cancelGithubSignIn drops the outcome listener the quiet cancel would strand', async () => {
	const { api, ipcRenderer } = loadPreload({
		invokeResults: {
			'github:sign-in': () => ({ ok: true, userCode: 'WDJB-MJHT' }),
			'github:sign-in-cancel': () => ({ ok: true })
		}
	});
	const outcomes = [];

	await api.signInToGithub((payload) => outcomes.push(payload));
	await api.cancelGithubSignIn();

	assert.equal(ipcRenderer.listenerCount('github:sign-in:done'), 0);

	// The next sign-in must reach only its own callback, once.
	const next = [];
	await api.signInToGithub((payload) => next.push(payload));
	ipcRenderer.emit('github:sign-in:done', { ok: true, login: 'janedoe' });
	assert.deepEqual(outcomes, []);
	assert.deepEqual(next, [{ ok: true, login: 'janedoe' }]);
});

// A second sign-in supersedes the first in the main process, so the first's
// outcome is never coming either — starting again must not accumulate.
test('a superseding sign-in replaces the previous listener instead of stacking one', async () => {
	const { api, ipcRenderer } = loadPreload({
		invokeResults: { 'github:sign-in': () => ({ ok: true, userCode: 'WDJB-MJHT' }) }
	});
	const first = [];
	const second = [];

	await api.signInToGithub((payload) => first.push(payload));
	await api.signInToGithub((payload) => second.push(payload));

	assert.equal(ipcRenderer.listenerCount('github:sign-in:done'), 1);

	ipcRenderer.emit('github:sign-in:done', { ok: true, login: 'janedoe' });
	assert.deepEqual(first, []);
	assert.deepEqual(second, [{ ok: true, login: 'janedoe' }]);
});

test('subscribePullRequestProgress hands back its own unsubscribe', () => {
	const { api, ipcRenderer } = loadPreload();
	const seen = [];

	const unsubscribe = api.subscribePullRequestProgress((payload) => seen.push(payload));
	ipcRenderer.emit('github:pr:progress', { sitePath: '/sites/wp', stage: 'forking' });
	unsubscribe();
	ipcRenderer.emit('github:pr:progress', { sitePath: '/sites/wp', stage: 'opening' });

	assert.deepEqual(seen, [{ sitePath: '/sites/wp', stage: 'forking' }]);
	assert.equal(ipcRenderer.listenerCount('github:pr:progress'), 0);
});

// The guard for the paragraph above isElectronPackage: if the stub ever stops
// covering a path, this fails here rather than as a mystery download in another
// file's test on a cold checkout.
test('the harness never loads the real electron package', () => {
	loadPreload();

	const loaded = Object.keys(require.cache)
		.filter((file) => file.includes(`${path.sep}node_modules${path.sep}electron${path.sep}`));

	assert.deepEqual(loaded, [], 'the real electron package was required; the stub did not cover this path');
});

// The renderer needs the id to kill a running script (`npm:kill` takes a runId),
// so it has to come back out of the bridge.
test('runNpmScript returns the run id to the caller', async () => {
	const { api } = loadPreload({ invokeResults: { 'npm:run-script': () => ({ runId: 'r1' }) } });

	assert.deepEqual(await api.runNpmScript('/sites/wp', 'build', [], () => {}, () => {}), { runId: 'r1' });
});

// Both run kinds subscribe only after the invoke has answered with an id, so
// anything the child writes before that answer reaches no callback. `startServer`
// in the same file does the opposite deliberately ("Invoke AFTER listeners are
// attached so early logs/URL are captured"), which is what the fix would look
// like here. Left as a note rather than a test: asserting the current ordering
// would pin the gap shut, and closing it is not #149.

// --- the subscribe* family (#173) ------------------------------------------
//
// The other half of the bridge, and until now untested. These are long-lived
// subscriptions rather than the per-run pairs above, which is exactly why the
// switch progress uses one: a switch emits its first event milliseconds in,
// well before its invoke answers, so the ordering gap noted at the end of this
// file would have swallowed the start of every switch.
//
// The leak shape here is different too. `App` subscribes once for every site
// rather than per run, so an unsubscribe that removed by channel instead of by
// handler would silence a site that is still open.
const SUBSCRIPTIONS = [
	{ name: 'subscribeSwitchProgress', channel: 'switch:progress' },
	{ name: 'subscribeSetupProgress', channel: 'download:progress' },
	{ name: 'subscribeSetupStatus', channel: 'download:status' }
];

for (const sub of SUBSCRIPTIONS) {
	test(`${sub.name}: subscribing listens once and unsubscribing stops (issue #173)`, () => {
		const { api, ipcRenderer } = loadPreload();

		const unsubscribe = api[sub.name](() => {});
		assert.equal(ipcRenderer.listenerCount(sub.channel), 1);

		unsubscribe();
		assert.equal(ipcRenderer.listenerCount(sub.channel), 0);
	});

	test(`${sub.name}: the handler gets the payload, never the Electron event (issue #173)`, () => {
		const { api, ipcRenderer } = loadPreload();
		const seen = [];

		api[sub.name]((payload) => seen.push(payload));
		ipcRenderer.emit(sub.channel, { sitePath: '/sites/wp', stage: 'scan' });

		assert.deepEqual(seen, [{ sitePath: '/sites/wp', stage: 'scan' }]);
	});

	test(`${sub.name}: one unsubscribe leaves other subscribers alone (issue #173)`, () => {
		const { api, ipcRenderer } = loadPreload();
		const mine = [];
		const theirs = [];

		const unsubscribeMine = api[sub.name]((p) => mine.push(p));
		api[sub.name]((p) => theirs.push(p));
		unsubscribeMine();

		ipcRenderer.emit(sub.channel, { stage: 'done' });
		assert.equal(ipcRenderer.listenerCount(sub.channel), 1);
		assert.deepEqual(mine, []);
		assert.deepEqual(theirs, [{ stage: 'done' }]);
	});

	test(`${sub.name}: unsubscribing twice, and no handler at all, are both safe (issue #173)`, () => {
		const { api, ipcRenderer } = loadPreload();

		const unsubscribe = api[sub.name]();
		ipcRenderer.emit(sub.channel, { stage: 'scan' });
		unsubscribe();
		unsubscribe();

		assert.equal(ipcRenderer.listenerCount(sub.channel), 0);
	});
}
