const path = require('path');
const fs = require('fs');
const { hideChildWindows } = require('./hide-child-windows');

// Must run before the Playground CLI is required, so anything it spawns is
// covered too.
hideChildWindows();

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
			skipWordPressSetup: true,
			verbosity: 'debug',
			blueprint: {
				constants: {
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
		console.error(err && err.stack ? err.stack : String(err));
		process.exit(1);
	}
}

main();


