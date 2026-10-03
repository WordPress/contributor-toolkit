/**
 * Switching tickets, applying a patch and checking out a pull request while
 * the build watch is running (#262, #506, #510, #554).
 *
 * Each of the three changes the tree under a watch that is compiling it, and
 * each has to decide what to do about that. The answer depends on how much
 * changes and on what the watcher does when it starts.
 *
 * A change the watch can simply recompile is left to it: a ticket switch, and
 * a patch that touches only source files. Nothing is stopped, nothing is
 * built, and the watch's tab says it is compiling until it goes quiet. A
 * change of the whole tree, which a pull request's checkout is, stops the
 * watch first. Then on Core the chain builds and brings the watch back; on a
 * project whose watcher rebuilds everything as it starts, the chain builds
 * nothing, brings the watch back at once, and is done when the watch says it
 * is ready.
 *
 * `patch-apply.spec.js`, `pr-checkout.spec.js` and `ticket-branches.spec.js`
 * are the same three with no watch running, where none of this happens. An
 * update with the watch running is `trunk-update-watch.spec.js`.
 *
 * The checkouts and the patch are real: the origin is a clone on disk and the
 * patch is a file. Nothing else is run. The handlers that start an install,
 * start a script and stop one are answered by stubs that keep what they were
 * asked, and the test says what a running script would say, on the channels
 * it says it on, as TESTING.md describes. What that leaves out: a real run
 * writes its output to the app's log as well, and ends by itself with the code
 * the process gave; here a script runs until the test says it has ended, and
 * a watcher that is "compiling" prints nothing, so it counts as done when the
 * app's own quiet period is over. The two lookups that linking a ticket
 * starts find nothing, so nothing here reaches GitHub or Trac; the one that
 * reads the ticket's page is counted.
 *
 * What the app announces, it announces in a message that goes away by itself
 * after a few seconds. So "it has not said so yet" is read once, at that
 * moment, and not waited for: an assertion that waits for a message to be
 * absent would pass as soon as one that should never have appeared had gone.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, makePatchFile, addPullRequestToOrigin, read, currentBranch, LOGIN } = require( '../helpers/git-site.cjs' );

const TICKET = '60001';
const PR = 7;
const PR_CONTENT = '<?php // pull request 7\n';
const PATCHED = '<?php // fixed by the patch';

// The stand-ins, and what the test uses to speak for a script.
async function standIn( app, page ) {
	await app.evaluate( ( { ipcMain } ) => {
		const asked = { scripts: [], installs: 0, kills: [] };
		global.__e2eChanges = asked;
		// Kept apart from what was run, which the journeys compare whole.
		global.__e2eTicketPagesRead = 0;
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
			return { ok: true };
		} );
		replace( 'git:list-ticket-patches', () => ( { ok: true, prs: { status: 'ok', items: [] } } ) );
		replace( 'trac:list-attachments', () => {
			global.__e2eTicketPagesRead += 1;
			return { ok: true, status: 'ok', items: [] };
		} );
	} );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	return {
		asked: () => app.evaluate( () => global.__e2eChanges ),
		ticketPagesRead: () => app.evaluate( () => global.__e2eTicketPagesRead ),
		scriptPrints: ( run, text ) => tell( 'npm:run-script:log', { runId: `e2e-run-${ run }`, type: 'stdout', data: text } ),
		scriptEnds: ( run, code ) => tell( 'npm:run-script:done', { runId: `e2e-run-${ run }`, code } ),
		// Told and heard: the reply to a question asked after the telling
		// arrives after it.
		heard: () => page.evaluate( () => window.api.getSitesWithMeta() ),
	};
}

// Asks for the pull request by its number and confirms the preview.
async function checkOutPullRequest( page ) {
	await ui.prField( page ).fill( String( PR ) );
	await ui.applyPrButton( page ).last().click();
	await expect( page.getByText( `PR #${ PR } changes 1 file.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await ui.applyAndRebuildButton( page ).click();
}

test( 'on Core a ticket switch and a patch of source files are left to the running watch, and a pull request\'s checkout stops it, builds, and brings it back', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { app, page } = await session.start( site.settings );
	const runs = await standIn( app, page );
	const said = ( text ) => ui.toast( page, text );

	// The watch is running before anything changes. The hint under the
	// terminal is a link only once the site is known to be built.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
	// CHARACTERISATION — on Core the watcher is grunt watch, here and below.
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'grunt' ] );

	// INVARIANT — linking a ticket moves the checkout under a watch that is
	// left running (#510): nothing is stopped and nothing is built, and the
	// watch's tab says it is compiling what moved.
	await ui.linkTicket( page, TICKET );
	await expect( ui.logTab( page, 'Build watcher (compiling)' ) ).toBeVisible();
	await runs.heard();
	expect( await runs.asked() ).toEqual( { scripts: [ 'grunt' ], installs: 0, kills: [] } );

	// INVARIANT — a ticket linked by hand has its page read for what it
	// offers to apply, without anything else being pressed (#292), and once.
	await expect.poll( () => runs.ticketPagesRead() ).toBe( 1 );
	await runs.heard();
	expect( await runs.ticketPagesRead() ).toBe( 1 );

	// The watch has gone quiet again before the next change, so that what its
	// tab says after it is about that change and not this one.
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();

	// INVARIANT — a patch that touches only source files is applied and left
	// to the watch too (#262): the file is changed, the app says the patch is
	// applied without waiting for a build, and no build is run.
	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: '<?php // trunk', to: PATCHED },
	] );
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFile( page );
	await expect( page.getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	// The tab is looked at first: it says so only for as long as the app's
	// quiet period lasts, and the announcement stays longer than that.
	await ui.applyAndRebuildButton( page ).click();
	await expect( ui.logTab( page, 'Build watcher (compiling)' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( said( 'Applied the patch' ) ).toBeVisible();
	expect( read( site.dir, LOGIN ) ).toBe( `${ PATCHED }\n` );
	await runs.heard();
	expect( await runs.asked() ).toEqual( { scripts: [ 'grunt' ], installs: 0, kills: [] } );

	// INVARIANT — and so is taking that patch off again.
	await ui.revertPatchButton( page ).click();
	await expect( said( 'Reverted the patch' ) ).toBeVisible( { timeout: 30_000 } );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // trunk\n' );
	await runs.heard();
	expect( await runs.asked() ).toEqual( { scripts: [ 'grunt' ], installs: 0, kills: [] } );

	// INVARIANT — a pull request's checkout changes the whole tree, so the
	// watcher is stopped for it (#506), the checkout lands, and the chain
	// runs the build itself. The app does not say it is done while that
	// build runs, and the watch is not brought back before it ends.
	// The card was left on its other tab, by the patch file chosen above.
	await ui.pullRequestTab( page ).click();
	await checkOutPullRequest( page );
	await expect.poll( async () => ( await runs.asked() ).kills ).toEqual( [ 'e2e-run-1' ] );
	await expect.poll( () => currentBranch( site.dir ), { timeout: 30_000 } ).toBe( `pr/${ PR }` );
	await expect.poll( async () => ( await runs.asked() ).scripts, { timeout: 30_000 } ).toEqual( [ 'grunt', 'build' ] );
	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );
	await expect( ui.logTab( page, 'Build watcher (paused)' ) ).toBeVisible();
	await runs.heard();
	expect( await said( 'Checked out the pull request' ).count() ).toBe( 0 );
	expect( ( await runs.asked() ).scripts ).toHaveLength( 2 );

	// INVARIANT — the build ending well is what the app announces, and the
	// watch is brought back.
	await runs.scriptEnds( 2, 0 );
	await expect( said( 'Checked out the pull request' ) ).toBeVisible();
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'grunt', 'build', 'grunt' ] );
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
	expect( ( await runs.asked() ).installs ).toBe( 0 );
} );

test( 'where the watcher rebuilds everything as it starts, a pull request\'s checkout builds nothing itself: it brings the watch back and says it is done when the watch is ready', async ( { session } ) => {
	// A built Gutenberg checkout: the file the app looks for is there.
	const site = await makeSite( session, { origin: true } );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const built = path.join( site.dir, 'build', 'scripts', 'block-library', 'index.min.js' );
	fs.mkdirSync( path.dirname( built ), { recursive: true } );
	fs.writeFileSync( built, '' );
	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { app, page } = await session.start( site.settings );
	const runs = await standIn( app, page );
	const said = ( text ) => ui.toast( page, text );

	// The watch is running, and ready, before the checkout. The test speaks
	// for the watcher only once the main process has answered that it
	// started. CHARACTERISATION — on Gutenberg the watcher is npm run dev,
	// here and below.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( async () => ( await runs.asked() ).scripts ).toEqual( [ 'dev' ] );
	await runs.scriptPrints( 1, 'Watching for changes\n' );
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();

	// INVARIANT — the checkout stops the watcher and lands, and then the
	// watcher is asked for again and no build is (#506).
	await checkOutPullRequest( page );
	await expect.poll( async () => ( await runs.asked() ).kills ).toEqual( [ 'e2e-run-1' ] );
	await expect.poll( () => currentBranch( site.dir ), { timeout: 30_000 } ).toBe( `pr/${ PR }` );
	await expect.poll( async () => ( await runs.asked() ).scripts, { timeout: 30_000 } ).toEqual( [ 'dev', 'dev' ] );
	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );
	await expect( ui.logTab( page, 'Build watcher (building)' ) ).toBeVisible();

	// INVARIANT — the app does not say the pull request is checked out while
	// the watch is still rebuilding: until then the site has no build to try
	// it on.
	await runs.scriptPrints( 2, 'webpack compiled 12 modules\n' );
	await runs.heard();
	expect( await said( 'Checked out the pull request' ).count() ).toBe( 0 );

	// INVARIANT — the watch saying it is ready is what the app announces.
	await runs.scriptPrints( 2, 'Watching for changes\n' );
	await expect( said( 'Checked out the pull request' ) ).toBeVisible();
	await expect( ui.logTab( page, 'Build watcher (watching)' ) ).toBeVisible();
	expect( await runs.asked() ).toEqual( { scripts: [ 'dev', 'dev' ], installs: 0, kills: [ 'e2e-run-1' ] } );
} );
