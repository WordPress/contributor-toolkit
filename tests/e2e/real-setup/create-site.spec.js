const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { finished } = require( 'node:stream/promises' );
const { execFileSync } = require( 'node:child_process' );
const { test, expect } = require( '../helpers/app.cjs' );

// One real setup per contribution target (#251). The steps are the same; what
// differs is the choice in the dialog, what the status reports, and what the
// served WordPress must show: Core serves its own build/, Gutenberg is a plugin
// inside a stock WordPress.
const TARGETS = [
	{ choice: 'WordPress Core', projectType: 'core', servedAsPlugin: false },
	{ choice: 'Gutenberg', projectType: 'gutenberg', servedAsPlugin: true },
];

// Whether any process of the Gutenberg watcher tree (tsc --watch, wp-build
// --watch, the esbuild service) is still alive under the site. POSIX only:
// the tree is killed through the process group there (kill-tree.js), which is
// the mechanism this checks; Windows uses taskkill /T and has no cheap
// equivalent probe from here.
function watcherProcessesAlive( sitePath ) {
	if ( process.platform === 'win32' ) return null;
	try {
		// -l lists the command lines, so a failure names what survived.
		const out = execFileSync( 'pgrep', [ '-fl', sitePath ], { encoding: 'utf8' } );
		return out.trim().split( '\n' ).filter( Boolean );
	} catch {
		// pgrep exits 1 when nothing matches.
		return [];
	}
}

for ( const target of TARGETS ) {
	test( `a new ${ target.projectType } site downloads, installs, builds and serves WordPress`, async ( { session, request }, testInfo ) => {
		test.skip( process.env.TOOLKIT_REAL_SETUP !== '1', 'Set TOOLKIT_REAL_SETUP=1 to allow a real network install.' );
		// The long form of the temp directory. The Windows runner's os.tmpdir() is a
		// short 8.3 path (C:\Users\RUNNER~1\...), which no contributor's site sits
		// under; there, Gutenberg's `tsc --build` in `npm run dev` failed with a type
		// error the one-shot build before it did not hit.
		const parent = session.track( fs.mkdtempSync( path.join( fs.realpathSync.native( os.tmpdir() ), 'wpct-real-setup-' ) ) );
		const sitePath = path.join( parent, 'real-setup' );
		const { app, page } = await session.start();
		const logPath = testInfo.outputPath( 'app.log' );
		fs.mkdirSync( path.dirname( logPath ), { recursive: true } );
		const log = fs.createWriteStream( logPath );
		const proc = app.process();
		const onOutput = ( chunk ) => log.write( chunk );
		proc.stdout.on( 'data', onOutput );
		proc.stderr.on( 'data', onOutput );

		try {
			await test.step( 'Create a site in an isolated temporary directory', async () => {
				await session.answerFileDialog( [ parent ] );
				await page.getByRole( 'button', { name: 'Create a site', exact: true } ).click();
				const modal = page.getByRole( 'dialog', { name: 'Create a site' } );
				const choice = modal.getByRole( 'radio', { name: target.choice, exact: true } );
				await choice.click();
				await expect( choice ).toBeChecked();
				// Filled after the choice, and read back until it is right. In the
				// first seconds of a freshly started app the value Playwright filled
				// came back with letters added or dropped ("real-setupes",
				// "real-setu"), and the site then landed in a folder this test was
				// not watching. Not reproduced by hand or in a warmed-up app, and a
				// review found nothing in the renderer that writes into a focused
				// field; the shapes look like stray keystrokes reaching the focused
				// window, or fill() racing the first status poll's re-render. A
				// refill is what a person would do on seeing it.
				const name = modal.getByLabel( 'Site name', { exact: true } );
				await expect( async () => {
					await name.fill( 'real-setup' );
					await expect( name ).toHaveValue( 'real-setup', { timeout: 2_000 } );
				} ).toPass( { timeout: 30_000 } );
				await modal.getByLabel( 'Site location', { exact: true } ).press( 'Enter' );
				await modal.getByRole( 'button', { name: 'Create site', exact: true } ).click();
			} );

			await test.step( 'Wait for the real clone, npm install and full build', async () => {
				// INVARIANT: the app completes the automatic chain without retry clicks.
				// WordPress mirrors the same success message in its live region.
				await expect( page.getByText( 'This site is ready to work on', { exact: true } ).first() ).toBeVisible( {
					// On the Windows runner `npm install` alone has taken over 40 minutes.
					timeout: 75 * 60_000,
				} );
				const status = await page.evaluate( ( dir ) => window.api.getSiteStatus( dir ), sitePath );
				expect( status.hasNodeModules ).toBe( true );
				expect( status.hasBuilt ).toBe( true );
				expect( status.projectType ).toBe( target.projectType );
				await testInfo.attach( 'site-status.json', {
					body: JSON.stringify( status, null, 2 ), contentType: 'application/json',
				} );
			} );

			await test.step( 'Start the dev server and verify WordPress over HTTP', async () => {
				await page.getByRole( 'button', { name: 'Start dev server and finish the wizard', exact: true } ).click();
				const adminLink = page.getByRole( 'link', { name: 'wp-admin', exact: true } );
				await expect( adminLink ).toBeVisible( { timeout: 3 * 60_000 } );
				const adminUrl = new URL( await adminLink.getAttribute( 'href' ) );
				// INVARIANT: probe only the local server this app just started.
				expect( adminUrl.protocol ).toBe( 'http:' );
				expect( [ '127.0.0.1', 'localhost' ] ).toContain( adminUrl.hostname );
				await expect( async () => {
					const response = await request.get( new URL( '/wp-login.php', adminUrl ).href, { timeout: 15_000 } );
					expect( response.status() ).toBe( 200 );
					const html = await response.text();
					// INVARIANT: PHP serves the WordPress login form, not just an open port.
					expect( html ).toContain( 'id="loginform"' );
					expect( html ).toContain( 'name="log"' );
				} ).toPass( { timeout: 60_000, intervals: [ 2_000, 5_000 ] } );
				if ( target.servedAsPlugin ) {
					// INVARIANT: the served WordPress runs the checkout as its active
					// Gutenberg plugin, and cannot delete it. Read off the Plugins
					// screen after logging in with the credentials every site uses;
					// the request context keeps the cookies.
					const login = await request.post( new URL( '/wp-login.php', adminUrl ).href, {
						form: { log: 'admin', pwd: 'password', 'wp-submit': 'Log In', testcookie: '1', redirect_to: new URL( '/wp-admin/plugins.php', adminUrl ).href },
						timeout: 15_000,
					} );
					expect( login.status() ).toBe( 200 );
					const plugins = await login.text();
					const row = /data-slug="gutenberg"[\s\S]*?<\/tr>/.exec( plugins );
					expect( row, 'the Plugins screen lists the mounted checkout' ).not.toBeNull();
					expect( row[ 0 ] ).toContain( 'Deactivate' );
					expect( plugins ).not.toMatch( />Delete</ );
				}
				if ( target.servedAsPlugin ) {
					// INVARIANT: a built Gutenberg site serves at once, without the
					// watch (#499): `npm run dev` would remove build/ and rebuild it
					// first, for nothing. The button still offers the watch and its
					// tab never went "building". Core's watch starts with the server.
					await expect( page.getByRole( 'button', { name: 'Start build watch', exact: true } ) ).toBeVisible();
					await expect( page.getByRole( 'tab', { name: 'Build watcher', exact: true } ) ).toBeVisible();
					// Start it by hand so the stop below, and the process-tree check
					// after it, still exercise the watch. `npm run dev` removes build/
					// and redoes the whole build before it watches: as long as the
					// wizard's own build, which has taken from 9 to over 13 minutes on
					// the macOS runner.
					await page.getByRole( 'button', { name: 'Start build watch', exact: true } ).click();
					await expect( page.getByRole( 'tab', { name: 'Build watcher (watching)', exact: true } ) ).toBeVisible( { timeout: 30 * 60_000 } );
				}
				await page.getByRole( 'button', { name: 'Stop build watch', exact: true } ).click();
				await page.getByRole( 'button', { name: 'Stop dev server', exact: true } ).click();
				await expect( page.getByRole( 'button', { name: 'Start dev server', exact: true } ) ).toBeVisible( { timeout: 60_000 } );
			} );

			await test.step( 'Stopping the watch ends its whole process tree', async () => {
				// INVARIANT: no watcher process survives Stop. Gutenberg's `npm run
				// dev` is a tree (tsc, wp-build, an esbuild service) that outlives a
				// signal to npm alone; kill-tree.js signals the group.
				if ( watcherProcessesAlive( sitePath ) === null ) return;
				await expect( async () => {
					const survivors = watcherProcessesAlive( sitePath );
					expect( survivors, `processes still naming the site after Stop:\n${ survivors.join( '\n' ) }` ).toEqual( [] );
				} ).toPass( { timeout: 30_000, intervals: [ 1_000 ] } );
			} );
		} finally {
			// The session fixture captures failure evidence, quits (killing child
			// processes) and removes only its own profile and tracked temp directory.
			proc.stdout.off( 'data', onOutput );
			proc.stderr.off( 'data', onOutput );
			log.end();
			await finished( log );
			await testInfo.attach( 'app.log', { path: logPath, contentType: 'text/plain' } );
		}
	} );
}
