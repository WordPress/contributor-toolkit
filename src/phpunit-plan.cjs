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

// Where the two host directories appear inside PHP.
const SITE_VFS = '/site';
const TOOLKIT_VFS = '/toolkit';

// The CLI's own PHP binary, which a spawned `php` resolves to.
const PHP_BINARY_VFS = '/internal/shared/bin/php';

// The test database, in a directory core's .gitignore already covers and
// Grunt never copies into build/.
const DB_DIR_REL = 'src/wp-content/database';
const DB_FILE = 'phpunit.sqlite';

// What the drop-in and the plugin are called inside src/wp-content. Both are
// ignored by core's .gitignore, so neither reaches a contributor's patch.
const SQLITE_PLUGIN_SLUG = 'sqlite-database-integration';
const SQLITE_ZIP_ROOT = 'plugin-sqlite-database-integration';

// The first line after `<?php` in a db.php this app wrote. A db.php without it
// belongs to someone else and is never replaced.
const DROP_IN_MARKER = '// Written by WordPress Contributor Toolkit for the PHP unit tests.';

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
			`// The SQLite database the drop-in in src/wp-content/db.php uses in place of MySQL.\n` +
			`define( 'DB_DIR', '${SITE_VFS}/${DB_DIR_REL}/' );\n` +
			`define( 'DB_FILE', '${DB_FILE}' );`,
		'WP_PHP_BINARY'
	);
	return text;
}

// The db.php drop-in, from the plugin's own db.copy. The implementation path
// is left as its placeholder on purpose: db.copy then finds the plugin beside
// it in wp-content/plugins, so no path from this machine is written into it.
function dropIn(dbCopy) {
	const text = String(dbCopy);
	if (!text.startsWith('<?php')) throw new Error('db.copy does not start with <?php');
	return `<?php\n${DROP_IN_MARKER}\n${text.slice('<?php'.length).replace(/\{SQLITE_PLUGIN\}/g, `${SQLITE_PLUGIN_SLUG}/load.php`)}`;
}

// Unzips the SQLite plugin with PHP's ZipArchive: nothing in the app's
// production dependencies unzips in Node.
function unzipScript({ zipPath, pluginsDir }) {
	return `<?php
$zip = new ZipArchive();
if ( true !== $zip->open( ${JSON.stringify(zipPath)} ) ) { fwrite( STDERR, "Could not open the SQLite plugin archive.\\n" ); exit( 1 ); }
if ( ! is_dir( ${JSON.stringify(pluginsDir)} ) ) { mkdir( ${JSON.stringify(pluginsDir)}, 0777, true ); }
$ok = $zip->extractTo( ${JSON.stringify(pluginsDir)} );
$zip->close();
if ( ! $ok || ! rename( ${JSON.stringify(`${pluginsDir}/${SQLITE_ZIP_ROOT}`)}, ${JSON.stringify(`${pluginsDir}/${SQLITE_PLUGIN_SLUG}`)} ) ) { fwrite( STDERR, "Could not unpack the SQLite plugin.\\n" ); exit( 1 ); }
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

// The runCLI options for one PHP call: the checkout and the toolkit's own
// directory mounted before install, WordPress neither installed nor given
// SQLite by the CLI (the drop-in does that), and the site URL the tests expect.
function runOptions({ sitePath, toolkitDir, phpVersion, args }) {
	return {
		command: 'php',
		_: ['php', ...args],
		'mount-before-install': [
			{ hostPath: sitePath, vfsPath: SITE_VFS },
			{ hostPath: toolkitDir, vfsPath: TOOLKIT_VFS }
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
	DB_DIR_REL,
	DB_FILE,
	SQLITE_PLUGIN_SLUG,
	DROP_IN_MARKER,
	phpunitCommandArgs,
	ticketArgs,
	phpunitArgs,
	testsConfig,
	dropIn,
	unzipScript,
	phpunitWrapper,
	runOptions
};
