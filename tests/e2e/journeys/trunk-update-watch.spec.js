/**
 * Updating to the latest trunk while the build watch is running (#262, #507,
 * #554).
 *
 * An update rewrites the whole tree, so a watch that is running has to be out
 * of the way while it does, and has to come back afterwards, whichever way the
 * update ends. Who builds in between depends on the project. On Core the
 * update builds and the watch is brought back when that is over. On a project
 * whose watcher rebuilds everything as it starts, a build by the update would
 * be thrown away the moment the watch came back, so the update brings the
 * watch back at once and waits for it: the update is complete when the watch
 * says it is ready, and incomplete if the watch goes first.
 *
 * `trunk-update.spec.js` is the update with no watch running, where none of
 * this happens. A pull request's checkout pauses a watch and brings it back
 * the same way, and that is `watch-during-changes.spec.js`.
 *
 * The fetch and the reset are real: the origin is a clone on disk, moved
 * ahead by the test. Nothing else is run. The handlers that start an install,
 * start a script and stop one are answered by stubs that keep what they were
 * asked, and the test says what a running script would say, on the channels
 * it says it on, as TESTING.md describes. What that leaves out: a real run
 * writes its output to the app's log as well, and ends by itself with the code
 * the process gave; here a script runs until the test says it has ended. A
 * real install records in the store whether it failed, and a real build
 * leaves a `build/` behind; here neither happens. Recording that an update is
 * complete is still the app's own; the test only counts it being asked for.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, advanceOrigin, read, LOGIN } = require( '../helpers/git-site.cjs' );

// What the fixture's trunk holds before the origin moves on.
const OLD_LOGIN = '<?php // trunk\n';
const NEWER_LOGIN = '<?php // newer trunk\n';
const NEWEST_LOGIN = '<?php // newest trunk\n';

// The stand-in for the runner, and what the test uses to speak for it. When a
// run is stopped it also keeps what `watched`, a file in the checkout, held
// at that moment: that is how a journey sees whether the tree had been
// touched yet.
async function standInForRuns( app, page, watched ) {
	await app.evaluate( ( { ipcMain }, file ) => {
		const asked = { scripts: [], installs: 0, kills: [], treeAtKill: [], completions: 0 };
		global.__e2eUpdate = asked;
		// The same way to Node's modules the packaged smoke test takes.
		const { readFileSync } = process.mainModule.require( 'node:fs' );
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'npm:run-script', ( event, dir, name ) => {
			asked.scripts.push( name );
			return { runId: `e2e-run-${ asked.scripts.length }` };
		} );
		replace( 'npm:install', () => {
			asked.installs += 1;
			return { installId: `e2e-install-${ asked.installs }` };
		} );
		replace( 'npm:kill', ( event, params ) => {
			asked.kills.push( params.runId );
			asked.treeAtKill.push( readFileSync( file, 'utf8' ) );
			return { ok: true };
		} );
		// Recording that the update is complete is still done by the app. The
		// test only counts it being asked for, which is the first thing a
		// completed update does, before it says anything on screen. The
		// handler is reached through the map Electron keeps them in, which is
		// not part of its interface.
		const markComplete = ipcMain._invokeHandlers.get( 'sites:mark-update-complete' );
		replace( 'sites:mark-update-complete', ( ...args ) => {
			asked.completions += 1;
			return markComplete( ...args );
		} );
	}, watched );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	return {
		asked: () => app.evaluate( () => global.__e2eUpdate ),
		scriptPrints: ( run, text ) => tell( 'npm:run-script:log', { runId: `e2e-run-${ run }`, type: 'stdout', data: text } ),
		scriptEnds: ( run, code ) => tell( 'npm:run-script:done', { runId: `e2e-run-${ run }`, code } ),
		installEnds: ( install, code ) => tell( 'npm:install:done', { installId: `e2e-install-${ install }`, code } ),
		// Told and heard: the reply to a question asked after the telling
		// arrives after it.
		heard: () => page.evaluate( () => window.api.getSitesWithMeta() ),
	};
}

async function updateToLatestTrunk( page ) {
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
}

test( 'an update stops a running build watch for as long as it resets and builds, and brings it back whether the build ended well or not', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const { app, page } = await session.start( site.settings );
	const runs = await standInForRuns( app, page, path.join( site.dir, LOGIN ) );
	const incomplete = page.getByText( 'Update incomplete', { exact: true } );

	// The watch is running before the update starts. The hint under the
	// terminal is a link only once the site is known to be built, which is
	// what makes the watch's button start the watcher and not a build.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'grunt' ] );

	// INVARIANT — the update stops that watcher, by its run, before it
	// touches the tree: the file the update is about to replace still held
	// the old trunk when the watcher was stopped. The watch's tab says it is
	// paused.
	await updateToLatestTrunk( page );
	await expect.poll( async () => ( await runs.asked() ).kills ).toEqual( [ 'e2e-run-1' ] );
	expect( ( await runs.asked() ).treeAtKill ).toEqual( [ OLD_LOGIN ] );
	await expect( ui.logTab( page, 'Build watcher (paused)' ) ).toBeVisible();

	// INVARIANT — the tree is reset to the new trunk and the update runs the
	// build itself. CHARACTERISATION — on Core; with the lockfile unchanged
	// there is no install.
	await expect.poll( async () => ( await runs.asked() ).scripts, { timeout: 60_000 } ).toEqual( [ 'grunt', 'build' ] );
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	expect( ( await runs.asked() ).installs ).toBe( 0 );

	// INVARIANT — the watch is not brought back while the build runs.
	await runs.heard();
	await expect( ui.logTab( page, 'Build watcher (paused)' ) ).toBeVisible();
	expect( ( await runs.asked() ).scripts ).toHaveLength( 2 );

	// INVARIANT — a build that fails leaves the update incomplete and says
	// so, and the watch is brought back all the same.
	await runs.scriptEnds( 2, 1 );
	await expect( incomplete ).toBeVisible();
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'grunt', 'build', 'grunt' ] );
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();

	// INVARIANT — retrying stops the watch again, installs, since what
	// changed is no longer known, and then builds.
	await ui.retryInstallButton( page ).click();
	await expect.poll( async () => ( await runs.asked() ).kills ).toEqual( [ 'e2e-run-1', 'e2e-run-3' ] );
	await expect( ui.logTab( page, 'Build watcher (paused)' ) ).toBeVisible();
	await expect.poll( async () => ( await runs.asked() ).installs ).toBe( 1 );
	await runs.heard();
	expect( ( await runs.asked() ).scripts ).toHaveLength( 3 );
	await runs.installEnds( 1, 0 );
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'grunt', 'build', 'grunt', 'build' ] );

	// INVARIANT — a build that ends well completes the update: the app says
	// so, the marker that it was incomplete is gone from the screen and from
	// the store, and the watch is back.
	await runs.scriptEnds( 4, 0 );
	await expect( page.getByText( 'Updated to the latest trunk' ).first() ).toBeVisible();
	await expect( incomplete ).toHaveCount( 0 );
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'grunt', 'build', 'grunt', 'build', 'grunt' ] );
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
	await expect.poll( () => Boolean( session.readSettings().siteMeta[ site.dir ].updateIncomplete ) ).toBe( false );

	// INVARIANT — a watcher the update stopped, going at last, is not taken
	// for the one that is running now.
	await runs.scriptEnds( 1, 143 );
	await runs.heard();
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
} );

test( 'where the watcher rebuilds everything as it starts, the update builds nothing itself: it brings the watch back and is complete when the watch is ready, incomplete if the watch is stopped first', async ( { session } ) => {
	// A built Gutenberg checkout: the file the app looks for is there.
	const site = await makeSite( session, { origin: true } );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const built = path.join( site.dir, 'build', 'scripts', 'block-library', 'index.min.js' );
	fs.mkdirSync( path.dirname( built ), { recursive: true } );
	fs.writeFileSync( built, '' );
	advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const { app, page } = await session.start( site.settings );
	const runs = await standInForRuns( app, page, path.join( site.dir, LOGIN ) );
	const incomplete = page.getByText( 'Update incomplete', { exact: true } );
	const updated = page.getByText( 'Updated to the latest trunk' );
	const card = page.getByText( 'Updating to latest trunk', { exact: true } );

	// The watch is running, and ready, before the update starts. The test
	// speaks for the watcher only once the main process has answered that it
	// started: the page listens for a run's output from that answer on, and a
	// line said sooner would be said to nobody. CHARACTERISATION — on
	// Gutenberg the watcher is npm run dev, here and below.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect( ui.logTab( page, 'Build watcher (building)' ) ).toBeVisible();
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'dev' ] );
	await runs.scriptPrints( 1, 'Watching for changes\n' );
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();

	// INVARIANT — the update stops the watcher, resets the tree, and brings
	// the watcher back without a build of its own (#507): the watcher is
	// asked for a second time, and no build is.
	await updateToLatestTrunk( page );
	await expect.poll( async () => ( await runs.asked() ).kills ).toEqual( [ 'e2e-run-1' ] );
	await expect.poll( async () => ( await runs.asked() ).scripts, { timeout: 60_000 } ).toEqual( [ 'dev', 'dev' ] );
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	await expect( ui.logTab( page, 'Build watcher (building)' ) ).toBeVisible();

	// INVARIANT — the update is not complete while the watch is still
	// rebuilding. The watch's own stop can be pressed, which is the way out
	// of a watch that never gets there, while the update still holds its
	// other gates: the dev server's button, for one, cannot.
	//
	// CHARACTERISATION — how the test knows: the page asks the main process
	// to record a completed update, here and in the count below. What settles
	// it is whether that has been asked: the page asks in the same turn as it
	// hears the line, so the count is final once the line has been heard.
	// What it says on screen comes only after that request is answered, so
	// the look at the screen that follows catches an announcement made
	// without completing and no more than that. It is one look and not a
	// wait: the announcement goes away by itself, and a wait for it to be
	// absent would pass once a wrong one had gone.
	await runs.scriptPrints( 2, 'webpack compiled 12 modules\n' );
	await runs.heard();
	expect( ( await runs.asked() ).completions ).toBe( 0 );
	await expect( card ).toBeVisible();
	expect( await updated.count() ).toBe( 0 );
	await expect( ui.stopBuildWatchButton( page ) ).toBeEnabled();
	await expect( ui.startDevServerButton( page ) ).toBeDisabled();

	// INVARIANT — the watch saying it is ready is what completes the update.
	await runs.scriptPrints( 2, 'Watching for changes\n' );
	await expect( updated.first() ).toBeVisible();
	expect( ( await runs.asked() ).completions ).toBe( 1 );
	await expect( card ).toHaveCount( 0 );
	await expect.poll( () => Boolean( session.readSettings().siteMeta[ site.dir ].updateIncomplete ) ).toBe( false );
	expect( ( await runs.asked() ).scripts ).toEqual( [ 'dev', 'dev' ] );

	// INVARIANT — a watch that is stopped before it is ready leaves the
	// update incomplete, on the screen and in the store, with the way to
	// finish it offered.
	advanceOrigin( site.origin, { 'src/wp-login.php': NEWEST_LOGIN } );
	await updateToLatestTrunk( page );
	await expect.poll( async () => ( await runs.asked() ).scripts, { timeout: 60_000 } ).toEqual( [ 'dev', 'dev', 'dev' ] );
	expect( read( site.dir, LOGIN ) ).toBe( NEWEST_LOGIN );
	await ui.stopBuildWatchButton( page ).click();
	await expect( incomplete ).toBeVisible();
	await expect( ui.retryInstallButton( page ) ).toBeVisible();
	await expect( card ).toHaveCount( 0 );
	await expect.poll( () => Boolean( session.readSettings().siteMeta[ site.dir ].updateIncomplete ) ).toBe( true );
} );
