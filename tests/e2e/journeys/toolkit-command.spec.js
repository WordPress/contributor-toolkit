/**
 * The `toolkit` command (#764): a tool outside the window asking the app that
 * is open what sites it has, and what one of them logged and mailed.
 *
 * The unit suite proves each half: the socket and its refusals, the command's
 * arguments and output, the list main.js answers with. What it cannot see is
 * the whole of it on a real machine: that the app, started the way it starts,
 * listens where the command it wrote looks; that the command runs on
 * Electron's own Node, with no Node of the host's, from a process the app did
 * not start; and that the pipe on Windows and the socket file elsewhere both
 * carry it. So the command is run here the way a terminal runs it, as the file
 * in the profile directory, and only its output is read.
 *
 * What this leaves out: a server that is running, since a journey starts none
 * (dev-server.spec.js says why), so `server` is only ever read as stopped; and
 * a packaged app, where the command names a CLI inside `app.asar` and a signed
 * Helper binary.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { spawnSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

// Runs the command the app wrote, as a shell would. A `.cmd` cannot be
// spawned directly, so on Windows it goes through cmd.exe, which is also what
// a terminal there does with it.
const WINDOWS = process.platform === 'win32';
const shimOf = ( session ) => path.join( session.userDataDir, 'bin', WINDOWS ? 'toolkit.cmd' : 'toolkit' );

function toolkit( session, ...args ) {
	return toolkitIn( undefined, session, ...args );
}

// The same, run in a folder, as a tool working in a checkout runs it.
function toolkitIn( cwd, session, ...args ) {
	const shim = shimOf( session );
	const result = WINDOWS
		? spawnSync( 'cmd.exe', [ '/d', '/s', '/c', `""${ shim }" ${ args.join( ' ' ) }"` ], { cwd, encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true } )
		: spawnSync( shim, args, { cwd, encoding: 'utf8' } );
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test( 'the toolkit command lists the open app\'s sites and reads one\'s log and mail, and says so when the app is closed', async ( { session } ) => {
	const site = await makeSite( session, { label: 'listed-site' } );
	const { page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'listed-site' ) ).toBeVisible( { timeout: 30_000 } );

	// CHARACTERISATION — the command is a file in the profile directory,
	// written once the app is listening, which the window does not wait for.
	await expect.poll( () => fs.existsSync( shimOf( session ) ), { timeout: 15_000 } ).toBe( true );

	// INVARIANT — asked for JSON, the command prints the site the app has,
	// where it is and what is checked out there, and nothing else on stdout.
	const listing = toolkit( session, 'sites', '--json' );
	expect( listing.stderr ).toBe( '' );
	expect( listing.status ).toBe( 0 );
	expect( JSON.parse( listing.stdout ) ).toEqual( {
		ok: true,
		sites: [ {
			path: site.dir,
			label: 'listed-site',
			project: 'core',
			workItem: null,
			branch: 'trunk',
			pullRequest: null,
			initialized: true,
			server: { running: false, url: null },
		} ],
	} );

	// INVARIANT — without the flag the same answer is sentences a person reads.
	const text = toolkit( session, 'sites' );
	expect( text.status ).toBe( 0 );
	expect( text.stdout ).toContain( 'listed-site (WordPress Core)' );
	expect( text.stdout ).toContain( `Path:    ${ site.dir }` );
	expect( text.stdout ).toContain( 'Work:    none (branch trunk)' );
	expect( text.stdout ).toContain( 'Server:  stopped' );

	// INVARIANT — run inside the checkout with no site named, the command is
	// about that site: it prints the end of the debug.log WordPress wrote
	// there. The folder is one the test's own process and the app may know by
	// two names (`/var` and `/private/var` on macOS), which is the case a tool
	// in a real checkout behind a symlink is in.
	const logDir = path.join( site.dir, 'build', 'wp-content' );
	fs.mkdirSync( logDir, { recursive: true } );
	fs.writeFileSync( path.join( logDir, 'debug.log' ), '[13-Nov-2026 09:00:00 UTC] PHP Notice:  first\n[13-Nov-2026 09:00:01 UTC] PHP Warning:  second\n' );
	const log = toolkitIn( path.join( site.dir, 'src' ), session, 'log', '--lines', '1' );
	expect( log.stderr ).toBe( '' );
	expect( log.status ).toBe( 0 );
	expect( log.stdout.trim() ).toBe( '[13-Nov-2026 09:00:01 UTC] PHP Warning:  second' );

	// INVARIANT — run in a folder that is no site's, it is refused, by name.
	const elsewhere = toolkitIn( session.userDataDir, session, 'log', '--json' );
	expect( elsewhere.status ).toBe( 1 );
	expect( JSON.parse( elsewhere.stdout ) ).toMatchObject( { ok: false, code: 'unknown-site' } );

	// INVARIANT — a site that has sent nothing has no mail, and says so.
	const mail = toolkit( session, 'mail', 'listed-site', '--json' );
	expect( mail.status ).toBe( 0 );
	expect( JSON.parse( mail.stdout ) ).toEqual( { ok: true, site: site.dir, total: 0, emails: [] } );

	// INVARIANT — asking changed nothing: the site is still the one on screen.
	await expect( ui.siteHeading( page, 'listed-site' ) ).toBeVisible();

	// INVARIANT — with the app closed the command fails, and says why in words
	// a tool can pass on, with a code it can branch on.
	await session.close();
	const closed = toolkit( session, 'sites', '--json' );
	expect( closed.status ).toBe( 1 );
	expect( JSON.parse( closed.stdout ) ).toMatchObject( { ok: false, code: 'not-running' } );
} );

/**
 * A tool changing a site: the dev server, started and stopped.
 *
 * What only a launch can show is the whole road: the command, the socket,
 * main's gate, the window asked, the row pressing its own button, the page's
 * state read back, and the answer on stdout. And the two things a person
 * does first: find the command, and turn the switch on.
 *
 * Nothing is run, as in dev-server.spec.js, which says what that leaves out:
 * the handlers that start and stop a server, start a script and open a page
 * in the browser are answered by stubs. The stub that starts the server says
 * its address itself, on the channel the real one says it on, and answers at
 * once; the real one answers only once the server is up.
 */
test( 'a tool can start and stop a site\'s server only once the settings allow it, and the window shows what it did', async ( { session } ) => {
	const URL = 'http://127.0.0.1:9400/';
	const site = await makeSite( session, { label: 'served-site' } );
	const { app, page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'served-site' ) ).toBeVisible( { timeout: 30_000 } );
	await expect.poll( () => fs.existsSync( shimOf( session ) ), { timeout: 15_000 } ).toBe( true );
	await app.evaluate( ( { ipcMain }, url ) => {
		const asked = { starts: [], stops: [], opened: [] };
		global.__e2eToolkit = asked;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'playground:start', ( event, dir ) => {
			asked.starts.push( dir );
			event.sender.send( 'playground:url', { sitePath: dir, url } );
			return { ok: true, url };
		} );
		replace( 'playground:stop', ( event, dir ) => {
			asked.stops.push( dir );
			return { ok: true };
		} );
		replace( 'npm:run-script', () => ( { runId: 'e2e-watch' } ) );
		replace( 'npm:kill', () => ( { ok: true } ) );
		replace( 'url:open', ( event, opened ) => {
			asked.opened.push( opened );
			return true;
		} );
	}, URL );
	const asked = () => app.evaluate( () => global.__e2eToolkit );
	const startButton = page.getByRole( 'button', { name: 'Start development server', exact: true } );
	await expect( startButton.first() ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — with the switch as the app ships it, off, a tool is refused
	// and told where the switch is, and no server is asked for.
	const refused = toolkit( session, 'server', 'start', 'served-site', '--json' );
	expect( refused.status ).toBe( 1 );
	expect( JSON.parse( refused.stdout ) ).toMatchObject( { ok: false, code: 'tools-not-allowed' } );
	expect( ( await asked() ).starts ).toEqual( [] );

	// INVARIANT — the settings say where the command is, as a shell takes it,
	// and hold the switch.
	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	await ui.settingsTab( page, 'Tools' ).click();
	await expect( dialog.getByText( `"${ shimOf( session ) }"`, { exact: true } ) ).toBeVisible();
	const allow = dialog.getByRole( 'switch', { name: 'Let tools on this computer change my sites', exact: true } );
	await expect( allow ).not.toBeChecked();
	await allow.click();
	await expect( allow ).toBeChecked();
	await ui.closeDialogButton( dialog ).click();

	// INVARIANT — turned on, the command starts the site's server, once, and
	// answers with its address; and the page says the server is up, as it
	// would had the button been pressed.
	const started = toolkit( session, 'server', 'start', 'served-site', '--json' );
	expect( started.stderr ).toBe( '' );
	expect( JSON.parse( started.stdout ) ).toEqual( { ok: true, site: site.dir, url: URL, started: true } );
	expect( ( await asked() ).starts ).toEqual( [ site.dir ] );
	await expect( page.getByRole( 'link', { name: 'View site', exact: true } ).first() ).toBeVisible();

	// INVARIANT — asked again, it starts nothing and says the address it has.
	const again = toolkit( session, 'server', 'start', 'served-site' );
	expect( again.stdout ).toBe( `The server was already running at ${ URL }\n` );
	expect( ( await asked() ).starts ).toEqual( [ site.dir ] );

	// INVARIANT — stop stops that server, and the page offers the start again.
	const stopped = toolkit( session, 'server', 'stop', 'served-site', '--json' );
	expect( JSON.parse( stopped.stdout ) ).toEqual( { ok: true, site: site.dir, stopped: true } );
	expect( ( await asked() ).stops ).toEqual( [ site.dir ] );
	await expect( startButton.first() ).toBeVisible();
} );
