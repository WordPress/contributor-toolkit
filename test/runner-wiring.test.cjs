'use strict';

// The two runner processes main.js spawns — src/server-runner.js and
// src/playground-web-runner.js — each open by calling hideChildWindows() and
// bindLoopbackOnly(), and only then loading the Playground CLI. That order is
// load-bearing: `@wp-playground/cli` starts its server with `listen(port, cb)`
// and no address, so Node binds every interface unless bind-loopback.js has
// already patched `net.Server.prototype.listen` by the time the CLI is required.
// Get it wrong and the contributor's WordPress — admin/admin and all — is served
// to the whole LAN (#159).
//
// bind-loopback.js and hide-child-windows.js are thoroughly tested on their own,
// but nothing loaded either runner, so deleting a call — or a require-sorting
// tool hoisting the CLI import above the two calls — left the whole suite green.
// These tests close that gap. They assert ORDER, not just that the calls
// happened: both patches must run BEFORE the Playground CLI module is loaded.
//
// The harness is the Module._load interception approach established in
// test/ipc-wiring.test.cjs: replace the modules a file loads at require time,
// and let the file run against the stubs. It is reproduced here rather than
// shared because `node --test` discovers every .cjs under test/ and would report
// a helper file as a suite of its own, and because what is recorded here (a load
// order across a spawned runner) is a different shape from that file's handler
// recorders — sharing would be more contortion than the few lines it saves.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const SRC_DIR = path.join(__dirname, '..', 'src');
const SERVER_RUNNER = path.join(SRC_DIR, 'server-runner.js');
const WEB_RUNNER = path.join(SRC_DIR, 'playground-web-runner.js');

// The bare specifiers the runners load. `@wp-playground/cli` is the one whose
// load has to come last; the rest are stubbed only to keep the real packages —
// none of which need to run, and two of which are not even installed here — off
// the test.
const PLAYGROUND_CLI = '@wp-playground/cli';
const PHP_WASM = '@php-wasm/universal';

function clearSrcCache() {
	for (const filename of Object.keys(require.cache)) {
		if (filename.startsWith(SRC_DIR + path.sep)) delete require.cache[filename];
	}
}

// True for a real package this test must never let load: the Playground packages
// (not installed here, so requiring one would throw on the way to failing) and
// electron. If any of these reaches require.cache, a stub was dropped.
function realPackageLoaded() {
	const marks = [
		`${path.sep}node_modules${path.sep}@wp-playground${path.sep}`,
		`${path.sep}node_modules${path.sep}@php-wasm${path.sep}`,
		`${path.sep}node_modules${path.sep}electron${path.sep}`
	];
	return Object.keys(require.cache).some((file) => marks.some((mark) => file.includes(mark)));
}

// Loads a runner with its side-effecting dependencies replaced, and returns the
// ordered log of what it called and loaded.
//
// hideChildWindows/bindLoopbackOnly are recorded when the runner *calls* them;
// the Playground CLI is recorded when the runner *requires* it. Comparing their
// positions in one log is what pins the ordering.
//
// runCLI returns a promise that never settles, so the runner's main() parks at
// its first `await` — after the require under test, and before the boot path
// that would read files, bind ports, or (on error) call process.exit. The
// require of the CLI is synchronous and happens before that await, so it is
// already recorded by the time require(runnerPath) returns.
function loadRunner(runnerPath, extraArgv) {
	const events = [];
	const cliStub = { runCLI: () => new Promise(() => {}) };
	const phpWasmStub = { writeFiles: async () => {} };
	const hideStub = { hideChildWindows: () => { events.push('call:hideChildWindows'); } };
	const bindStub = { bindLoopbackOnly: () => { events.push('call:bindLoopbackOnly'); } };

	const originalLoad = Module._load;
	const originalArgv = process.argv;
	// The runners read argv[2] (a build / mount directory) and exit(1) without
	// one, which would end main() before it ever reaches the CLI require.
	process.argv = [process.execPath, runnerPath, ...extraArgv];

	// Matched by request string, not resolved path: `@wp-playground/cli` and
	// `@php-wasm/universal` are not installed in this checkout, so
	// require.resolve would throw before any comparison. The relative specifiers
	// are the exact strings both runners write.
	Module._load = function (request) {
		if (request === PLAYGROUND_CLI) { events.push('load:@wp-playground/cli'); return cliStub; }
		if (request === PHP_WASM) return phpWasmStub;
		if (request === './hide-child-windows') return hideStub;
		if (request === './bind-loopback') return bindStub;
		return originalLoad.apply(this, arguments);
	};

	// Re-execute the runner each time: its top-level calls are the whole point,
	// and a cached module would run them zero times on the second load.
	clearSrcCache();
	try {
		require(runnerPath);
	} finally {
		Module._load = originalLoad;
		process.argv = originalArgv;
		clearSrcCache();
	}

	return events;
}

// The shared assertion: both patches were called, the CLI was loaded, and both
// calls came first. `indexOf` returns -1 for a missing event, so the presence
// checks run before the ordering ones — otherwise a deleted call (-1) would slip
// past `-1 < cli` as if it were the earliest event.
function assertPatchesPrecedeCli(events, runner) {
	assert.ok(events.includes('call:bindLoopbackOnly'), `${runner}: bindLoopbackOnly() was never called`);
	assert.ok(events.includes('call:hideChildWindows'), `${runner}: hideChildWindows() was never called`);
	assert.ok(events.includes('load:@wp-playground/cli'), `${runner}: the Playground CLI was never loaded`);

	const cli = events.indexOf('load:@wp-playground/cli');
	assert.ok(
		events.indexOf('call:bindLoopbackOnly') < cli,
		`${runner}: bindLoopbackOnly() ran after the Playground CLI was loaded — the LAN is served for the gap between them`
	);
	assert.ok(
		events.indexOf('call:hideChildWindows') < cli,
		`${runner}: hideChildWindows() ran after the Playground CLI was loaded`
	);
}

test('server-runner patches loopback and hides child windows before loading the Playground CLI', () => {
	const events = loadRunner(SERVER_RUNNER, ['/tmp/does-not-need-to-exist']);
	assertPatchesPrecedeCli(events, 'server-runner');
	assert.equal(realPackageLoaded(), false, 'server-runner loaded a real electron/Playground package instead of the stub');
});

test('playground-web-runner patches loopback and hides child windows before loading the Playground CLI', () => {
	const events = loadRunner(WEB_RUNNER, ['/tmp/does-not-need-to-exist']);
	assertPatchesPrecedeCli(events, 'playground-web-runner');
	assert.equal(realPackageLoaded(), false, 'playground-web-runner loaded a real electron/Playground package instead of the stub');
});
