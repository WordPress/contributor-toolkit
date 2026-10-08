const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { hideChildWindows } = require('./hide-child-windows');
const { bindLoopbackOnly } = require('./bind-loopback');
const { formatErrorChain } = require('./error-chain');
const plan = require('./phpunit-plan.cjs');

// Must run before the Playground CLI is required, so anything it spawns is
// covered too.
hideChildWindows();

// The `php` command still binds a port for its request handler; keep it off
// the LAN the same way the dev server is.
bindLoopbackOnly();

// The steps this prints are for the terminal the run was started from, the
// way npm's own output is, so they are not translated.
function say(line) {
	console.log(`[PHP tests] ${line}`);
}

function sha256(buffer) {
	return crypto.createHash('sha256').update(buffer).digest('hex');
}

// Composer, checked against its pinned hash every time it is about to run,
// not only when it is downloaded: the cache outlives the run, and the next run
// trusts whatever is there.
async function ensureComposer(dest) {
	if (fs.existsSync(dest)) {
		if (sha256(fs.readFileSync(dest)) === plan.COMPOSER.sha256) return;
		say('The cached Composer does not match its checksum; downloading it again…');
		fs.rmSync(dest, { force: true });
	}
	say(`Downloading Composer ${plan.COMPOSER.version}…`);
	const response = await fetch(plan.COMPOSER.url, { signal: AbortSignal.timeout(120000) });
	if (!response.ok) throw new Error(`Downloading ${plan.COMPOSER.url} failed: HTTP ${response.status}`);
	const body = Buffer.from(await response.arrayBuffer());
	const actual = sha256(body);
	if (actual !== plan.COMPOSER.sha256) throw new Error(`${plan.COMPOSER.url} did not match its expected checksum (got ${actual})`);
	// A name of this process's own, so two first runs at once never write the
	// same file. Whichever renames second finds the other's finished copy.
	const partial = `${dest}.${process.pid}.partial`;
	fs.writeFileSync(partial, body);
	try {
		fs.renameSync(partial, dest);
	} catch (err) {
		fs.rmSync(partial, { force: true });
		if (!fs.existsSync(dest) || sha256(fs.readFileSync(dest)) !== plan.COMPOSER.sha256) throw err;
	}
}

// What a mount leaves in the checkout where it was made: an empty db.php and
// an empty plugin folder. Removed only while empty, so a db.php or a plugin
// of the contributor's own is never touched.
function removeMountPoints(sitePath) {
	const dropIn = path.join(sitePath, ...plan.DROP_IN_REL.split('/'));
	const plugin = path.join(sitePath, ...plan.PLUGIN_REL.split('/'));
	try {
		if (fs.statSync(dropIn).size === 0) fs.rmSync(dropIn);
	} catch {}
	try {
		if (fs.readdirSync(plugin).length === 0) fs.rmdirSync(plugin);
	} catch {}
}

// The run, step by step. Returns the exit code; the caller tidies up and exits.
async function run({ sitePath, toolkitDir, phpVersion, args }) {
	// Each site's files live in a folder of their own, and that folder is all
	// of the toolkit directory its PHP is shown.
	const siteKey = crypto.createHash('sha256').update(sitePath).digest('hex').slice(0, 16);
	const siteDir = path.join(toolkitDir, siteKey);
	fs.mkdirSync(path.join(siteDir, 'database'), { recursive: true });

	const { runCLI } = require('@wp-playground/cli');
	const php = (phpArgs, mounts = {}) => runCLI(plan.runOptions({ sitePath, siteDir, phpVersion, args: phpArgs, ...mounts }));
	const fail = (code, line) => {
		console.error(`[PHP tests] ${line}`);
		return code || 1;
	};

	// Checked before anything slow, so a checkout without it fails at once.
	const samplePath = path.join(sitePath, 'wp-tests-config-sample.php');
	if (!fs.existsSync(samplePath)) return fail(1, 'This checkout has no wp-tests-config-sample.php, so the tests cannot be configured.');

	// 1. PHPUnit, once per checkout, with Composer. An existing vendor/ (from
	// core's Docker setup, say) is used as it is. The autoloader is the last
	// thing Composer writes, so an install stopped part-way is installed again.
	const hasPhpUnit = () => fs.existsSync(path.join(sitePath, 'vendor', 'bin', 'phpunit')) && fs.existsSync(path.join(sitePath, 'vendor', 'autoload.php'));
	if (!hasPhpUnit()) {
		const composerPath = path.join(toolkitDir, plan.COMPOSER.fileName);
		await ensureComposer(composerPath);
		say('Installing PHPUnit with Composer. The first time takes a few minutes…');
		const code = await php([
			plan.COMPOSER_VFS,
			'install',
			`--working-dir=${plan.SITE_VFS}`,
			'--no-interaction',
			'--no-progress',
			// Core's Composer plugins (the PHP_CodeSniffer installer) and
			// scripts spawn a PHP of their own, which deadlocks on the file
			// lock it shares with this one; the tests need neither.
			'--no-plugins',
			'--no-scripts'
		], { composerPath });
		if (code !== 0 || !hasPhpUnit()) return fail(code, `Composer could not install PHPUnit (exit code ${code}).`);
	}

	// 2. The SQLite plugin, once per site, from the archive the CLI ships.
	const pluginDir = path.join(siteDir, plan.SQLITE_PLUGIN_SLUG);
	if (!fs.existsSync(path.join(pluginDir, 'db.copy'))) {
		say('Adding the SQLite database integration…');
		const cliDir = path.dirname(require.resolve('@wp-playground/cli'));
		const zip = path.join(siteDir, 'sqlite.zip');
		fs.writeFileSync(zip, fs.readFileSync(path.join(cliDir, 'sqlite-database-integration.zip')));
		fs.writeFileSync(path.join(siteDir, 'unzip.php'), plan.unzipScript({ zipPath: `${plan.TOOLKIT_VFS}/sqlite.zip` }));
		const code = await php([`${plan.TOOLKIT_VFS}/unzip.php`]);
		fs.rmSync(zip, { force: true });
		if (code !== 0) return fail(code, `The SQLite plugin could not be unpacked (exit code ${code}).`);
	}

	// 3. The drop-in, the test config and the wrapper, all in the site's folder.
	const configVfs = `${plan.TOOLKIT_VFS}/wp-tests-config.php`;
	fs.writeFileSync(path.join(siteDir, 'db.php'), plan.dropIn(fs.readFileSync(path.join(pluginDir, 'db.copy'), 'utf8')));
	fs.writeFileSync(path.join(siteDir, 'wp-tests-config.php'), plan.testsConfig(fs.readFileSync(samplePath, 'utf8')));
	fs.writeFileSync(path.join(siteDir, 'run-phpunit.php'), plan.phpunitWrapper({ configPath: configVfs }));

	// 4. A fresh test site, as core's bootstrap would install it.
	say('Installing the test site…');
	const multisite = args.some((arg) => arg.endsWith('multisite.xml'));
	const installCode = await php([
		`${plan.SITE_VFS}/tests/phpunit/includes/install.php`,
		configVfs,
		multisite ? 'run_ms_tests' : 'no_ms_tests',
		'run_core_tests'
	], { sqlite: true });
	if (installCode !== 0) return fail(installCode, `The test site could not be installed (exit code ${installCode}).`);

	// 5. The tests.
	const code = await php([`${plan.TOOLKIT_VFS}/run-phpunit.php`, ...plan.phpunitArgs(args)], { sqlite: true });
	return typeof code === 'number' ? code : 1;
}

async function main() {
	const raw = process.argv[2];
	// The `return`s after each exit are for the test harness, which replaces
	// process.exit with a recorder.
	if (!raw) {
		console.error('No PHP test config provided');
		process.exit(1);
		return;
	}
	let config;
	try {
		config = JSON.parse(raw);
	} catch (e) {
		console.error(`Invalid PHP test config: ${String(e && e.message ? e.message : e)}`);
		process.exit(1);
		return;
	}

	const sitePath = path.resolve(config.site);
	// A run that was stopped part-way left its mount points behind.
	removeMountPoints(sitePath);
	let code;
	try {
		code = await run({
			sitePath,
			toolkitDir: path.resolve(config.toolkitDir),
			phpVersion: config.phpVersion,
			args: Array.isArray(config.args) ? config.args : []
		});
	} catch (err) {
		console.error(formatErrorChain(err));
		code = 1;
	}
	removeMountPoints(sitePath);
	process.exit(code);
}

main();
