/**
 * The build watch: the process that compiles a contributor's edits as they
 * save them, with a button and a tab of its own (#247, #554).
 *
 * It runs apart from the dev server and apart from the terminal, so what
 * matters is that it keeps to itself. Its button starts and stops it and
 * nothing else; its output goes to its own tab; it does not hold the
 * terminal; and what the tab says it is doing is what it is doing. Two
 * things make that harder than it sounds. A stop returns before the process
 * has gone, so a run started straight after must not be told it has exited
 * when the old one finally does (#488). And a site with no build has to be
 * built once before anything can watch it, by a build that does hold the
 * terminal, and on some projects the watcher then rebuilds everything and is
 * not ready until it says so.
 *
 * Nothing is run. The handlers that start a script and stop one are answered
 * by stubs that keep what they were asked, and the test says what a running
 * script would say, on the channels it says it on, as TESTING.md describes.
 * What that leaves out: a real run writes its output to the app's log as
 * well, and ends by itself with the code the process gave; here a script runs
 * until the test says it has ended, with a code the test chose. A real build
 * also leaves a `build/` behind, and here none appears, so a site that was
 * not built stays not built.
 *
 * Pausing the watch for an operation that needs the build to itself,
 * bringing it back, and handing it a change to compile are not here, and
 * they are in no other journey either. An update and a restored pull request
 * pause it and bring it back; an applied patch does that or hands it the
 * change, depending on what the patch touches; a ticket switch that leaves it
 * running hands it the files that moved. Their journeys all run with no
 * watch running, where pausing and resuming do nothing and nothing is handed
 * over.
 *
 * The watch's button is meant to open the watch's tab, and does not: the tab
 * panel cannot be switched from outside it, so the app changes what it
 * believes is open and the screen stays where it was. That is a bug of its
 * own, and nothing here pins it either way. The test opens the tab itself.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

// The stand-in for the script runner, and what the test uses to speak for it.
async function standInForScripts( app, page ) {
	await app.evaluate( ( { ipcMain } ) => {
		const asked = { scripts: [], kills: [] };
		global.__e2eWatch = asked;
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', ( event, dir, name, args ) => {
			asked.scripts.push( { dir, name, args } );
			return { runId: `e2e-run-${ asked.scripts.length }` };
		} );
		ipcMain.removeHandler( 'npm:kill' );
		ipcMain.handle( 'npm:kill', ( event, params ) => {
			asked.kills.push( params );
			return { ok: true };
		} );
	} );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	return {
		asked: () => app.evaluate( () => global.__e2eWatch ),
		prints: ( run, text ) => tell( 'npm:run-script:log', { runId: `e2e-run-${ run }`, type: 'stdout', data: text } ),
		ends: ( run, code ) => tell( 'npm:run-script:done', { runId: `e2e-run-${ run }`, code } ),
		// Told and heard: the reply to a question asked after the telling
		// arrives after it.
		heard: () => page.evaluate( () => window.api.getSitesWithMeta() ),
	};
}

test( 'the build watch starts and stops by its own button, prints in its own tab, leaves the terminal free, and tells a stop it was asked for from an exit it was not', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );

	const logs = ui.card( page, 'Logs' );
	const tab = ( label ) => ui.logTab( page, label );
	const line = ( text ) => logs.getByText( text, { exact: true } );
	const buildHint = ui.terminalHint( page, 'npm run build' );

	// CHARACTERISATION — nothing is watching until it is asked to.
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await expect( tab( 'Build watcher' ) ).toBeVisible();
	// The hint under the terminal is a link only once the site's status has
	// been read and says the site is built. Waiting for it is what keeps the
	// click below from landing on a site not yet known to be built, where the
	// button would run a build first.
	await expect( buildHint ).toBeVisible();

	// INVARIANT — its button starts the watcher in this site's directory, and
	// its tab says what it is doing and what it ran. CHARACTERISATION — on
	// Core the watcher is grunt's, and it is watching from the moment it
	// starts.
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( async () => ( await scripts.asked() ).scripts ).toEqual( [ { dir: site.dir, name: 'grunt', args: [ '--', '_watch' ] } ] );
	await tab( 'Build watcher (watching)' ).click();
	await expect( line( 'Running npm run grunt -- _watch…' ) ).toBeVisible();
	await expect( ui.stopBuildWatchButton( page ) ).toBeVisible();

	// INVARIANT — what it prints goes to its tab, and it does not hold the
	// terminal: the hints under the terminal are still links.
	await scripts.prints( 1, 'Waiting for changes to the source\n' );
	await expect( line( 'Waiting for changes to the source' ) ).toBeVisible();
	await expect( buildHint ).toBeVisible();

	// INVARIANT — its button stops that run, by the run it was given, and the
	// tab and the button say it has stopped.
	await ui.stopBuildWatchButton( page ).click();
	await expect.poll( async () => ( await scripts.asked() ).kills ).toEqual( [ { runId: 'e2e-run-1', directoryPath: site.dir } ] );
	await expect( tab( 'Build watcher' ) ).toBeVisible();
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible();

	// INVARIANT — a run started straight after is not told it has exited when
	// the stopped one finally goes (#488): the old run's last words are
	// printed, and the tab goes on saying the new one is watching.
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( async () => ( await scripts.asked() ).scripts ).toHaveLength( 2 );
	await expect( tab( 'Build watcher (watching)' ) ).toBeVisible();
	await scripts.ends( 1, 0 );
	await expect( line( 'npm run grunt -- _watch exited with code 0' ) ).toBeVisible();
	await scripts.heard();
	await expect( tab( 'Build watcher (watching)' ) ).toBeVisible();
	await expect( ui.stopBuildWatchButton( page ) ).toBeVisible();

	// INVARIANT — an exit nobody asked for is shown as one, with its code, and
	// the button offers to start it again. Nothing was asked to stop.
	await scripts.ends( 2, 2 );
	await expect( tab( 'Build watcher (exited 2)' ) ).toBeVisible();
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible();
	await scripts.heard();
	expect( ( await scripts.asked() ).kills ).toHaveLength( 1 );
} );

test( 'a site with no build is built before it is watched, by a build that holds the terminal, and is watching only once the watcher says it is ready', async ( { session } ) => {
	// A Gutenberg checkout, which the fixture is not a built one of: its
	// watcher removes build/ and rebuilds it before it watches, and says
	// "Watching for changes" when it has.
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );

	const logs = ui.card( page, 'Logs' );
	const tab = ( label ) => ui.logTab( page, label );
	const line = ( text ) => logs.getByText( text, { exact: true } );
	const terminal = ui.terminalInput( page );
	const typeAndEnter = async ( text ) => {
		await terminal.pressSequentially( text, { delay: 10 } );
		await terminal.press( 'Enter' );
	};

	// INVARIANT — with no build there is nothing to watch, so the button runs
	// the build first, and says so in the watch's tab.
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( async () => ( await scripts.asked() ).scripts ).toEqual( [ { dir: site.dir, name: 'build', args: [] } ] );
	await tab( 'Build watcher (building)' ).click();
	await expect( line( 'No completed build found — running npm run build first…' ) ).toBeVisible();

	// INVARIANT — that build holds the terminal: a command typed while it
	// runs starts nothing.
	await typeAndEnter( 'npm run lint' );
	await scripts.heard();
	expect( ( await scripts.asked() ).scripts ).toHaveLength( 1 );

	// INVARIANT — a build that fails starts no watcher, and says why.
	await scripts.ends( 1, 1 );
	await expect( line( 'npm run build failed with code 1 — build watch not started.' ) ).toBeVisible();
	await expect( tab( 'Build watcher (exited 1)' ) ).toBeVisible();
	await scripts.heard();
	expect( ( await scripts.asked() ).scripts ).toHaveLength( 1 );

	// INVARIANT — a build that ends well is followed by the watcher, with
	// nothing clicked. CHARACTERISATION — on Gutenberg that is npm run dev.
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( async () => ( await scripts.asked() ).scripts ).toHaveLength( 2 );
	await scripts.ends( 2, 0 );
	await expect.poll( async () => ( await scripts.asked() ).scripts ).toHaveLength( 3 );
	expect( ( await scripts.asked() ).scripts[ 2 ] ).toEqual( { dir: site.dir, name: 'dev', args: [] } );

	// INVARIANT — the watcher is not watching until it says it is ready
	// (#488): other output leaves the tab on "building".
	await scripts.prints( 3, 'webpack compiled 12 modules\n' );
	await expect( line( 'webpack compiled 12 modules' ) ).toBeVisible();
	await scripts.heard();
	await expect( tab( 'Build watcher (building)' ) ).toBeVisible();
	await scripts.prints( 3, 'Watching for changes\n' );
	await expect( tab( 'Build watcher (watching)' ) ).toBeVisible();

	// INVARIANT — the watcher does not hold the terminal the build held: a
	// command typed now is run.
	await typeAndEnter( 'npm run lint' );
	await expect.poll( async () => ( await scripts.asked() ).scripts ).toHaveLength( 4 );
	expect( ( await scripts.asked() ).scripts[ 3 ].name ).toBe( 'lint' );
} );
