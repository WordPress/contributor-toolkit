'use strict';

// What phpunit-runner.js does on disk and in which order it calls the CLI:
// Composer only when there is no PHPUnit, the SQLite plugin only when it is
// missing, never over a db.php someone else wrote, the install before the
// tests, and the first failing step's code as its own.
//
// runner-wiring.test.cjs covers the load order with a runCLI that never
// settles. Here runCLI settles, doing on disk what each real call would
// (Composer makes vendor/, the unzip makes the plugin), so the runner goes all
// the way to its exit. Nothing boots PHP and nothing reaches the network:
// `fetch` is replaced for the one test that downloads.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plan = require('../../src/phpunit-plan.cjs');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');
const RUNNER = path.join(SRC_DIR, 'phpunit-runner.js');

const SAMPLE = "<?php\ndefine( 'ABSPATH', dirname( __FILE__ ) . '/src/' );\ndefine( 'WP_PHP_BINARY', 'php' );\n";
const DB_COPY = "<?php\nactivate_plugin( '{SQLITE_PLUGIN}' );\n";

function clearSrcCache() {
	for (const filename of Object.keys(require.cache)) {
		if (filename.startsWith(SRC_DIR + path.sep)) delete require.cache[filename];
	}
}

// A checkout with only the file the runner reads, and an empty toolkit
// directory with Composer already cached unless a test says otherwise.
function makeFixture({ composer = true, vendor = false, plugin = false, dbPhp = null } = {}) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phpunit-runner-'));
	const site = path.join(root, 'site with space');
	const toolkitDir = path.join(root, 'php-tests');
	fs.mkdirSync(path.join(site, 'src', 'wp-content', 'plugins'), { recursive: true });
	fs.mkdirSync(toolkitDir, { recursive: true });
	fs.writeFileSync(path.join(site, 'wp-tests-config-sample.php'), SAMPLE);
	if (composer) fs.writeFileSync(path.join(toolkitDir, plan.COMPOSER.fileName), '');
	if (vendor) makeVendor(site);
	if (plugin) makePlugin(site);
	if (dbPhp !== null) fs.writeFileSync(path.join(site, 'src', 'wp-content', 'db.php'), dbPhp);
	return { root, site, toolkitDir };
}

function makeVendor(site) {
	fs.mkdirSync(path.join(site, 'vendor', 'bin'), { recursive: true });
	fs.writeFileSync(path.join(site, 'vendor', 'bin', 'phpunit'), '');
	fs.writeFileSync(path.join(site, 'vendor', 'autoload.php'), '');
}

function makePlugin(site) {
	const dir = path.join(site, 'src', 'wp-content', 'plugins', plan.SQLITE_PLUGIN_SLUG);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'db.copy'), DB_COPY);
}

// Which step a CLI call is, from the script it runs.
function stepOf(options) {
	const script = options._[1];
	if (script.endsWith('.phar')) return 'composer';
	if (script.endsWith('/unzip.php')) return 'unzip';
	if (script.endsWith('/install.php')) return 'install';
	if (script.endsWith('/run-phpunit.php')) return 'phpunit';
	return script;
}

// Runs the runner to its exit. `codes` gives a step's exit code (0 when not
// named); a step that succeeds leaves on disk what the real one would.
async function runRunner(fixture, { args = [], codes = {}, fetchBody = null } = {}) {
	const calls = [];
	let resolveExit;
	const exited = new Promise((resolve) => { resolveExit = resolve; });
	const cliStub = {
		runCLI: async (options) => {
			const step = stepOf(options);
			calls.push({ step, options });
			const code = codes[step] || 0;
			if (code === 0 && step === 'composer') makeVendor(fixture.site);
			if (code === 0 && step === 'unzip') makePlugin(fixture.site);
			return code;
		}
	};
	const originalLoad = Module._load;
	const originalArgv = process.argv;
	const originalExit = process.exit;
	const originalFetch = global.fetch;
	const output = [];
	process.argv = [process.execPath, RUNNER, JSON.stringify({ site: fixture.site, toolkitDir: fixture.toolkitDir, phpVersion: '8.3', args })];
	process.exit = (code) => { resolveExit(code); };
	global.fetch = async () => {
		if (fetchBody === null) throw new Error('this test must not download');
		return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(fetchBody) };
	};
	// What the runner prints, kept rather than shown.
	const record = (...parts) => { output.push(parts.join(' ')); };
	const quiet = [test.mock.method(console, 'error', record), test.mock.method(console, 'log', record)];
	Module._load = function (request) {
		if (request === '@wp-playground/cli') return cliStub;
		if (request === './hide-child-windows') return { hideChildWindows: () => {} };
		if (request === './bind-loopback') return { bindLoopbackOnly: () => {} };
		return originalLoad.apply(this, arguments);
	};
	clearSrcCache();
	let code;
	try {
		require(RUNNER);
		code = await exited;
	} finally {
		Module._load = originalLoad;
		process.argv = originalArgv;
		process.exit = originalExit;
		global.fetch = originalFetch;
		for (const method of quiet) method.mock.restore();
		clearSrcCache();
	}
	return { code, steps: calls.map((call) => call.step), calls, output: output.join('\n') };
}

test('a first run installs PHPUnit, adds SQLite, installs the test site and runs the tests, in that order', async (t) => {
	const fixture = makeFixture();
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { code, steps, calls } = await runRunner(fixture, { args: ['--group', '12821'] });
	assert.equal(code, 0);
	assert.deepEqual(steps, ['composer', 'unzip', 'install', 'phpunit']);
	assert.deepEqual(calls[3].options._.slice(2), ['-c', 'phpunit.xml.dist', '--group', '12821']);
	// The drop-in is the app's, the config sits outside the checkout, and the
	// checkout's own wp-tests-config.php is never written.
	assert.ok(fs.readFileSync(path.join(fixture.site, 'src', 'wp-content', 'db.php'), 'utf8').includes(plan.DROP_IN_MARKER));
	assert.equal(fs.existsSync(path.join(fixture.site, 'wp-tests-config.php')), false);
	const [siteKey] = fs.readdirSync(fixture.toolkitDir).filter((name) => !name.endsWith('.phar'));
	assert.match(fs.readFileSync(path.join(fixture.toolkitDir, siteKey, 'wp-tests-config.php'), 'utf8'), /'ABSPATH', '\/site\/src\/'/);
	assert.ok(fs.existsSync(path.join(fixture.site, 'src', 'wp-content', 'database')));
});

test('a later run goes straight to the install and the tests', async (t) => {
	const fixture = makeFixture({ vendor: true, plugin: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { code, steps } = await runRunner(fixture);
	assert.equal(code, 0);
	assert.deepEqual(steps, ['install', 'phpunit']);
});

test('an install stopped before Composer wrote its autoloader is installed again', async (t) => {
	const fixture = makeFixture({ plugin: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	fs.mkdirSync(path.join(fixture.site, 'vendor', 'bin'), { recursive: true });
	fs.writeFileSync(path.join(fixture.site, 'vendor', 'bin', 'phpunit'), '');
	const { steps } = await runRunner(fixture);
	assert.deepEqual(steps, ['composer', 'install', 'phpunit']);
});

test('Composer runs without its plugins and scripts, which would spawn a PHP that deadlocks', async (t) => {
	const fixture = makeFixture({ plugin: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { calls } = await runRunner(fixture);
	assert.ok(calls[0].options._.includes('--no-plugins'));
	assert.ok(calls[0].options._.includes('--no-scripts'));
});

test('a db.php someone else wrote stops the run before anything is unpacked or installed', async (t) => {
	const fixture = makeFixture({ vendor: true, dbPhp: '<?php // theirs' });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { code, steps, output } = await runRunner(fixture);
	assert.equal(code, 1);
	assert.deepEqual(steps, []);
	assert.match(output, /db\.php already exists/);
	assert.equal(fs.readFileSync(path.join(fixture.site, 'src', 'wp-content', 'db.php'), 'utf8'), '<?php // theirs');
});

test('a Composer download that does not match its checksum runs nothing and caches nothing', async (t) => {
	const fixture = makeFixture({ composer: false });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { code, steps, output } = await runRunner(fixture, { fetchBody: 'not composer' });
	assert.equal(code, 1);
	assert.deepEqual(steps, []);
	assert.match(output, /checksum/);
	assert.deepEqual(fs.readdirSync(fixture.toolkitDir).filter((name) => name.includes('composer')), []);
});

test('the first step that fails ends the run with its code', async (t) => {
	const fixture = makeFixture({ vendor: true, plugin: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const install = await runRunner(fixture, { codes: { install: 3 } });
	assert.equal(install.code, 3);
	assert.deepEqual(install.steps, ['install']);
	const tests = await runRunner(fixture, { codes: { phpunit: 2 } });
	assert.equal(tests.code, 2);
	assert.deepEqual(tests.steps, ['install', 'phpunit']);
});

test('a multisite configuration installs a multisite test site', async (t) => {
	const fixture = makeFixture({ vendor: true, plugin: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { calls } = await runRunner(fixture, { args: ['-c', 'tests/phpunit/multisite.xml'] });
	assert.equal(calls[0].options._[3], 'run_ms_tests');
	assert.deepEqual(calls[1].options._.slice(2), ['-c', 'tests/phpunit/multisite.xml']);
});
