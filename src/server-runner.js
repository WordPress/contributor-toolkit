const path = require('path');
const fs = require('fs');
const { hideChildWindows } = require('./hide-child-windows');
const { bindLoopbackOnly } = require('./bind-loopback');
const { formatErrorChain } = require('./error-chain');
const { WP_DEBUG_CONSTANTS } = require('./wp-debug-constants');

// Must run before the Playground CLI is required, so anything it spawns is
// covered too.
hideChildWindows();

// Same reason: the CLI calls `listen` with no address, so the patch has to be in
// place before it is loaded. Without it the dev site is served to the whole LAN.
bindLoopbackOnly();

const { writeFiles: playgroundWriteFiles } = require('@php-wasm/universal');

async function main() {
	const buildDir = process.argv[2];
	if (!buildDir) {
		console.error('No build directory provided');
		process.exit(1);
	}
	const absBuild = path.resolve(buildDir);

	try {
		const { runCLI } = require('@wp-playground/cli');
		console.log("Running CLI");
		const result = await runCLI({
			command: 'server',
			// Mount the build directory before install as /wordpress to use existing build
			'mount-before-install': [ { hostPath: absBuild, vfsPath: '/wordpress' } ],
			// The mounted build/ already is WordPress, so Playground must not go
			// looking for one. Left unset this defaults to `download-and-install`:
			// it fetches a WordPress release and unpacks it over the mount, failing
			// on every file that is already there. That wasted pass is what makes
			// startup take minutes on Windows.
			//
			// Only `download-and-install` downloads, so any other value skips it —
			// but not all of them are safe here. `do-not-attempt-installing` (the
			// mode Playground also calls `mount-only`) additionally skips setting up
			// the SQLite integration plugin, and a wordpress-develop build/ carries
			// no database driver of its own, so WordPress would boot with nothing to
			// connect to. `install-from-existing-files-if-needed` skips the download
			// and still prepares SQLite.
			//
			// Passed as `wordpressInstallMode` rather than the equivalent `mode`
			// option because `mode` is only read on the Blueprint v2 code path, and
			// the blueprint below is v1. Passing both is an error.
			wordpressInstallMode: 'install-from-existing-files-if-needed',
			verbosity: 'debug',
			blueprint: {
				constants: {
					// Debug first, mail second. This is the only point at which
					// constants can be set: Playground generates the wp-config.php
					// itself, and these have to be defined before WordPress loads.
					...WP_DEBUG_CONSTANTS,
					'WP_MAIL_SMTP_HOST': process.env.WP_MAIL_SMTP_HOST || '127.0.0.1',
					'WP_MAIL_SMTP_PORT': Number(process.env.WP_MAIL_SMTP_PORT || 25),
					'WP_MAIL_SMTP_AUTH': String(process.env.WP_MAIL_SMTP_AUTH || 'false') === 'true',
					'WP_MAIL_SMTP_SECURE': process.env.WP_MAIL_SMTP_SECURE || '', // '', 'ssl', or 'tls'
					'WP_MAIL_SMTP_USER': process.env.WP_MAIL_SMTP_USER || '',
					'WP_MAIL_SMTP_PASS': process.env.WP_MAIL_SMTP_PASS || ''
				}
			}
		});

		const muPlugin = `<?php
			function playground_wp_mail_smtp_init( $phpmailer ) {
				$phpmailer->isSMTP();
				$phpmailer->Host       = WP_MAIL_SMTP_HOST;
				$phpmailer->Port       = WP_MAIL_SMTP_PORT;
				$phpmailer->SMTPAuth   = WP_MAIL_SMTP_AUTH;
				$phpmailer->SMTPSecure = WP_MAIL_SMTP_SECURE;
				// Prevent PHPMailer from attempting opportunistic TLS when our SMTP doesn't advertise STARTTLS
				$phpmailer->SMTPAutoTLS = false;

				if ( WP_MAIL_SMTP_AUTH ) {
					$phpmailer->Username = WP_MAIL_SMTP_USER;
					$phpmailer->Password = WP_MAIL_SMTP_PASS;
				}
			}
			add_action( 'phpmailer_init', 'playground_wp_mail_smtp_init', 0);
		`;
		await result.playground.writeFile('/internal/shared/mu-plugins/wp-mail-smtp.php', muPlugin);

		// Use bundled Adminer PHP from src/adminer.php
		try {
			await playgroundWriteFiles(result.playground, '/wordpress', {
				'adminer.php': `<?php

				// PHP defaults session.save_path to /home/web_user, which doesn't exist in
				// the Playground VFS (we mount the build dir and skip WordPress setup), so
				// Adminer's session_start() emits warnings and its later header() calls die.
				// Point sessions at a directory we create ourselves instead.
				$sessionDir = '/tmp/adminer-sessions';
				if (!is_dir($sessionDir)) {
					mkdir($sessionDir, 0777, true);
				}
				ini_set('session.save_path', $sessionDir);

				if ($_SERVER['QUERY_STRING'] === '' || empty($_COOKIE['adminer_permanent'])) {
					$_POST['auth'] = [
						'driver'    => 'sqlite',
						'server'    => '/wordpress/wp-content/database/.ht.sqlite',
						'username'  => '',
						'password'  => '',
						'db'        => '/wordpress/wp-content/database/.ht.sqlite',
						'permanent' => 1,
					];
				}
				
				function adminer_object() {
					class AdminerSoftware extends Adminer\\Adminer {
					
						function name() {
							return 'WordPress';
						}
						
						function permanentLogin($i = false) {
							return '';
						}
						
						function credentials() {
							return array('localhost', 'ODBC', '');
						}
						
						function database() {
							return '/wordpress/wp-content/database/.ht.sqlite';
						}
						
						function login($login, $password) {
							return true;
						}
					
					}
					return new AdminerSoftware;
				}
				require __DIR__ . '/adminer-core.php';
				`,
				'adminer-core.php': fs.readFileSync(path.join(__dirname, 'adminer.php')),//.replaceAll(`login($We,$F){if($F=="")return`, `login($We,$F){`),
			});
		} catch (e) {
			console.error('[Adminer] load failed:', e && e.stack ? e.stack : String(e));
		}
		const address = result.server.address();
		const port = typeof address === 'object' && address ? address.port : 0;
		const url = `http://127.0.0.1:${port}/`;
		console.log(`SERVER_URL:${url}`);

		// Keep process alive until parent kills it
		process.stdin.resume();
	} catch (err) {
		console.error(formatErrorChain(err));
		process.exit(1);
	}
}

main();


