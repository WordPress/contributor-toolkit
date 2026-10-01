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
 *
 * The last journey is the way to that button for a contributor who is not
 * signed in: being asked, saying no, saying yes, the code to type in the
 * browser, GitHub's answer arriving later, and what the card keeps and drops
 * when the dialog is closed part-way. GitHub's device flow is stubbed at the
 * same seam, and the test plays GitHub's answer itself.
 *
 * Where an assertion is marked INVARIANT or CHARACTERISATION, see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
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

	await ui.issueField( page ).fill( ISSUE );
	await ui.linkIssueButton( page ).click();
	await expect( page.getByText( `Working on issue #${ ISSUE }`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	write( site.dir, LOGIN, '<?php // my change\n' );

	await stubGithub( app, { url: `https://github.com/WordPress/gutenberg/pull/9`, number: 9, branch: `fix/issue-${ ISSUE }` } );
	await ui.reviewChangesButton( page ).click();

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

	await ui.linkTicket( page, TICKET );
	write( site.dir, LOGIN, '<?php // my change\n' );

	await stubGithub( app, { url: `https://github.com/WordPress/wordpress-develop/pull/9`, number: 9, branch: `trac-${ TICKET }` } );
	await ui.reviewChangesButton( page ).click();

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

const DEVICE_CODE = 'WDJB-MJHT';
const DEVICE_PAGE = 'https://github.com/login/device';

// A stub main that starts signed out. Signing in hands back a code and then
// waits, the way the real one does while the contributor is in the browser;
// `answerSignIn` is GitHub's answer, sent when the test says so. Opening the
// pull request fails for want of a connection. Nothing here leaves the
// machine: the handler that opens a link in the browser, the save dialog and
// the two lookups that linking a ticket starts are replaced as well.
async function stubSignedOut( app ) {
	await app.evaluate( ( { ipcMain, dialog } ) => {
		const state = { login: null, sender: null, signIns: 0, opened: [], prCalls: [], saveDialogs: 0 };
		global.__e2eGithub = state;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'url:open', ( event, url ) => {
			state.opened.push( url );
			return true;
		} );
		replace( 'git:list-ticket-patches', () => ( { ok: true, prs: { status: 'ok', items: [] } } ) );
		replace( 'trac:list-attachments', () => ( { ok: true, status: 'ok', items: [] } ) );
		replace( 'github:account', () => ( { ok: true, login: state.login, configured: true, testMode: null } ) );
		replace( 'github:sign-in', ( event ) => {
			state.signIns += 1;
			state.sender = event.sender;
			return { ok: true, userCode: 'WDJB-MJHT', verificationUri: 'https://github.com/login/device' };
		} );
		replace( 'github:sign-in-cancel', () => ( { ok: true } ) );
		replace( 'github:sign-out', () => {
			state.login = null;
			return { ok: true };
		} );
		replace( 'github:open-pr', ( event, sitePath, options ) => {
			state.prCalls.push( options );
			return { ok: false, reason: 'offline', error: 'fetch failed' };
		} );
		dialog.showSaveDialog = async () => {
			state.saveDialogs += 1;
			return { canceled: true };
		};
	} );
}

async function answerSignIn( app, answer ) {
	await app.evaluate( ( electron, payload ) => {
		const state = global.__e2eGithub;
		if ( payload.ok ) {
			state.login = payload.login;
		}
		state.sender.send( 'github:sign-in:done', payload );
	}, answer );
}

// What the stub was asked, without the window it holds on to.
async function githubStub( app ) {
	return app.evaluate( () => {
		const { signIns, opened, prCalls, saveDialogs } = global.__e2eGithub;
		return { signIns, opened, prCalls, saveDialogs };
	} );
}

test( 'a contributor who is not signed in is asked first, can say no, signs in with a code that outlives the dialog, and is told when the pull request could not be opened', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await stubSignedOut( app );

	await ui.linkTicket( page, TICKET );
	write( site.dir, LOGIN, '<?php // my change\n' );
	await ui.reviewChangesButton( page ).click();

	const dialog = page.getByRole( 'dialog', { name: 'Review & submit changes' } );
	const signIn = dialog.getByRole( 'button', { name: 'Sign in with GitHub', exact: true } );
	const openPr = dialog.getByRole( 'button', { name: 'Open pull request', exact: true } );
	const code = dialog.getByText( DEVICE_CODE, { exact: true } );
	const title = dialog.getByRole( 'textbox', { name: 'Title', exact: true } );
	const notes = dialog.getByRole( 'textbox', { name: 'Notes for reviewers (optional)', exact: true } );
	const closeAndReopen = async () => {
		await ui.closeDialogButton( dialog ).click();
		await expect( dialog ).toHaveCount( 0 );
		await ui.reviewChangesButton( page ).click();
	};

	// INVARIANT — signed out, the card asks before it does anything: there is
	// no form, and no button that would open a pull request.
	await expect( signIn ).toBeVisible( { timeout: 30_000 } );
	await expect( openPr ).toHaveCount( 0 );
	await expect( title ).toHaveCount( 0 );

	// INVARIANT — saying no is an answer the card takes: it stops asking, says
	// nothing happened, and can be asked to ask again.
	await dialog.getByRole( 'button', { name: 'Not now', exact: true } ).click();
	await expect( dialog.getByText( /^Nothing was signed in and nothing was sent\./ ) ).toBeVisible();
	await expect( signIn ).toHaveCount( 0 );
	await dialog.getByRole( 'button', { name: 'Show this again', exact: true } ).click();
	await expect( signIn ).toBeVisible();

	// INVARIANT — signing in shows the code to type and opens the page to
	// type it on, once.
	await signIn.click();
	await expect( code ).toBeVisible();
	await expect( signIn ).toHaveCount( 0 );
	await expect.poll( async () => ( await githubStub( app ) ).opened ).toEqual( [ DEVICE_PAGE ] );

	// INVARIANT — GitHub's answer arrives after the code was shown, and a
	// refusal there reads as the choice it was: the code goes, the card says
	// nothing was changed, and it asks again.
	await answerSignIn( app, { ok: false, reason: 'denied' } );
	await expect( dialog.getByRole( 'alert' ).filter( { hasText: 'The authorization was declined on GitHub. Nothing was changed.' } ) ).toBeVisible();
	await expect( code ).toHaveCount( 0 );

	// CHARACTERISATION — a sign-in under way is not dropped by closing the
	// dialog: the code is still there when it opens again, and opening it
	// asked GitHub for nothing. Two sign-ins were started so far, the one
	// that was refused and this one.
	await signIn.click();
	await expect( code ).toBeVisible();
	await closeAndReopen();
	await expect( code ).toBeVisible( { timeout: 30_000 } );
	expect( ( await githubStub( app ) ).signIns ).toBe( 2 );

	// INVARIANT — approval turns the card into the form, for that account.
	await answerSignIn( app, { ok: true, login: 'janedoe' } );
	await expect( dialog.getByText( /Signed in as janedoe/ ) ).toBeVisible();
	await expect( code ).toHaveCount( 0 );

	// INVARIANT — a pull request that could not be opened says why, and
	// offers the file, which asks where to save it. That the attempt sent the
	// form and nothing else is a CHARACTERISATION, as in the first journey.
	await title.fill( 'Reject a theme zip' );
	await notes.fill( 'Upload a theme in the plugin installer.' );
	await openPr.click();
	const failure = dialog.getByRole( 'alert' ).filter( { hasText: 'No connection to GitHub.' } );
	await expect( failure ).toBeVisible();
	expect( ( await githubStub( app ) ).prCalls ).toEqual( [ { title: 'Reject a theme zip', notes: 'Upload a theme in the plugin installer.' } ] );
	await dialog.getByRole( 'button', { name: 'Save the patch file instead', exact: true } ).click();
	await expect.poll( async () => ( await githubStub( app ) ).saveDialogs ).toBe( 1 );

	// CHARACTERISATION — what the card keeps across a close: the account and
	// the title. What it drops: last time's failure, and the notes.
	await closeAndReopen();
	await expect( dialog.getByText( /Signed in as janedoe/ ) ).toBeVisible( { timeout: 30_000 } );
	await expect( failure ).toHaveCount( 0 );
	await expect( title ).toHaveValue( 'Reject a theme zip' );
	await expect( notes ).toHaveValue( '' );

	// INVARIANT — signing out puts the card back to asking.
	await dialog.getByRole( 'button', { name: 'Sign out', exact: true } ).click();
	await expect( signIn ).toBeVisible();
	await expect( openPr ).toHaveCount( 0 );
} );
