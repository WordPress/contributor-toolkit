'use strict';

// Plans a run of wordpress-develop's PHPUnit tests in Playground's WASM PHP,
// with no Docker and no MySQL.
//
// Kept pure, no fs and no `@wp-playground/cli`, so the decisions can be unit
// tested without booting PHP. phpunit-runner.js does the I/O and calls the CLI.
//
// Core's own path (`npm run env:start`, `env:install`, `test:php`) needs
// Docker. This one runs the same suite on the PHP the dev server uses, against
// SQLite through the drop-in Playground ships. Four things differ from a run on
// a host PHP, each found by running the suite and watching it fail:
//
//  - php-wasm's system()/exec() report exit code 1 whatever the child did, and
//    a spawned child PHP deadlocks on the file lock it shares with its parent.
//    Core's bootstrap installs the test site through system() and stops on a
//    non-zero code, so the install runs as its own CLI call and PHPUnit runs
//    with WP_TESTS_SKIP_INSTALL=1.
//  - Every mount is a before-install mount: with WordPress never booted, those
//    are the only ones a spawned PHP sees.
//  - The site URL is example.org. The CLI defines WP_HOME and WP_SITEURL from
//    it, and the tests expect core's WP_TESTS_DOMAIN.
//  - Playground's preload installs an error handler, and PHPUnit 9 does not
//    install its own over one, so the wrapper clears it first.

// One exact Composer, checked before it runs. Bumping it is these two lines:
// the hash is https://getcomposer.org/download/<version>/composer.phar.sha256sum.
const COMPOSER = {
	version: '2.10.3',
	sha256: '7a2d379d5b8ffdaa028580ef26494c36d2feef4b178d3dd1473a4dbc5e17c8d6',
	get url() { return `https://getcomposer.org/download/${this.version}/composer.phar`; },
	get fileName() { return `composer-${this.version}.phar`; }
};

// Where the checkout and this site's own toolkit folder appear inside PHP.
// The toolkit folder is one site's, never the shared one above it, so the
// code under test can reach no other site's files and not the Composer the
// next run starts.
const SITE_VFS = '/site';
const TOOLKIT_VFS = '/toolkit';
// Composer, mounted for the one call that runs it.
const COMPOSER_VFS = '/composer.phar';

// The CLI's own PHP binary, which a spawned `php` resolves to.
const PHP_BINARY_VFS = '/internal/shared/bin/php';

// The test database, in the site's toolkit folder: nothing of the run's
// database is written into the checkout.
const DB_FILE = 'phpunit.sqlite';

// The SQLite drop-in and its plugin live in the site's toolkit folder too, and
// are mounted over src/wp-content only inside PHP, for the install and the
// tests. Written into the checkout they would stay there, and core's Docker
// environment, which serves src/, would quietly run on SQLite from then on.
// The host's own db.php, if it has one, is hidden for the run and left as it
// is. The mount does leave an empty file and an empty folder where it was
// made; the runner removes those, and an empty db.php would do nothing anyway
// (WordPress falls back to MySQL when the drop-in defines no $wpdb).
const SQLITE_PLUGIN_SLUG = 'sqlite-database-integration';
const SQLITE_ZIP_ROOT = 'plugin-sqlite-database-integration';
const DROP_IN_REL = 'src/wp-content/db.php';
const PLUGIN_REL = `src/wp-content/plugins/${SQLITE_PLUGIN_SLUG}`;

// The arguments after `phpunit` in a terminal line, or null when the line is
// not a phpunit command. Split on whitespace: quoting is not supported.
function phpunitCommandArgs(line) {
	const trimmed = String(line || '').trim();
	const match = /^phpunit(?:\s+(.*))?$/i.exec(trimmed);
	if (!match) return null;
	return (match[1] || '').split(/\s+/).filter(Boolean);
}

// The run a linked ticket's button starts: every test tagged `@ticket <id>`,
// which PHPUnit treats as a group.
function ticketArgs(ticketId) {
	return ['--group', String(ticketId)];
}

// PHPUnit's arguments, reading core's own configuration unless the
// contributor named one.
function phpunitArgs(args) {
	const list = Array.isArray(args) ? args : [];
	const namesConfig = list.some((arg) => arg === '-c' || arg === '--configuration' || arg.startsWith('--configuration='));
	return namesConfig ? list : ['-c', 'phpunit.xml.dist', ...list];
}

function replaceOnce(text, pattern, replacement, what) {
	if (!pattern.test(text)) throw new Error(`wp-tests-config-sample.php has no ${what} line to rewrite`);
	return text.replace(pattern, replacement);
}

// The test configuration, rewritten from the checkout's own
// wp-tests-config-sample.php so it follows whatever core changes there. It is
// written outside the checkout and loaded through WP_TESTS_CONFIG_FILE_PATH,
// so a wp-tests-config.php a contributor already has (a Docker one, pointing at
// MySQL) is never touched. Throws when the sample no longer has a line this
// rewrites, rather than writing a config that silently points somewhere else.
function testsConfig(sample) {
	let text = String(sample);
	text = replaceOnce(text, /define\(\s*'ABSPATH',[^;]*;/, `define( 'ABSPATH', '${SITE_VFS}/src/' );`, 'ABSPATH');
	text = replaceOnce(
		text,
		/define\(\s*'WP_PHP_BINARY',[^;]*;/,
		`define( 'WP_PHP_BINARY', '${PHP_BINARY_VFS}' );\n\n` +
			`// The SQLite database the drop-in uses in place of MySQL, outside the checkout.\n` +
			`define( 'DB_DIR', '${TOOLKIT_VFS}/database/' );\n` +
			`define( 'DB_FILE', '${DB_FILE}' );`,
		'WP_PHP_BINARY'
	);
	return text;
}

// The db.php drop-in, from the plugin's own db.copy. The implementation path
// is left as its placeholder on purpose: db.copy then finds the plugin beside
// it in wp-content/plugins, where it is mounted.
function dropIn(dbCopy) {
	const text = String(dbCopy);
	if (!text.startsWith('<?php')) throw new Error('db.copy does not start with <?php');
	return text.replace(/\{SQLITE_PLUGIN\}/g, `${SQLITE_PLUGIN_SLUG}/load.php`);
}

// Unzips the SQLite plugin into the site's toolkit folder with PHP's
// ZipArchive: nothing in the app's production dependencies unzips in Node.
function unzipScript({ zipPath }) {
	const into = TOOLKIT_VFS;
	return `<?php
$zip = new ZipArchive();
if ( true !== $zip->open( ${JSON.stringify(zipPath)} ) ) { fwrite( STDERR, "Could not open the SQLite plugin archive.\\n" ); exit( 1 ); }
$ok = $zip->extractTo( ${JSON.stringify(into)} );
$zip->close();
if ( ! $ok || ! rename( ${JSON.stringify(`${into}/${SQLITE_ZIP_ROOT}`)}, ${JSON.stringify(`${into}/${SQLITE_PLUGIN_SLUG}`)} ) ) { fwrite( STDERR, "Could not unpack the SQLite plugin.\\n" ); exit( 1 ); }
`;
}

// The script PHPUnit runs through. The install has already run as its own
// call, so the bootstrap is told to skip it.
function phpunitWrapper({ configPath }) {
	return `<?php
// Playground's preload installs an error handler; PHPUnit 9 will not install its own over one.
set_error_handler( null );
define( 'WP_TESTS_CONFIG_FILE_PATH', ${JSON.stringify(configPath)} );
putenv( 'WP_TESTS_SKIP_INSTALL=1' );
$_SERVER['argv'] = $argv = array_merge( array( '${SITE_VFS}/vendor/bin/phpunit' ), array_slice( $argv, 1 ) );
$_SERVER['argc'] = $argc = count( $argv );
chdir( '${SITE_VFS}' );
require '${SITE_VFS}/vendor/bin/phpunit';
`;
}

// The runCLI options for one PHP call: the checkout and the site's toolkit
// folder mounted before install, WordPress neither installed nor given SQLite
// by the CLI (the drop-in does that), and the site URL the tests expect.
// `composerPath` mounts Composer, for the call that runs it; `sqlite` mounts
// the drop-in and the plugin over src/wp-content, for the install and the
// tests. Paths joined with '/', which Node accepts on Windows as well.
function runOptions({ sitePath, siteDir, composerPath = null, sqlite = false, phpVersion, args }) {
	return {
		command: 'php',
		_: ['php', ...args],
		'mount-before-install': [
			{ hostPath: sitePath, vfsPath: SITE_VFS },
			{ hostPath: siteDir, vfsPath: TOOLKIT_VFS },
			...(composerPath ? [{ hostPath: composerPath, vfsPath: COMPOSER_VFS }] : []),
			...(sqlite ? [
				{ hostPath: `${siteDir}/db.php`, vfsPath: `${SITE_VFS}/${DROP_IN_REL}` },
				{ hostPath: `${siteDir}/${SQLITE_PLUGIN_SLUG}`, vfsPath: `${SITE_VFS}/${PLUGIN_REL}` }
			] : [])
		],
		wordpressInstallMode: 'do-not-attempt-installing',
		skipSqliteSetup: true,
		'site-url': 'http://example.org',
		...(phpVersion ? { php: phpVersion } : {}),
		verbosity: 'quiet'
	};
}

module.exports = {
	COMPOSER,
	SITE_VFS,
	TOOLKIT_VFS,
	COMPOSER_VFS,
	DB_FILE,
	SQLITE_PLUGIN_SLUG,
	DROP_IN_REL,
	PLUGIN_REL,
	phpunitCommandArgs,
	ticketArgs,
	phpunitArgs,
	testsConfig,
	dropIn,
	unzipScript,
	phpunitWrapper,
	runOptions
};
