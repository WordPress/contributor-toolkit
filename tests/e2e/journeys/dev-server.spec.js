/**
 * The dev server's button: starting the site, stopping it, and what the
 * button does when the server goes without being asked (#554).
 *
 * One button stands for a sequence the contributor does not see. The server
 * serves `build/`, so something has to have built it; on Core the build watch
 * starts with the server and stays when the server stops (#247), and on a
 * project whose watcher rebuilds everything first, the server either starts
 * at once on the build it has (#499) or waits for the watcher to say it is
 * ready (#488). Then the server takes its time to boot, can fail to, and can
 * die later. Through all of it the button has to say what is true, a second
 * click must not start a second server, and a stop that was asked for must
 * not be taken for a crash. Since #557 a second click has nothing to land
 * on: while the server starts its button and its menu's item are held.
 *
 * Nothing is run. A journey does not start a server or a script: the
 * handlers that start and stop the server, start and stop a script, and open
 * a page in the browser are answered by stubs that keep what they were asked,
 * and the test says what the main process would say, on the channels it says
 * it on, as TESTING.md describes. What that leaves out: the real start
 * answers only once the server has an address or has failed, and here it
 * answers at once and the address is said afterwards, so the debug.log tail
 * and the mail list are brought up before there is an address and not
 * after; a real server that is stopped exits and that exit is announced, and
 * here the test announces it; no mail server is started with it; and nothing
 * is written to the app's log. A real build also leaves a `build/` behind,
 * and here the test writes the one file that says a site is built when it
 * needs the site to be.
 *
 * A start that fails is the least like the real thing. Here the failure is
 * the answer and nothing else is said. A real server that exits before it has
 * an address announces the exit first and answers that it failed after; one
 * that times out answers first and exits after; one that could not be
 * spawned answers and announces nothing. None of those orders is walked
 * here, so what the button and the Server tab say when an exit and a failure
 * arrive together is not pinned.
 *
 * Since #557 the server has two controls and they say the same: a menu in
 * the page's header, which says what the server is doing and holds the one
 * thing to do about it and, while the server has an address, the way to the
 * site and to its admin; and a section of the site's details, with a button
 * of the same name and, while the server has an address, where the site, its
 * admin and its database are and what to log in with. The first two journeys press the button in the
 * details; the third goes through the header.
 *
 * The mail list and the Logs panel while a server runs are `mail.spec.js`
 * and `logs.spec.js`; the watch by itself is `build-watch.spec.js`.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const URL = 'http://127.0.0.1:9400/';

// The stand-ins, and what the test uses to speak for the server and the
// scripts.
async function standIn( app, page, sitePath ) {
	await app.evaluate( ( { ipcMain } ) => {
		const asked = { starts: [], stops: [], scripts: [], kills: [], opened: [], startAnswer: { ok: true } };
		global.__e2eServer = asked;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'playground:start', ( event, dir ) => {
			asked.starts.push( dir );
			return asked.startAnswer;
		} );
		replace( 'playground:stop', ( event, dir ) => {
			asked.stops.push( dir );
			return { ok: true };
		} );
		replace( 'npm:run-script', ( event, dir, name, args ) => {
			asked.scripts.push( { name, args } );
			return { runId: `e2e-run-${ asked.scripts.length }` };
		} );
		replace( 'npm:kill', ( event, params ) => {
			asked.kills.push( params.runId );
			return { ok: true };
		} );
		replace( 'url:open', ( event, url ) => {
			asked.opened.push( url );
			return true;
		} );
	} );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	return {
		asked: () => app.evaluate( () => {
			const { starts, stops, scripts, kills, opened } = global.__e2eServer;
			return { starts, stops, scripts, kills, opened };
		} ),
		nextStartAnswers: ( answer ) => app.evaluate( ( electron, value ) => {
			global.__e2eServer.startAnswer = value;
		}, answer ),
		serverHasAddress: () => tell( 'playground:url', { sitePath, url: URL } ),
		serverHasGone: ( code ) => tell( 'playground:stopped', { sitePath, code } ),
		scriptPrints: ( run, text ) => tell( 'npm:run-script:log', { runId: `e2e-run-${ run }`, type: 'stdout', data: text } ),
		scriptEnds: ( run, code ) => tell( 'npm:run-script:done', { runId: `e2e-run-${ run }`, code } ),
		// Told and heard: the reply to a question asked after the telling
		// arrives after it.
		heard: () => page.evaluate( () => window.api.getSitesWithMeta() ),
	};
}

test( 'the dev server\'s button starts one server and cannot be pressed while it starts, says when it is up, stops it without touching the watch, and tells a crash from a stop', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// The terminal is in the tray, which is closed when the window opens.
	await ui.openTray( page, 'Terminal' );
	const server = await standIn( app, page, site.dir );

	const starting = page.getByRole( 'button', { name: 'Starting development server…', exact: true } );
	const line = ( text ) => ui.tray( page, 'Logs' ).getByText( text, { exact: true } );
	const siteLink = page.getByRole( 'link', { name: 'View site', exact: true } );

	// The hint under the terminal is a link only once the site's status has
	// been read and says the site is built: the server's button needs to know
	// that too.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	// What the server says is in the logs, which the tray shows in the
	// terminal's place.
	await ui.openTray( page, 'Logs' );

	// INVARIANT — the button asks for one server, for this site, and says it
	// is starting, with how long it has been. CHARACTERISATION — on Core the
	// build watch is started with it.
	await ui.startDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).starts ).toEqual( [ site.dir ] );
	await expect.poll( async () => ( await server.asked() ).scripts ).toEqual( [ { name: 'grunt', args: [ '--', '_watch' ] } ] );
	await expect( starting ).toBeVisible();
	await expect( page.getByText( /^Dev server is starting… \(/ ) ).toBeVisible();
	await expect( ui.processMenuButton( page, 'Server starting…' ) ).toBeVisible();

	// INVARIANT — while it starts there is nothing to press, here or in the
	// header's menu: that is what now keeps a second press from starting a
	// second server (#488). The hook still refuses a second start by itself,
	// and no journey reaches that refusal any more.
	await expect( starting ).toBeDisabled();
	await ui.processMenuButton( page, 'Server starting…' ).click();
	await expect( page.getByRole( 'menuitem', { name: 'Starting development server…', exact: true } ) ).toBeDisabled();
	await page.keyboard.press( 'Escape' );

	// INVARIANT — once the server has an address the site is opened in the
	// browser, once, the address is shown, and the button offers to stop it.
	await server.serverHasAddress();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible();
	await expect( siteLink ).toHaveAttribute( 'href', URL );
	await expect( ui.processMenuButton( page, 'Server running' ) ).toBeVisible();
	await expect.poll( async () => ( await server.asked() ).opened ).toEqual( [ URL ] );
	expect( ( await server.asked() ).starts ).toEqual( [ site.dir ] );

	// INVARIANT — stopping asks for this site's server to be stopped, takes
	// the address away, and leaves the build watch running (#247).
	await ui.stopDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).stops ).toEqual( [ site.dir ] );
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( siteLink ).toHaveCount( 0 );
	await expect( ui.processMenuButton( page, 'Server stopped' ) ).toBeVisible();
	await expect( ui.stopBuildWatchButton( page ) ).toBeVisible();

	// INVARIANT — the exit that follows a stop that was asked for is not a
	// crash (#488): nothing says the server stopped unexpectedly, and the
	// watch is not stopped with it.
	await server.serverHasGone( 0 );
	await server.heard();
	await expect( line( 'Dev server stopped unexpectedly (see Help → Open App Log for details).' ) ).toHaveCount( 0 );
	await expect( ui.processMenuButton( page, 'Build watching' ) ).toBeVisible();
	expect( ( await server.asked() ).kills ).toEqual( [] );

	// INVARIANT — a server that goes without being asked is said to have
	// crashed, the button offers to start it again, and the watch is still
	// left alone.
	await ui.startDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).starts ).toHaveLength( 2 );
	await server.serverHasAddress();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible();
	await server.serverHasGone( 1 );
	await expect( line( 'Dev server stopped unexpectedly (see Help → Open App Log for details).' ) ).toBeVisible();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( ui.stopBuildWatchButton( page ) ).toBeVisible();
	await server.heard();
	expect( ( await server.asked() ).kills ).toEqual( [] );

	// INVARIANT — a server that could not start says why, and the button
	// goes back to offering to start it.
	await server.nextStartAnswers( { ok: false, error: 'port 9400 is taken' } );
	await ui.startDevServerButton( page ).click();
	await expect( line( 'Dev server failed to start: port 9400 is taken' ) ).toBeVisible();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( starting ).toHaveCount( 0 );
} );

test( 'on a project whose watcher rebuilds everything, the server waits for a first build and for the watcher to be ready, gives up if the build fails, and starts at once on a build that is already there', async ( { session } ) => {
	// A Gutenberg checkout, which the fixture is not a built one of.
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );
	const server = await standIn( app, page, site.dir );

	const starting = page.getByRole( 'button', { name: 'Starting development server…', exact: true } );
	const line = ( text ) => ui.tray( page, 'Logs' ).getByText( text, { exact: true } );
	// What the server says is in the logs, in the tray.
	await ui.openTray( page, 'Logs' );

	// INVARIANT — with no build there is nothing to serve, so the button runs
	// the build first and starts no server yet.
	await expect( ui.startDevServerButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).scripts ).toEqual( [ { name: 'build', args: [] } ] );
	await expect( starting ).toBeVisible();
	await server.heard();
	expect( ( await server.asked() ).starts ).toEqual( [] );

	// INVARIANT — a build that fails means no server: it says the start was
	// cancelled, and the button goes back to offering to start it.
	await server.scriptEnds( 1, 1 );
	// The logs have gone to the watch's tab, where the failed build's last
	// lines are (#558); what the server said of it is on its own. The watch's
	// tab says the build has ended before the other is pressed, or the logs
	// would go back to it after.
	await expect( ui.logTab( page, 'Build watch (exited 1)' ) ).toHaveAttribute( 'aria-selected', 'true' );
	await ui.logTab( page, 'Server' ).click();
	await expect( line( 'Dev server start cancelled: the build watch stopped before build/ was complete. Start it again once the watch is running.' ) ).toBeVisible();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await server.heard();
	expect( ( await server.asked() ).starts ).toEqual( [] );

	// INVARIANT — after a build that ends well the watcher starts, and the
	// server still waits: it is not started until the watcher says it is
	// ready (#488).
	await ui.startDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).scripts ).toHaveLength( 2 );
	await server.scriptEnds( 2, 0 );
	await expect.poll( async () => ( await server.asked() ).scripts ).toHaveLength( 3 );
	expect( ( await server.asked() ).scripts[ 2 ] ).toEqual( { name: 'dev', args: [] } );
	await server.scriptPrints( 3, 'webpack compiled 12 modules\n' );
	await server.heard();
	expect( ( await server.asked() ).starts ).toEqual( [] );
	await expect( starting ).toBeVisible();
	await server.scriptPrints( 3, 'Watching for changes\n' );
	await expect.poll( async () => ( await server.asked() ).starts ).toEqual( [ site.dir ] );
	await server.serverHasAddress();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible();

	// Not claims of this journey, but the way to its last one: the server and
	// the watch are both stopped, and the site is made a built one by the
	// file the app looks for being there.
	await ui.stopDevServerButton( page ).click();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await server.serverHasGone( 0 );
	await ui.stopBuildWatchButton( page ).click();
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible();
	const built = path.join( site.dir, 'build', 'scripts', 'block-library', 'index.min.js' );
	fs.mkdirSync( path.dirname( built ), { recursive: true } );
	fs.writeFileSync( built, '' );

	// INVARIANT — on a build that is already there the server starts at
	// once, says why, and does not start the watcher that would remove that
	// build to make it again (#499).
	await ui.startDevServerButton( page ).click();
	// The logs were left on the watch's tab, which the watch's own build
	// selected; what the server says is on the server's.
	await ui.logTab( page, 'Server' ).click();
	await expect( line( 'build/ is complete: starting the server without the build watch. Start build watch to compile edits on save.' ) ).toBeVisible();
	await expect.poll( async () => ( await server.asked() ).starts ).toHaveLength( 2 );
	await server.heard();
	expect( ( await server.asked() ).scripts ).toHaveLength( 3 );
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible();
} );

test( 'the header\'s menu starts and stops the same server, and the server\'s section says where the site is, opens it in the browser and not here, and says what to log in with', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// The terminal is in the tray, which is closed when the window opens.
	await ui.openTray( page, 'Terminal' );
	const server = await standIn( app, page, site.dir );
	const headerMenu = ( label ) => ui.processMenuButton( page, label );
	const link = ( name ) => page.getByRole( 'link', { name, exact: true } );
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — a stopped server says so in both places, and its section
	// has nowhere to send anyone.
	await expect( headerMenu( 'Server stopped' ) ).toBeVisible();
	await expect( page.getByText( 'Development server offline', { exact: true } ) ).toBeVisible();
	await expect( link( 'View site' ) ).toHaveCount( 0 );

	// INVARIANT — the header's menu starts this site's server, once, and with
	// no server there is nothing else in it.
	await headerMenu( 'Server stopped' ).click();
	await expect( page.getByRole( 'menuitem' ) ).toHaveText( [ 'Start development server' ] );
	await page.getByRole( 'menuitem', { name: 'Start development server', exact: true } ).click();
	await expect.poll( async () => ( await server.asked() ).starts ).toEqual( [ site.dir ] );
	await server.serverHasAddress();
	await expect( headerMenu( 'Server running' ) ).toBeVisible();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible();
	await expect( page.getByText( 'Development server offline', { exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — the section says where the site, its admin and its
	// database are.
	await expect( link( 'View site' ) ).toHaveAttribute( 'href', URL );
	await expect( link( 'wp-admin' ) ).toHaveAttribute( 'href', `${ URL }wp-admin/` );
	await expect( link( 'Database' ) ).toHaveAttribute( 'href', `${ URL }adminer.php` );

	// INVARIANT — a link is opened in the browser, by the main process, and
	// the window stays on the app: it is the site that was opened as the
	// server came up, and then the admin, and nothing else. Where the window
	// is, is asked of the main process, after a question the page has
	// answered: a window on its way somewhere else would not answer it.
	const windowAddress = () => app.evaluate( ( { BrowserWindow } ) => BrowserWindow.getAllWindows()[ 0 ].webContents.getURL() );
	const appAddress = await windowAddress();
	await link( 'wp-admin' ).click();
	await expect.poll( async () => ( await server.asked() ).opened ).toEqual( [ URL, `${ URL }wp-admin/` ] );
	await server.heard();
	await expect( ui.siteHeading( page, 'e2e-site' ) ).toBeVisible();
	expect( await windowAddress() ).toBe( appAddress );

	// INVARIANT — the header's menu goes to the site and its admin too, the
	// same way, since the details can be put away. A stopped server's menu
	// offers neither, which is how this journey opened it.
	await headerMenu( 'Server running' ).click();
	await expect( page.getByRole( 'menuitem' ) ).toHaveText( [ 'View site', 'wp-admin', 'Stop development server' ] );
	await page.getByRole( 'menuitem', { name: 'View site', exact: true } ).click();
	await expect.poll( async () => ( await server.asked() ).opened ).toEqual( [ URL, `${ URL }wp-admin/`, URL ] );
	await server.heard();
	expect( await windowAddress() ).toBe( appAddress );

	// INVARIANT — it says what to log in with, and shows the password only
	// when asked to.
	const credentials = page.getByRole( 'complementary' ).filter( { visible: true } );
	await expect( credentials.getByText( 'admin', { exact: true } ) ).toBeVisible();
	await expect( credentials.getByText( 'password', { exact: true } ) ).toHaveCount( 0 );
	await credentials.getByRole( 'button', { name: 'Show password', exact: true } ).click();
	await expect( credentials.getByText( 'password', { exact: true } ) ).toBeVisible();
	await credentials.getByRole( 'button', { name: 'Hide password', exact: true } ).click();
	await expect( credentials.getByText( 'password', { exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — the header's menu stops it, and both places say so.
	await headerMenu( 'Server running' ).click();
	await page.getByRole( 'menuitem', { name: 'Stop development server', exact: true } ).click();
	await expect.poll( async () => ( await server.asked() ).stops ).toEqual( [ site.dir ] );
	await expect( headerMenu( 'Server stopped' ) ).toBeVisible();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( link( 'View site' ) ).toHaveCount( 0 );
	await expect( page.getByText( 'Development server offline', { exact: true } ) ).toBeVisible();
} );
