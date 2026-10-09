'use strict';

// The decisions behind a PHPUnit run on Playground's PHP: what the terminal
// accepts, the arguments PHPUnit gets, the files written for the run, and the
// options every CLI call shares. Each of the last three is one of the
// workarounds phpunit-plan.cjs explains; a change that drops one makes the
// suite fail on the bundled PHP in a way no unit test of the runner would see.

const test = require('node:test');
const assert = require('node:assert/strict');

const plan = require('../../src/phpunit-plan.cjs');

// The lines of wordpress-develop's wp-tests-config-sample.php that the
// rewrite touches, as core has them, with a neighbour on each side.
const SAMPLE = `<?php

/* Path to the WordPress codebase you'd like to test. Add a forward slash in the end. */
define( 'ABSPATH', dirname( __FILE__ ) . '/src/' );

$table_prefix = 'wptests_';   // Only numbers, letters, and underscores please!

define( 'WP_TESTS_DOMAIN', 'example.org' );
define( 'WP_TESTS_EMAIL', 'admin@example.org' );
define( 'WP_TESTS_TITLE', 'Test Blog' );

define( 'WP_PHP_BINARY', 'php' );

define( 'WPLANG', '' );
`;

test('phpunitCommandArgs takes the words after phpunit, and nothing else as a phpunit command', () => {
	assert.deepEqual(plan.phpunitCommandArgs('phpunit --group 12345'), ['--group', '12345']);
	assert.deepEqual(plan.phpunitCommandArgs('  phpunit   --filter   Tests_Foo  '), ['--filter', 'Tests_Foo']);
	assert.deepEqual(plan.phpunitCommandArgs('phpunit'), []);
	assert.equal(plan.phpunitCommandArgs('phpunitx --group 1'), null);
	assert.equal(plan.phpunitCommandArgs('npm run test'), null);
	assert.equal(plan.phpunitCommandArgs(''), null);
});

test('ticketArgs runs the tests tagged with the ticket, which PHPUnit groups by number', () => {
	assert.deepEqual(plan.ticketArgs(12821), ['--group', '12821']);
});

test('phpunitArgs reads core\'s configuration unless the contributor names one', () => {
	assert.deepEqual(plan.phpunitArgs(['--group', '1']), ['-c', 'phpunit.xml.dist', '--group', '1']);
	assert.deepEqual(plan.phpunitArgs(['-c', 'tests/phpunit/multisite.xml']), ['-c', 'tests/phpunit/multisite.xml']);
	assert.deepEqual(plan.phpunitArgs(['--configuration=tests/phpunit/multisite.xml']), ['--configuration=tests/phpunit/multisite.xml']);
});

test('testsConfig points the sample at the mounted checkout, the bundled PHP and the SQLite database', () => {
	const config = plan.testsConfig(SAMPLE);
	// The mounted src/: the config is written outside the checkout, so the
	// sample's dirname( __FILE__ ) would point at the wrong place.
	assert.match(config, /define\( 'ABSPATH', '\/site\/src\/' \);/);
	assert.doesNotMatch(config, /dirname\( __FILE__ \)/);
	assert.match(config, /define\( 'WP_PHP_BINARY', '\/internal\/shared\/bin\/php' \);/);
	// The database is outside the checkout, in the site's toolkit folder.
	assert.match(config, /define\( 'DB_DIR', '\/toolkit\/database\/' \);/);
	assert.match(config, /define\( 'DB_FILE', 'phpunit\.sqlite' \);/);
	// Everything else is the sample's own.
	assert.match(config, /define\( 'WP_TESTS_TITLE', 'Test Blog' \);/);
});

test('testsConfig refuses a sample it cannot rewrite rather than writing one that points elsewhere', () => {
	assert.throws(() => plan.testsConfig("<?php\ndefine( 'WP_PHP_BINARY', 'php' );\n"), /ABSPATH/);
	assert.throws(() => plan.testsConfig("<?php\ndefine( 'ABSPATH', dirname( __FILE__ ) . '/src/' );\n"), /WP_PHP_BINARY/);
});

test('dropIn names the plugin and leaves the path to db.copy\'s fallback, which finds it where it is mounted', () => {
	const dbCopy = "<?php\n$path = '{SQLITE_IMPLEMENTATION_FOLDER_PATH}';\nactivate_plugin( '{SQLITE_PLUGIN}' );\n";
	const dropIn = plan.dropIn(dbCopy);
	assert.ok(dropIn.startsWith('<?php\n'));
	assert.match(dropIn, /activate_plugin\( 'sqlite-database-integration\/load\.php' \);/);
	assert.match(dropIn, /\{SQLITE_IMPLEMENTATION_FOLDER_PATH\}/);
	assert.throws(() => plan.dropIn('not php'), /<\?php/);
});

test('phpunitWrapper skips the install the runner already did and clears Playground\'s error handler first', () => {
	const wrapper = plan.phpunitWrapper({ configPath: '/toolkit/abc/wp-tests-config.php' });
	assert.match(wrapper, /define\( 'WP_TESTS_CONFIG_FILE_PATH', "\/toolkit\/abc\/wp-tests-config\.php" \);/);
	assert.match(wrapper, /putenv\( 'WP_TESTS_SKIP_INSTALL=1' \);/);
	assert.ok(wrapper.indexOf('set_error_handler( null )') < wrapper.indexOf("require '/site/vendor/bin/phpunit'"));
});

test('runOptions mounts before install, installs nothing, and serves the domain the tests expect', () => {
	const options = plan.runOptions({ sitePath: '/sites/core', siteDir: '/data/php-tests/abc', phpVersion: '8.2', args: ['/site/x.php', '--a'] });
	assert.equal(options.command, 'php');
	assert.deepEqual(options._, ['php', '/site/x.php', '--a']);
	// A spawned PHP sees only before-install mounts while WordPress is never booted.
	assert.deepEqual(options['mount-before-install'], [
		{ hostPath: '/sites/core', vfsPath: '/site' },
		{ hostPath: '/data/php-tests/abc', vfsPath: '/toolkit' }
	]);
	assert.equal(options.mount, undefined);
	assert.equal(options.wordpressInstallMode, 'do-not-attempt-installing');
	assert.equal(options.skipSqliteSetup, true);
	assert.equal(options['site-url'], 'http://example.org');
	assert.equal(options.php, '8.2');
	assert.equal('php' in plan.runOptions({ sitePath: '/s', siteDir: '/t', args: [] }), false);
});

test('runOptions mounts Composer, and the SQLite drop-in and plugin over src/wp-content, only when asked', () => {
	const composer = plan.runOptions({ sitePath: '/s', siteDir: '/t', composerPath: '/data/composer.phar', args: [] });
	assert.deepEqual(composer['mount-before-install'][2], { hostPath: '/data/composer.phar', vfsPath: '/composer.phar' });
	const sqlite = plan.runOptions({ sitePath: '/s', siteDir: '/t', sqlite: true, args: [] });
	assert.deepEqual(sqlite['mount-before-install'].slice(2), [
		{ hostPath: '/t/db.php', vfsPath: '/site/src/wp-content/db.php' },
		{ hostPath: '/t/sqlite-database-integration', vfsPath: '/site/src/wp-content/plugins/sqlite-database-integration' }
	]);
});

test('COMPOSER names one exact version and its checksum', () => {
	assert.match(plan.COMPOSER.version, /^\d+\.\d+\.\d+$/);
	assert.match(plan.COMPOSER.sha256, /^[0-9a-f]{64}$/);
	assert.equal(plan.COMPOSER.url, `https://getcomposer.org/download/${plan.COMPOSER.version}/composer.phar`);
});
