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
// tests/unit/ipc-wiring.test.cjs: replace the modules a file loads at require time,
// and let the file run against the stubs. It is reproduced here rather than
// shared because what is recorded here — a load order across a spawned runner —
// is a different shape from that file's handler recorders, and sharing would be
// more contortion than the few lines it saves. It was also once impossible:
// `node --test` collected every .cjs under a directory named `test/`, so a helper
// file would have been reported as a suite of its own. The move to tests/unit/
// ended that; the reason above is the one that still holds.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');

const { WP_DEBUG_CONSTANTS } = require('../../src/wp-debug-constants');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');
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
// ordered log of what it called and loaded, plus the options it handed runCLI.
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
	// runCLI is called synchronously, before the `await` main() parks at, so its
	// argument is already recorded by the time require(runnerPath) returns.
	const cliCalls = [];
	const cliStub = { runCLI: (options) => { cliCalls.push(options); return new Promise(() => {}); } };
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

	return { events, cliOptions: cliCalls[0] };
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
	const { events } = loadRunner(SERVER_RUNNER, ['/tmp/does-not-need-to-exist']);
	assertPatchesPrecedeCli(events, 'server-runner');
	assert.equal(realPackageLoaded(), false, 'server-runner loaded a real electron/Playground package instead of the stub');
});

test('playground-web-runner patches loopback and hides child windows before loading the Playground CLI', () => {
	const { events } = loadRunner(WEB_RUNNER, ['/tmp/does-not-need-to-exist']);
	assertPatchesPrecedeCli(events, 'playground-web-runner');
	assert.equal(realPackageLoaded(), false, 'playground-web-runner loaded a real electron/Playground package instead of the stub');
});

// The blueprint's `constants` step is the only place these can be set: Playground
// generates the wp-config.php itself, and a constant has to be defined before
// WordPress loads to have any effect.
//
// tests/unit/wp-debug-constants.test.cjs asserts the values. This asserts the wiring,
// which is where the bug actually lived — the app tailed build/wp-content/debug.log
// for a file WordPress was never told to write, and the module exporting the
// right constants would not have caught that on its own.
test('server-runner passes the WordPress debug constants to Playground', () => {
	const { cliOptions } = loadRunner(SERVER_RUNNER, ['/tmp/does-not-need-to-exist']);

	assert.ok(cliOptions, 'runCLI was never called');
	const constants = cliOptions.blueprint && cliOptions.blueprint.constants;
	assert.ok(constants, 'the blueprint carries no constants at all');

	for (const [name, value] of Object.entries(WP_DEBUG_CONSTANTS)) {
		assert.strictEqual(constants[name], value, `${name} did not reach the blueprint`);
	}
});

// Spreading the debug constants in ahead of the mail ones must not have taken
// the mail ones out: this is how a site's outgoing mail reaches the app's SMTP
// catcher, and losing it is silent — mail simply stops arriving.
test('the SMTP constants survive alongside them', () => {
	const { cliOptions } = loadRunner(SERVER_RUNNER, ['/tmp/does-not-need-to-exist']);
	const constants = cliOptions.blueprint.constants;

	assert.strictEqual(constants.WP_MAIL_SMTP_HOST, '127.0.0.1');
	assert.strictEqual(typeof constants.WP_MAIL_SMTP_PORT, 'number');
});
