const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { hideElectronRuntime, ELECTRON_VERSION_KEYS } = require('../../src/electron-node-compat.js');
const { COMPAT_FLAG } = require('../../src/node-shims.cjs');

const COMPAT_PATH = path.join(__dirname, '..', '..', 'src', 'electron-node-compat.js');

// The detection this patch exists to defeat, spelled out rather than described:
// `yargs/helpers.hideBin` slices process.argv from here, and reads "electron set,
// defaultApp unset" as a packaged Electron app whose argv carries no script path.
// Under ELECTRON_RUN_AS_NODE both halves hold while a script path *is* present,
// so every yargs-based tool starts reading one argument too early (#275).
function yargsArgvStart(proc) {
	const isElectronApp = Boolean(proc.versions && proc.versions.electron);
	const isBundledElectronApp = isElectronApp && !proc.defaultApp;
	return isBundledElectronApp ? 1 : 2;
}

function fakeElectronProcess() {
	return {
		versions: {
			node: '24.18.0',
			electron: '43.2.0',
			chrome: '150.0.7871.129',
			v8: '15.0.1240245-electron.0'
		}
	};
}

test('hideElectronRuntime makes an Electron runtime describe itself as Node', () => {
	const proc = fakeElectronProcess();

	assert.deepEqual(hideElectronRuntime(proc), ELECTRON_VERSION_KEYS);
	assert.equal(proc.versions.electron, undefined);
	// Node's own identity has to survive: this hides a runtime, it does not fake one.
	assert.equal(proc.versions.node, '24.18.0');
	// Left alone on purpose — tools parse it as a version number.
	assert.equal(proc.versions.v8, '15.0.1240245-electron.0');
});

// The bug itself, at the only layer where it can be pinned deterministically on
// both runtimes: not "a key is gone" but "argument parsing lands where it should".
test('hiding the runtime moves a yargs-style tool back onto its real arguments', () => {
	const proc = fakeElectronProcess();
	// What the shim actually produces: the Electron binary, the tool, its args.
	const argv = ['/path/to/Electron', '/site/node_modules/.bin/runner', 'npm run build:js'];

	assert.equal(yargsArgvStart(proc), 1);
	// One argument too few is sliced off, so the tool's own path arrives as the
	// first thing the user supposedly asked for. For a task runner that is a
	// command to run — itself, with no arguments — and the copy it starts does
	// the same, without end.
	assert.deepEqual(argv.slice(yargsArgvStart(proc)), [
		'/site/node_modules/.bin/runner',
		'npm run build:js'
	]);

	hideElectronRuntime(proc);

	assert.equal(yargsArgvStart(proc), 2);
	assert.deepEqual(argv.slice(yargsArgvStart(proc)), ['npm run build:js']);
});

// Widening this set is the tempting change — the runtime still describes itself
// as Chrome-flavoured — and it is the one that must not be made silently.
// Hiding `versions.chrome` as well fails Gutenberg's bundling step outright,
// because build tooling reads it to decide what to compile for. That question is
// about the output, not about who is running the compiler.
test('the Chrome version is deliberately left in place', () => {
	const proc = fakeElectronProcess();

	hideElectronRuntime(proc);

	assert.equal(proc.versions.chrome, '150.0.7871.129');
	assert.deepEqual(ELECTRON_VERSION_KEYS, ['electron']);
});

test('hideElectronRuntime reports honestly when there is nothing to hide', () => {
	const plainNode = { versions: { node: '24.18.0', v8: '13.6.233.10' } };

	assert.deepEqual(hideElectronRuntime(plainNode), []);
	assert.equal(plainNode.versions.node, '24.18.0');

	assert.deepEqual(hideElectronRuntime({}), []);
	assert.deepEqual(hideElectronRuntime(null), []);
});

// A frozen `versions` makes `delete` a silent no-op in sloppy mode. Claiming
// success there would be worse than failing: the caller would stop looking.
test('hideElectronRuntime does not claim a removal it could not make', () => {
	const frozen = { versions: Object.freeze({ node: '24.18.0', electron: '43.2.0' }) };

	assert.deepEqual(hideElectronRuntime(frozen), []);
	assert.equal(frozen.versions.electron, '43.2.0');
});

// Everything above works on a fake process. These two spawn a real child, so
// they also cover the wiring — and under `npm run test:electron` the child is
// Electron, which is the only place the bug can actually occur.
const REPORT_RUNTIME = 'process.stdout.write(JSON.stringify({'
	+ 'electron: process.versions.electron || null,'
	+ 'chrome: process.versions.chrome || null,'
	+ 'node: process.versions.node || null'
	+ '}))';

// Mirrors what the shim does: --require as an argument, plus the flag that lets
// the preload act. See node-shims.cjs.
function runtimeOfChild({ preload = true, flag = true } = {}) {
	const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' };
	delete env[COMPAT_FLAG];
	if (flag) env[COMPAT_FLAG] = '1';

	const args = preload ? ['--require', COMPAT_PATH, '-e', REPORT_RUNTIME] : ['-e', REPORT_RUNTIME];
	const result = spawnSync(process.execPath, args, {
		env,
		encoding: 'utf8',
		shell: false,
		windowsHide: true
	});
	assert.equal(result.status, 0, `child failed: ${result.stderr}`);
	return JSON.parse(result.stdout);
}

test('a child started the way the shim starts one sees plain Node', () => {
	const runtime = runtimeOfChild();

	assert.equal(runtime.electron, null);
	assert.ok(runtime.node, 'the child still reports a Node version');
});

// Under `npm run test:electron` this is the assertion that would have caught the
// bug: without the preload the child really is an Electron pretending to be Node.
// On the system Node it is vacuous, and CI runs the suite on both.
test('without the preload the child still looks like Electron', (t) => {
	// Reported as skipped rather than passed: on the system Node this asserts
	// nothing, and a silent pass is how a one-runtime test goes unnoticed.
	if (!process.versions.electron) return t.skip('needs the Electron runtime');

	const runtime = runtimeOfChild({ preload: false });

	assert.equal(runtime.electron, process.versions.electron);
});

// The preload is loaded by anything that requires the module — including this
// suite. It must stay inert unless the app asked for it, or the Electron test
// pass would strip its own runtime out from under the other tests.
test('the preload stays inert without the flag the shim sets', (t) => {
	if (!process.versions.electron) return t.skip('needs the Electron runtime');

	const runtime = runtimeOfChild({ flag: false });

	assert.equal(runtime.electron, process.versions.electron);
});

// SHAKE256 (#586). Electron's BoringSSL has none, and npm's isolated installer
// names node_modules/.store with it, so a project on `install-strategy = linked`
// (Gutenberg, since WordPress/gutenberg#83847) cannot install. The vectors are
// from OpenSSL, so they pin the real hash on either runtime: the .store names
// must match what plain Node produces, not merely be stable.
const { provideShake256, Shake256 } = require('../../src/electron-node-compat.js');

const SHAKE256_VECTORS = [
	{ input: '', length: 32, hex: '46b9dd2b0ba88d13233b3feb743eeb243fcd52ea62b81b82b50c27646ed5762f' },
	{ input: 'abc', length: 16, hex: '483366601360a8771c6863080cc4114d' },
	// Longer than one 136-byte block, so absorbing crosses a permutation.
	{ input: 'a'.repeat(200), length: 64, hex: 'e49647491c9d12d125a2f75826c96f6307d2fabebcbb9fb1616d76b09499380e8bcf60f72750879140e73fb7453a979b69d25efa8de613462f108ce7f2f1d7c5' }
];

test('Shake256 produces the real SHAKE256', () => {
	for (const { input, length, hex } of SHAKE256_VECTORS) {
		assert.equal(new Shake256({ outputLength: length }).update(input).digest('hex'), hex);
	}
	// Default length, and input split across update() calls.
	assert.equal(
		new Shake256().update('a'.repeat(150)).update('a'.repeat(50)).digest('hex'),
		SHAKE256_VECTORS[2].hex.slice(0, 64)
	);
});

// Where the runtime has its own SHAKE256 (plain Node), the two must agree at
// every boundary: input and output either side of a 136-byte block.
test('Shake256 agrees with the runtime at block boundaries', (t) => {
	const crypto = require('node:crypto');
	try {
		crypto.createHash('shake256', { outputLength: 16 });
	} catch {
		return t.skip('needs a runtime with SHAKE256');
	}
	for (const inputLength of [0, 135, 136, 137, 1000]) {
		const input = Buffer.alloc(inputLength).map((_, i) => (i * 31 + 7) % 256);
		for (const outputLength of [0, 16, 136, 137, 300]) {
			assert.equal(
				new Shake256({ outputLength }).update(input).digest('hex'),
				crypto.createHash('shake256', { outputLength }).update(input).digest('hex'),
				`input ${inputLength}, output ${outputLength}`
			);
		}
	}
});

// The call npm makes, on a crypto that throws the way Electron's does.
test('provideShake256 fills in shake256 and leaves every other algorithm alone', () => {
	const calls = [];
	const electronLike = {
		createHash(algorithm) {
			calls.push(algorithm);
			if (algorithm === 'shake256') throw new Error('Digest method not supported');
			return { algorithm };
		}
	};

	assert.equal(provideShake256(electronLike), true);
	assert.equal(
		electronLike.createHash('shake256', { outputLength: 16 }).update('abc').digest('hex'),
		SHAKE256_VECTORS[1].hex
	);
	assert.deepEqual(electronLike.createHash('sha512'), { algorithm: 'sha512' });
	assert.deepEqual(calls, ['shake256', 'sha512']);
});

test('provideShake256 changes nothing where the runtime already has it', () => {
	const createHash = () => ({});
	const plainNode = { createHash };

	assert.equal(provideShake256(plainNode), false);
	assert.equal(plainNode.createHash, createHash);
});

// The failure itself, end to end: the hash npm's isolated installer computes,
// in a child started the way the shim starts one. Under `npm run test:electron`
// this is red without the preload.
test('a child started the way the shim starts one can hash with shake256', () => {
	const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', [COMPAT_FLAG]: '1' };
	const script = "process.stdout.write(require('node:crypto').createHash('shake256', { outputLength: 16 }).update('abc').digest('hex'))";
	const result = spawnSync(process.execPath, ['--require', COMPAT_PATH, '-e', script], {
		env,
		encoding: 'utf8',
		shell: false,
		windowsHide: true
	});

	assert.equal(result.status, 0, `child failed: ${result.stderr}`);
	assert.equal(result.stdout, SHAKE256_VECTORS[1].hex);
});
