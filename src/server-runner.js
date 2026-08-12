const path = require('path');
const fs = require('fs');
const { hideChildWindows } = require('./hide-child-windows');
const { bindLoopbackOnly } = require('./bind-loopback');
const { formatErrorChain } = require('./error-chain');
const { WP_DEBUG_CONSTANTS } = require('./wp-debug-constants');
const { planPlaygroundLaunch, planServeConstants } = require('./playground-plan.cjs');

// Must run before the Playground CLI is required, so anything it spawns is
// covered too.
hideChildWindows();

// Same reason: the CLI calls `listen` with no address, so the patch has to be in
// place before it is loaded. Without it the dev site is served to the whole LAN.
bindLoopbackOnly();

const { writeFiles: playgroundWriteFiles } = require('@php-wasm/universal');

async function main() {
	// The parent passes a JSON serve config (#251): either the Core docroot to
	// mount as WordPress, or a Gutenberg plugin checkout to mount into a stock
	// WordPress. planPlaygroundLaunch turns the strategy into the runCLI mount /
	// install-mode / blueprint-step options; the SMTP + debug constants are added
	// here because they come from this process's environment.
	const raw = process.argv[2];
	if (!raw) {
		console.error('No serve config provided');
		process.exit(1);
	}
	let serveConfig;
	try {
		serveConfig = JSON.parse(raw);
	} catch (e) {
		console.error(`Invalid serve config: ${String(e && e.message ? e.message : e)}`);
		process.exit(1);
	}

	try {
		const launch = planPlaygroundLaunch(serveConfig);
		const serveConstants = planServeConstants(serveConfig);
		const { runCLI } = require('@wp-playground/cli');
		console.log("Running CLI");
		const result = await runCLI({
			command: 'server',
			// The mount layout and install mode that fit this site's project type.
			// For Core, `mount-before-install` puts the build/ at /wordpress and
			// `wordpressInstallMode: install-from-existing-files-if-needed` skips the
			// download (a fresh unpack over the mount is what made startup take
			// minutes on Windows; `do-not-attempt-installing` would skip SQLite too
			// and leave WordPress with no database driver). For Gutenberg, `mount`
			// puts the checkout under wp-content/plugins and the default install mode
			// downloads a stock WordPress for it to run in.
			...launch,
			verbosity: 'debug',
			blueprint: {
				// Passed as a v1 blueprint (constants + steps). `wordpressInstallMode`
				// above is used rather than the v2-only `mode`; passing both is an
				// error.
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
					'WP_MAIL_SMTP_PASS': process.env.WP_MAIL_SMTP_PASS || '',
					// Last, so a strategy that has to protect the host directory it
					// mounted cannot be overridden by the shared sets above.
					...serveConstants
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


