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

async function download(url, sha256, dest) {
	const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
	if (!response.ok) throw new Error(`Downloading ${url} failed: HTTP ${response.status}`);
	const body = Buffer.from(await response.arrayBuffer());
	const actual = crypto.createHash('sha256').update(body).digest('hex');
	if (actual !== sha256) throw new Error(`${url} did not match its expected checksum (got ${actual})`);
	const partial = `${dest}.partial`;
	fs.writeFileSync(partial, body);
	fs.renameSync(partial, dest);
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

	try {
		const sitePath = path.resolve(config.site);
		const toolkitDir = path.resolve(config.toolkitDir);
		const args = Array.isArray(config.args) ? config.args : [];
		// Each site's config and wrapper live in a folder of their own, so two
		// sites never read each other's.
		const siteKey = crypto.createHash('sha256').update(sitePath).digest('hex').slice(0, 16);
		const siteDir = path.join(toolkitDir, siteKey);
		const siteVfs = `${plan.TOOLKIT_VFS}/${siteKey}`;
		fs.mkdirSync(siteDir, { recursive: true });

		const { runCLI } = require('@wp-playground/cli');
		const php = (phpArgs) => runCLI(plan.runOptions({ sitePath, toolkitDir, phpVersion: config.phpVersion, args: phpArgs }));
		const stop = (code, line) => {
			console.error(`[PHP tests] ${line}`);
			process.exit(code || 1);
		};

		// 1. Composer, once for every site.
		const composerPath = path.join(toolkitDir, plan.COMPOSER.fileName);
		if (!fs.existsSync(composerPath)) {
			say(`Downloading Composer ${plan.COMPOSER.version}…`);
			await download(plan.COMPOSER.url, plan.COMPOSER.sha256, composerPath);
		}

		// 2. PHPUnit, once per checkout. An existing vendor/ (from core's
		// Docker setup, say) is used as it is. The autoloader is the last thing
		// Composer writes, so an install stopped part-way is installed again.
		const hasPhpUnit = () => fs.existsSync(path.join(sitePath, 'vendor', 'bin', 'phpunit')) && fs.existsSync(path.join(sitePath, 'vendor', 'autoload.php'));
		if (!hasPhpUnit()) {
			say('Installing PHPUnit with Composer. The first time takes a few minutes…');
			const code = await php([
				`${plan.TOOLKIT_VFS}/${plan.COMPOSER.fileName}`,
				'install',
				`--working-dir=${plan.SITE_VFS}`,
				'--no-interaction',
				'--no-progress',
				// Core's Composer plugins (the PHP_CodeSniffer installer) and
				// scripts spawn a PHP of their own, which deadlocks on the file
				// lock it shares with this one; the tests need neither.
				'--no-plugins',
				'--no-scripts'
			]);
			if (code !== 0 || !hasPhpUnit()) {
				stop(code, `Composer could not install PHPUnit (exit code ${code}).`);
				return;
			}
		}

		// 3. The SQLite plugin and its drop-in, in place of MySQL.
		const wpContent = path.join(sitePath, 'src', 'wp-content');
		const pluginDir = path.join(wpContent, 'plugins', plan.SQLITE_PLUGIN_SLUG);
		const dropInPath = path.join(wpContent, 'db.php');
		if (fs.existsSync(dropInPath) && !fs.readFileSync(dropInPath, 'utf8').includes(plan.DROP_IN_MARKER)) {
			stop(1, 'src/wp-content/db.php already exists and was not written by this app, so the tests cannot use SQLite. Move it aside and run again.');
			return;
		}
		if (!fs.existsSync(path.join(pluginDir, 'db.copy'))) {
			say('Adding the SQLite database integration…');
			const cliDir = path.dirname(require.resolve('@wp-playground/cli'));
			fs.writeFileSync(path.join(siteDir, 'sqlite.zip'), fs.readFileSync(path.join(cliDir, 'sqlite-database-integration.zip')));
			fs.writeFileSync(path.join(siteDir, 'unzip.php'), plan.unzipScript({
				zipPath: `${siteVfs}/sqlite.zip`,
				pluginsDir: `${plan.SITE_VFS}/src/wp-content/plugins`
			}));
			const code = await php([`${siteVfs}/unzip.php`]);
			if (code !== 0) {
				stop(code, `The SQLite plugin could not be unpacked (exit code ${code}).`);
				return;
			}
		}
		fs.writeFileSync(dropInPath, plan.dropIn(fs.readFileSync(path.join(pluginDir, 'db.copy'), 'utf8')));
		fs.mkdirSync(path.join(sitePath, ...plan.DB_DIR_REL.split('/')), { recursive: true });

		// 4. The test config and the wrapper, outside the checkout.
		const configVfs = `${siteVfs}/wp-tests-config.php`;
		fs.writeFileSync(path.join(siteDir, 'wp-tests-config.php'), plan.testsConfig(fs.readFileSync(path.join(sitePath, 'wp-tests-config-sample.php'), 'utf8')));
		fs.writeFileSync(path.join(siteDir, 'run-phpunit.php'), plan.phpunitWrapper({ configPath: configVfs }));

		// 5. A fresh test site, as core's bootstrap would install it.
		say('Installing the test site…');
		const multisite = args.some((arg) => arg.endsWith('multisite.xml'));
		const installCode = await php([
			`${plan.SITE_VFS}/tests/phpunit/includes/install.php`,
			configVfs,
			multisite ? 'run_ms_tests' : 'no_ms_tests',
			'run_core_tests'
		]);
		if (installCode !== 0) {
			stop(installCode, `The test site could not be installed (exit code ${installCode}).`);
			return;
		}

		// 6. The tests.
		const code = await php([`${siteVfs}/run-phpunit.php`, ...plan.phpunitArgs(args)]);
		process.exit(typeof code === 'number' ? code : 1);
	} catch (err) {
		console.error(formatErrorChain(err));
		process.exit(1);
	}
}

main();
