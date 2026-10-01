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
 * not be taken for a crash.
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
 * here the test announces it; a real start that fails is followed by such an
 * exit too, and here it is not, so a failed start's exit arriving while the
 * failure is still being cleared up is not walked; no mail server is started
 * with it; and nothing is written to the app's log. A real build also leaves
 * a `build/` behind, and here the test writes the one file that says a site
 * is built when it needs the site to be.
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
		const asked = { starts: [], stops: [], scripts: [], kills: [], opened: [], startAnswer: { ok: true }, statusAsked: 0, statusAnswered: 0 };
		global.__e2eServer = asked;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		// How the site is, is still answered by the app. The test only counts
		// the question being asked and being answered: pressing the server's
		// button asks it before it asks for a server, and the answer takes as
		// long as reading the checkout takes. The handler is reached through
		// the map Electron keeps them in, which is not part of its interface.
		const siteStatus = ipcMain._invokeHandlers.get( 'site:status' );
		replace( 'site:status', async ( ...args ) => {
			asked.statusAsked += 1;
			try {
				return await siteStatus( ...args );
			} finally {
				asked.statusAnswered += 1;
			}
		} );
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
			const { starts, stops, scripts, kills, opened, statusAsked, statusAnswered } = global.__e2eServer;
			return { starts, stops, scripts, kills, opened, statusAsked, statusAnswered };
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

test( 'the dev server\'s button starts one server however often it is pressed, says when it is up, stops it without touching the watch, and tells a crash from a stop', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const server = await standIn( app, page, site.dir );

	const starting = page.getByRole( 'button', { name: 'Starting dev server...', exact: true } );
	const line = ( text ) => ui.card( page, 'Logs' ).getByText( text, { exact: true } );
	const siteLink = page.getByRole( 'link', { name: URL, exact: true } );

	// The hint under the terminal is a link only once the site's status has
	// been read and says the site is built: the server's button needs to know
	// that too.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the button asks for one server, for this site, and says it
	// is starting, with how long it has been. CHARACTERISATION — on Core the
	// build watch is started with it.
	await ui.startDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).starts ).toEqual( [ site.dir ] );
	await expect.poll( async () => ( await server.asked() ).scripts ).toEqual( [ { name: 'grunt', args: [ '--', '_watch' ] } ] );
	await expect( starting ).toBeVisible();
	await expect( page.getByText( /^Dev server is starting… \(/ ) ).toBeVisible();

	// INVARIANT — pressed again while it starts, it starts nothing more (#488).
	// A press that did start a server would first ask the main process how
	// the site is, which takes as long as reading the checkout takes, and only
	// then ask for the server. So the test waits in three steps before it
	// counts: until anything the press asked has reached the main process,
	// until every question about the site has been answered, and until what
	// the press would do with that answer has been asked for.
	await starting.click();
	await server.heard();
	await expect.poll( async () => {
		const { statusAsked, statusAnswered } = await server.asked();
		return statusAsked === statusAnswered;
	} ).toBe( true );
	await server.heard();
	await server.heard();
	expect( ( await server.asked() ).starts ).toHaveLength( 1 );

	// INVARIANT — once the server has an address the site is opened in the
	// browser, once, the address is shown, and the button offers to stop it.
	await server.serverHasAddress();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible();
	await expect( siteLink ).toBeVisible();
	await expect.poll( async () => ( await server.asked() ).opened ).toEqual( [ URL ] );
	expect( ( await server.asked() ).starts ).toEqual( [ site.dir ] );

	// INVARIANT — stopping asks for this site's server to be stopped, takes
	// the address away, and leaves the build watch running (#247).
	await ui.stopDevServerButton( page ).click();
	await expect.poll( async () => ( await server.asked() ).stops ).toEqual( [ site.dir ] );
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( siteLink ).toHaveCount( 0 );
	await expect( ui.stopBuildWatchButton( page ) ).toBeVisible();

	// INVARIANT — the exit that follows a stop that was asked for is not a
	// crash (#488): nothing says the server stopped unexpectedly, and the
	// watch is not stopped with it.
	await server.serverHasGone( 0 );
	await server.heard();
	await expect( line( 'Dev server stopped unexpectedly (see Help → Open App Log for details).' ) ).toHaveCount( 0 );
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
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

	const starting = page.getByRole( 'button', { name: 'Starting dev server...', exact: true } );
	const line = ( text ) => ui.card( page, 'Logs' ).getByText( text, { exact: true } );

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
	await expect( line( 'build/ is complete: starting the server without the build watch. Start build watch to compile edits on save.' ) ).toBeVisible();
	await expect.poll( async () => ( await server.asked() ).starts ).toHaveLength( 2 );
	await server.heard();
	expect( ( await server.asked() ).scripts ).toHaveLength( 3 );
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible();
} );
