/**
 * The Open a pull request card, from a signed-in contributor pressing the
 * button to the result (#167, #251).
 *
 * GitHub itself is stubbed at the IPC seam: `github:account` answers with a
 * fixed login, `github:open-pr` reports two stages and returns a result. What
 * the journey pins is the wiring the unit suite cannot reach: the form's
 * per-project words, the stage label naming the repository being forked, the
 * progress event landing on this site's spinner, the result and its
 * confirmation naming the repository the pull request landed on, and the
 * loop-back to the work item. The flow against a real GitHub is the unit
 * suite's and the hand pass's.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const { makeSite, write, LOGIN } = require( '../helpers/git-site.cjs' );

const TICKET = '60001';
const ISSUE = '71234';

// A stub main that looks signed in and opens the pull request without GitHub.
// The handler answers slowly enough for the forking label to be seen, sends
// the progress event the way the real one does (keyed by site path), and
// records what the renderer sent so the test can read it back.
async function stubGithub( app, { url, number, branch } ) {
	await app.evaluate( ( { ipcMain }, result ) => {
		ipcMain.removeHandler( 'github:account' );
		ipcMain.handle( 'github:account', () => ( { ok: true, login: 'janedoe', configured: true, testMode: null } ) );
		ipcMain.removeHandler( 'github:open-pr' );
		ipcMain.handle( 'github:open-pr', async ( event, sitePath, options ) => {
			global.__openPrCalls = ( global.__openPrCalls || [] ).concat( [ { sitePath, options } ] );
			event.sender.send( 'github:pr:progress', { sitePath, stage: 'forking' } );
			await new Promise( ( resolve ) => setTimeout( resolve, 800 ) );
			event.sender.send( 'github:pr:progress', { sitePath, stage: 'opening' } );
			await new Promise( ( resolve ) => setTimeout( resolve, 1000 ) );
			return { ok: true, ...result, exactBase: true };
		} );
	}, { url, number, branch } );
}

async function openPrCalls( app ) {
	return app.evaluate( () => global.__openPrCalls || [] );
}

test( 'a Gutenberg site opens its pull request against WordPress/gutenberg, worded for GitHub (#251)', async ( { session } ) => {
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );
	await expect( page.getByText( 'Gutenberg', { exact: true } ).first() ).toBeVisible( { timeout: 30_000 } );

	await page.getByLabel( 'GitHub issue number or URL' ).fill( ISSUE );
	await page.getByRole( 'button', { name: 'Link issue', exact: true } ).click();
	await expect( page.getByText( `Working on issue #${ ISSUE }`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	write( site.dir, LOGIN, '<?php // my change\n' );

	await stubGithub( app, { url: `https://github.com/WordPress/gutenberg/pull/9`, number: 9, branch: `fix/issue-${ ISSUE }` } );
	await page.getByRole( 'button', { name: 'Review & submit changes', exact: true } ).click();

	// INVARIANT — signed in, the form is worded for this project: the fork
	// goes to the gutenberg repository, an untitled pull request is an issue,
	// the notes help names the Fixes line, and the fold is Gutenberg's.
	await expect( page.getByText( /Signed in as janedoe/ ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByRole( 'button', { name: 'janedoe/gutenberg', exact: true } ) ).toBeVisible();
	await expect( page.getByText( `Left empty, it will be titled Issue #${ ISSUE }.` ) ).toBeVisible();
	await expect( page.getByText( /The Fixes line that links the issue/ ) ).toBeVisible();
	await expect( page.getByText( 'How pull requests work in Gutenberg', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( 'How pull requests work in core', { exact: true } ) ).toHaveCount( 0 );
	await expect( page.getByText( /Trac/ ) ).toHaveCount( 0 );

	// INVARIANT — the slow step names the repository being forked, and the
	// progress event moves this site's spinner.
	await page.getByRole( 'button', { name: 'Open pull request', exact: true } ).click();
	await expect( page.getByText( 'Creating your fork of WordPress/gutenberg…', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( 'Opening the pull request…', { exact: true } ) ).toBeVisible( { timeout: 10_000 } );

	// INVARIANT — the result links the pull request, the confirmation names
	// where it landed, and the loop-back is GitHub's, not Trac's.
	await expect( page.getByRole( 'button', { name: 'pull request #9', exact: true } ) ).toBeVisible( { timeout: 10_000 } );
	await expect( page.getByTestId( 'snackbar' ).filter( { hasText: 'Opened pull request #9 on WordPress/gutenberg' } ) ).toBeVisible();
	await expect( page.getByText( /The Fixes line already lists it on the issue/ ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: `Open #${ ISSUE } to comment`, exact: true } ) ).toBeVisible();
	await expect( page.getByText( /Triage and props live on the ticket/ ) ).toHaveCount( 0 );

	// CHARACTERISATION — the renderer sends only the site and the form; the
	// work item, the project and the repository are main's to read.
	const calls = await openPrCalls( app );
	expect( calls ).toHaveLength( 1 );
	expect( calls[ 0 ].sitePath ).toBe( site.dir );
	expect( Object.keys( calls[ 0 ].options ).sort() ).toEqual( [ 'notes', 'title' ] );
} );

test( 'a Core site opens its pull request against wordpress-develop, worded for Trac', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );

	await page.getByLabel( 'Trac ticket number or URL' ).first().fill( TICKET );
	await page.getByRole( 'button', { name: 'Link ticket', exact: true } ).first().click();
	await expect( page.getByText( `#${ TICKET }`, { exact: true } ).first() ).toBeVisible( { timeout: 30_000 } );
	write( site.dir, LOGIN, '<?php // my change\n' );

	await stubGithub( app, { url: `https://github.com/WordPress/wordpress-develop/pull/9`, number: 9, branch: `trac-${ TICKET }` } );
	await page.getByRole( 'button', { name: 'Review & submit changes', exact: true } ).click();

	await expect( page.getByText( /Signed in as janedoe/ ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByRole( 'button', { name: 'janedoe/wordpress-develop', exact: true } ) ).toBeVisible();
	await expect( page.getByText( `Left empty, it will be titled Ticket #${ TICKET }.` ) ).toBeVisible();
	await expect( page.getByText( /The ticket link and your WordPress.org username/ ) ).toBeVisible();
	await expect( page.getByText( 'How pull requests work in core', { exact: true } ) ).toBeVisible();

	await page.getByRole( 'button', { name: 'Open pull request', exact: true } ).click();
	await expect( page.getByText( 'Creating your fork of WordPress/wordpress-develop…', { exact: true } ) ).toBeVisible();

	await expect( page.getByRole( 'button', { name: 'pull request #9', exact: true } ) ).toBeVisible( { timeout: 10_000 } );
	await expect( page.getByTestId( 'snackbar' ).filter( { hasText: 'Opened pull request #9 on WordPress/wordpress-develop' } ) ).toBeVisible();
	await expect( page.getByText( /Triage and props live on the ticket/ ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: `Open #${ TICKET } to comment`, exact: true } ) ).toBeVisible();
} );
