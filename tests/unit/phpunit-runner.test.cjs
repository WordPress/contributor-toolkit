'use strict';

// What phpunit-runner.js does on disk and in which order it calls the CLI:
// Composer only when there is no PHPUnit, and only once its checksum holds;
// the SQLite plugin only when it is missing; nothing of SQLite's left in the
// checkout; the install before the tests; and the first failing step's code
// as its own.
//
// runner-wiring.test.cjs covers the load order with a runCLI that never
// settles. Here runCLI settles, doing on disk what each real call would
// (Composer makes vendor/, the unzip makes the plugin), so the runner goes all
// the way to its exit. Nothing boots PHP and nothing reaches the network:
// `fetch` is replaced, and the pinned checksum is swapped for the hash of a
// stand-in Composer, since nothing here can be the real one.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const plan = require('../../src/phpunit-plan.cjs');

const SRC_DIR = path.join(__dirname, '..', '..', 'src');
const RUNNER = path.join(SRC_DIR, 'phpunit-runner.js');

const SAMPLE = "<?php\ndefine( 'ABSPATH', dirname( __FILE__ ) . '/src/' );\ndefine( 'WP_PHP_BINARY', 'php' );\n";
const DB_COPY = "<?php\nactivate_plugin( '{SQLITE_PLUGIN}' );\n";
const COMPOSER_BYTES = 'a stand-in for composer.phar';
const COMPOSER_SHA = crypto.createHash('sha256').update(COMPOSER_BYTES).digest('hex');
// The plan the runner is given: the real one, with the stand-in's checksum.
const PLAN = { ...plan, COMPOSER: { version: plan.COMPOSER.version, url: plan.COMPOSER.url, fileName: plan.COMPOSER.fileName, sha256: COMPOSER_SHA } };

function clearSrcCache() {
	for (const filename of Object.keys(require.cache)) {
		if (filename.startsWith(SRC_DIR + path.sep)) delete require.cache[filename];
	}
}

// A checkout with only the file the runner reads, and a toolkit directory
// with Composer cached unless a test says otherwise. `siteDir` is the site's
// own folder in it, named the way the runner names it.
function makeFixture({ composer = COMPOSER_BYTES, vendor = false, plugin = false } = {}) {
	const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'phpunit-runner-')));
	const site = path.join(root, 'site with space');
	const toolkitDir = path.join(root, 'php-tests');
	const siteDir = path.join(toolkitDir, crypto.createHash('sha256').update(site).digest('hex').slice(0, 16));
	fs.mkdirSync(path.join(site, 'src', 'wp-content', 'plugins'), { recursive: true });
	fs.mkdirSync(toolkitDir, { recursive: true });
	fs.writeFileSync(path.join(site, 'wp-tests-config-sample.php'), SAMPLE);
	if (composer !== null) fs.writeFileSync(path.join(toolkitDir, plan.COMPOSER.fileName), composer);
	const fixture = { root, site, toolkitDir, siteDir };
	if (vendor) makeVendor(fixture);
	if (plugin) makePlugin(fixture);
	return fixture;
}

function makeVendor({ site }) {
	fs.mkdirSync(path.join(site, 'vendor', 'bin'), { recursive: true });
	fs.writeFileSync(path.join(site, 'vendor', 'bin', 'phpunit'), '');
	fs.writeFileSync(path.join(site, 'vendor', 'autoload.php'), '');
}

function makePlugin({ siteDir }) {
	const dir = path.join(siteDir, plan.SQLITE_PLUGIN_SLUG);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(path.join(dir, 'db.copy'), DB_COPY);
}

// Which step a CLI call is, from the script it runs.
function stepOf(options) {
	const script = options._[1];
	if (script === plan.COMPOSER_VFS) return 'composer';
	if (script.endsWith('/unzip.php')) return 'unzip';
	if (script.endsWith('/install.php')) return 'install';
	if (script.endsWith('/run-phpunit.php')) return 'phpunit';
	return script;
}

function mountsOf(options) {
	return options['mount-before-install'].map((mount) => mount.vfsPath);
}

// Runs the runner to its exit. `codes` gives a step's exit code (0 when not
// named); a step that succeeds leaves on disk what the real one would.
async function runRunner(fixture, { args = [], codes = {}, fetchBody = null } = {}) {
	const calls = [];
	let fetches = 0;
	let resolveExit;
	const exited = new Promise((resolve) => { resolveExit = resolve; });
	const cliStub = {
		runCLI: async (options) => {
			const step = stepOf(options);
			calls.push({ step, options });
			const code = codes[step] || 0;
			if (code === 0 && step === 'composer') makeVendor(fixture);
			if (code === 0 && step === 'unzip') makePlugin(fixture);
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
		fetches += 1;
		if (fetchBody === null) throw new Error('this test must not download');
		return { ok: true, status: 200, arrayBuffer: async () => Buffer.from(fetchBody) };
	};
	// What the runner prints, kept rather than shown.
	const record = (...parts) => { output.push(parts.join(' ')); };
	const quiet = [test.mock.method(console, 'error', record), test.mock.method(console, 'log', record)];
	Module._load = function (request) {
		if (request === '@wp-playground/cli') return cliStub;
		if (request === './phpunit-plan.cjs') return PLAN;
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
	return { code, fetches, steps: calls.map((call) => call.step), calls, output: output.join('\n') };
}

test('a first run installs PHPUnit, unpacks SQLite, installs the test site and runs the tests, in that order', async (t) => {
	const fixture = makeFixture();
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { code, steps, calls } = await runRunner(fixture, { args: ['--group', '12821'] });
	assert.equal(code, 0);
	assert.deepEqual(steps, ['composer', 'unzip', 'install', 'phpunit']);
	assert.deepEqual(calls[3].options._.slice(2), ['-c', 'phpunit.xml.dist', '--group', '12821']);
	// The drop-in, the config and the database are the site's folder's.
	assert.ok(fs.existsSync(path.join(fixture.siteDir, 'db.php')));
	assert.match(fs.readFileSync(path.join(fixture.siteDir, 'wp-tests-config.php'), 'utf8'), /'ABSPATH', '\/site\/src\/'/);
	assert.ok(fs.existsSync(path.join(fixture.siteDir, 'database')));
	assert.equal(fs.existsSync(path.join(fixture.siteDir, 'sqlite.zip')), false, 'the copy of the archive is removed once unpacked');
});

test('nothing of SQLite\'s is written into the checkout: the drop-in and the plugin are mounted over it for the install and the tests', async (t) => {
	const fixture = makeFixture();
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { calls } = await runRunner(fixture);
	const overlay = ['/site/src/wp-content/db.php', '/site/src/wp-content/plugins/sqlite-database-integration'];
	for (const call of calls) {
		const mounted = mountsOf(call.options);
		const expected = call.step === 'install' || call.step === 'phpunit';
		for (const vfsPath of overlay) assert.equal(mounted.includes(vfsPath), expected, `${call.step}: ${vfsPath}`);
	}
	assert.equal(fs.existsSync(path.join(fixture.site, 'src', 'wp-content', 'db.php')), false);
	assert.equal(fs.existsSync(path.join(fixture.site, 'src', 'wp-content', 'plugins', plan.SQLITE_PLUGIN_SLUG)), false);
	assert.equal(fs.existsSync(path.join(fixture.site, 'wp-tests-config.php')), false);
});

test('PHP is shown this site\'s toolkit folder only, and Composer only while Composer runs', async (t) => {
	const fixture = makeFixture();
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { calls } = await runRunner(fixture);
	for (const call of calls) {
		const hosts = call.options['mount-before-install'].map((mount) => mount.hostPath);
		assert.equal(hosts.includes(fixture.toolkitDir), false, `${call.step} mounts the shared toolkit directory`);
		assert.ok(hosts.includes(fixture.siteDir), `${call.step} does not mount the site's folder`);
		assert.equal(mountsOf(call.options).includes(plan.COMPOSER_VFS), call.step === 'composer', call.step);
	}
});

test('a later run goes straight to the install and the tests', async (t) => {
	const fixture = makeFixture({ vendor: true, plugin: true });
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	const { code, steps } = await runRunner(fixture);
	assert.equal(code, 0);
	assert.deepEqual(steps, ['install', 'phpunit']);
});

test('the empty mount points a run leaves are removed, and a db.php or plugin of the contributor\'s own is not', async (t) => {
	const emptyLeft = makeFixture({ vendor: true, plugin: true });
	t.after(() => fs.rmSync(emptyLeft.root, { recursive: true, force: true }));
	const wpContent = path.join(emptyLeft.site, 'src', 'wp-content');
	fs.writeFileSync(path.join(wpContent, 'db.php'), '');
	fs.mkdirSync(path.join(wpContent, 'plugins', plan.SQLITE_PLUGIN_SLUG));
	await runRunner(emptyLeft);
	assert.equal(fs.existsSync(path.join(wpContent, 'db.php')), false);
	assert.equal(fs.existsSync(path.join(wpContent, 'plugins', plan.SQLITE_PLUGIN_SLUG)), false);

	const theirs = makeFixture({ vendor: true, plugin: true });
	t.after(() => fs.rmSync(theirs.root, { recursive: true, force: true }));
	const theirContent = path.join(theirs.site, 'src', 'wp-content');
	fs.writeFileSync(path.join(theirContent, 'db.php'), '<?php // theirs');
	fs.mkdirSync(path.join(theirContent, 'plugins', plan.SQLITE_PLUGIN_SLUG));
	fs.writeFileSync(path.join(theirContent, 'plugins', plan.SQLITE_PLUGIN_SLUG, 'load.php'), '<?php // theirs');
	const { code } = await runRunner(theirs);
	assert.equal(code, 0, 'their own drop-in is hidden for the run, not a reason to refuse it');
	assert.equal(fs.readFileSync(path.join(theirContent, 'db.php'), 'utf8'), '<?php // theirs');
	assert.ok(fs.existsSync(path.join(theirContent, 'plugins', plan.SQLITE_PLUGIN_SLUG, 'load.php')));
});

test('a checkout with no test config sample fails before anything slow runs', async (t) => {
	const fixture = makeFixture();
	t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
	fs.rmSync(path.join(fixture.site, 'wp-tests-config-sample.php'));
	const { code, steps } = await runRunner(fixture);
	assert.equal(code, 1);
	assert.deepEqual(steps, []);
});

test('Composer is checked before every use: a changed copy is downloaded again, and a bad download runs nothing', async (t) => {
	const tampered = makeFixture({ composer: 'changed since it was downloaded' });
	t.after(() => fs.rmSync(tampered.root, { recursive: true, force: true }));
	const redownload = await runRunner(tampered, { fetchBody: COMPOSER_BYTES });
	assert.equal(redownload.fetches, 1);
	assert.equal(redownload.code, 0);
	assert.equal(fs.readFileSync(path.join(tampered.toolkitDir, plan.COMPOSER.fileName), 'utf8'), COMPOSER_BYTES);
	assert.deepEqual(fs.readdirSync(tampered.toolkitDir).filter((name) => name.endsWith('.partial')), []);

	const bad = makeFixture({ composer: null });
	t.after(() => fs.rmSync(bad.root, { recursive: true, force: true }));
	const refused = await runRunner(bad, { fetchBody: 'not composer' });
	assert.equal(refused.code, 1);
	assert.deepEqual(refused.steps, []);
	assert.match(refused.output, /checksum/);
	assert.deepEqual(fs.readdirSync(bad.toolkitDir).filter((name) => name.includes('composer')), []);
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
