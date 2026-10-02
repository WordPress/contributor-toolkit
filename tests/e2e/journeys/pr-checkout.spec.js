/**
 * Trying a pull request as its own checkout, driven through the app (#458).
 *
 * The boundary this journey protects is ownership. Ticket work must leave the
 * worktree before the pull request arrives, and edits made while trying the PR
 * must stay with its local PR branch when the contributor goes back.
 */

const { gitOk, commitFiles } = require( '../../unit/helpers/git.cjs' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const {
	makeSite,
	addPullRequestToOrigin,
	read,
	write,
	currentBranch,
	SUBSTRATE,
	SUBSTRATE_CONTENT,
	LOGIN,
	DOOMED,
} = require( '../helpers/git-site.cjs' );
const { prSubmissionRefusal } = require( '../../../src/renderer/pr-checkout.cjs' );

const TICKET = '60001';
const PR = 7;
const TICKET_EDIT = '<?php // my ticket work\n';
const PR_CONTENT = '<?php // pull request 7\n';
const PR_EDIT = '<?php // my experiment on pull request 7\n';

test( 'a PR checkout keeps ticket work and later PR edits on their own branches', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const prHead = addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { app, page } = await session.start( site.settings );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'git:list-ticket-patches' );
		ipcMain.handle( 'git:list-ticket-patches', () => ( { ok: true, prs: { status: 'ok', items: [ { number: 7, title: 'Example pull request', state: 'open', url: 'https://github.com/WordPress/wordpress-develop/pull/7' } ] } } ) );
		ipcMain.removeHandler( 'trac:list-attachments' );
		ipcMain.handle( 'trac:list-attachments', () => ( { ok: true, status: 'ok', items: [ { filename: '60001.diff', url: 'https://core.trac.wordpress.org/attachment/ticket/60001/60001.diff', applyable: true } ] } ) );
		// Signed in to GitHub, and counting being asked: signed out, the pull
		// request card in the review has no form to offer whatever else is
		// true, and its absence below would prove nothing.
		ipcMain.removeHandler( 'github:account' );
		ipcMain.handle( 'github:account', () => {
			global.__e2eAccountAsked = ( global.__e2eAccountAsked || 0 ) + 1;
			return { ok: true, login: 'janedoe', configured: true, testMode: null };
		} );
	} );
	await ui.linkTicket( page, TICKET );
	await expect( ui.readPatchButton( page ) ).toHaveCount( 2 );
	await expect( ui.applyPrButton( page ) ).toHaveCount( 1 );

	write( site.dir, DOOMED, TICKET_EDIT );
	await ui.prField( page ).fill( String( PR ) );
	await ui.applyPrButton( page ).last().click();

	await expect( page.getByText( `PR #${ PR } changes 1 file.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible();
	await ui.applyAndRebuildButton( page ).click();

	await expect
		.poll( () => currentBranch( site.dir ), { timeout: 60_000 } )
		.toBe( `pr/${ PR }` );
	const activeContext = page.getByText( `PR #${ PR } is applied.`, { exact: true } );
	await expect( activeContext ).toBeVisible( { timeout: 60_000 } );
	await expect( ui.revertPrButton( page ) ).toHaveCount( 1 );
	await expect( ui.prField( page ) ).toHaveCount( 0 );
	await expect( ui.anyPatchFileButton( page ) ).toHaveCount( 0 );
	await expect( ui.applyPrButton( page ) ).toHaveCount( 0 );
	await expect( ui.readPatchButton( page ) ).toHaveCount( 0 );
	// The banner sits under the card's heading and above the ticket's number
	// and the linked pull requests. Asserted as document order, not as Y coordinates: the moment
	// the banner appears the next-action cue smooth-scrolls it into view, and
	// three bounding boxes read mid-glide can land in any order (the macOS
	// runner did, twice in a day). The card lays these out in document order,
	// so the order is the claim.
	expect( await ui.inDocumentOrder( page, [
		ui.workItemHeading( page, 'Trac ticket' ),
		activeContext,
		ui.workItemNumber( page, TICKET ),
		page.getByText( 'Linked pull requests', { exact: true } ),
	] ) ).toBe( true );
	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	write( site.dir, LOGIN, PR_EDIT );

	// INVARIANT — edits on top of a pull request are not the contributor's to
	// submit, and the review says so twice: above the destinations, with the
	// copy that can still be kept, and on the pull request card in place of
	// the form it would otherwise offer someone signed in. The form's absence
	// is read once the card knows the account; review-changes.spec.js says
	// why, and how the wait works.
	await ui.reviewChangesButton( page ).click();
	const review = page.getByRole( 'dialog', { name: 'Review & submit changes' } );
	const ownership = review.getByRole( 'alert' ).filter( { hasText: prSubmissionRefusal( PR ) } );
	await expect( ownership ).toBeVisible( { timeout: 30_000 } );
	await expect( ownership ).toContainText( 'You can still use Save to keep an unattributed copy of your edits.' );
	await expect( review.getByText( prSubmissionRefusal( PR ), { exact: true } ) ).toBeVisible();
	await expect.poll( () => app.evaluate( () => global.__e2eAccountAsked || 0 ) ).toBeGreaterThan( 0 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( review.getByText( /Signed in as janedoe/ ) ).toHaveCount( 0 );
	await expect( review.getByRole( 'button', { name: 'Open pull request', exact: true } ) ).toHaveCount( 0 );
	await ui.closeDialogButton( review ).click();
	await expect( review ).toHaveCount( 0 );

	await ui.revertPrButton( page ).click();

	// HEAD moves before the handler saves metadata. Wait for the UI to finish
	// restoring and rebuilding the previous branch before inspecting that state.
	await expect( ui.prField( page ) ).toBeVisible( { timeout: 60_000 } );
	await expect( ui.prField( page ) ).toBeEnabled();
	await expect
		.poll( () => currentBranch( site.dir ), { timeout: 60_000 } )
		.toBe( `ticket/${ TICKET }` );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // trunk\n' );
	expect( read( site.dir, DOOMED ) ).toBe( TICKET_EDIT );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.currentBranch ).toBe( `ticket/${ TICKET }` );
	expect( meta.branches[ `ticket/${ TICKET }` ].appliedPatch ).toBeFalsy();
	expect( meta.branches[ `pr/${ PR }` ].headOid ).toBe( prHead );
	expect( gitOk( [ 'rev-parse', `pr/${ PR }` ], site.dir ) ).not.toBe( prHead );

	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: '<?php // pull request 7 moved\n' }, 'PR #7 moves' );
	await ui.prField( page ).fill( String( PR ) );
	await ui.applyPrButton( page ).last().click();
	await expect( page.getByText( `PR #${ PR } has moved on GitHub, but your copy has edits on top.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await page.getByRole( 'button', { name: 'Return to saved copy', exact: true } ).click();
	await expect.poll( () => currentBranch( site.dir ), { timeout: 60_000 } ).toBe( `pr/${ PR }` );
	expect( read( site.dir, LOGIN ) ).toBe( PR_EDIT );
} );

test( 'discarding loose trunk edits continues into the requested PR checkout', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { page } = await session.start( site.settings );
	const confirmsAnswered = await session.acceptConfirms();
	write( site.dir, DOOMED, TICKET_EDIT );

	await ui.prField( page ).fill( String( PR ) );
	await ui.applyPrButton( page ).last().click();
	await expect( page.getByText( `PR #${ PR } changes 1 file.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await ui.applyAndRebuildButton( page ).click();

	const discard = page.getByRole( 'button', { name: `Discard them and check out PR #${ PR }`, exact: true } );
	await expect( discard ).toBeVisible( { timeout: 30_000 } );
	await discard.click();
	await expect
		.poll( () => currentBranch( site.dir ), { timeout: 60_000 } )
		.toBe( `pr/${ PR }` );

	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	expect( await confirmsAnswered() ).toBe( 1 );
} );

test( 'a failed finish remains visible and offers no new patch source', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { app, page } = await session.start( site.settings );
	await ui.prField( page ).fill( String( PR ) );
	await ui.applyPrButton( page ).last().click();
	await ui.applyAndRebuildButton( page ).click();
	await expect( ui.revertPrButton( page ) ).toBeVisible();
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'git:leave-pr' );
		ipcMain.handle( 'git:leave-pr', () => { throw new Error( 'Cannot finish this test right now' ); } );
	} );
	await ui.revertPrButton( page ).click();
	await expect( page.getByRole( 'alert' ).filter( { hasText: 'Cannot finish this test right now' } ) ).toBeVisible();
	await expect( ui.prField( page ) ).toHaveCount( 0 );
	expect( currentBranch( site.dir ) ).toBe( `pr/${ PR }` );
} );

test( 'resuming a ticket restores its applied PR until explicitly reverted', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	addPullRequestToOrigin( site.origin, PR, {
		[ LOGIN ]: PR_CONTENT,
		'package.json': JSON.stringify( { name: 'e2e-fixture-site', version: '1.0.0', private: true, scripts: { build: 'node build.cjs' } } ),
		'build.cjs': "const fs = require('fs'); fs.mkdirSync('build', { recursive: true }); fs.writeFileSync('build/pr-version', fs.readFileSync('src/wp-login.php'));\n"
	} );
	let { page } = await session.start( site.settings );
	await ui.linkTicket( page, TICKET );
	write( site.dir, DOOMED, TICKET_EDIT );
	await ui.prField( page ).fill( String( PR ) );
	await ui.applyPrButton( page ).click();
	await ui.applyAndRebuildButton( page ).click();
	await expect( ui.revertPrButton( page ) ).toBeVisible();
	await expect.poll( () => read( site.dir, 'build/pr-version' ) ).toBe( PR_CONTENT );
	write( site.dir, LOGIN, PR_EDIT );
	await ui.unlinkButton( page ).click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( 'trunk' );
	write( site.dir, 'build/pr-version', 'stale assets' );
	( { page } = await session.restart() );
	await ui.linkTicket( page, TICKET );
	await expect.poll( () => currentBranch( site.dir ) ).toBe( `pr/${ PR }` );
	await expect( ui.revertPrButton( page ) ).toBeVisible();
	expect( read( site.dir, LOGIN ) ).toBe( PR_EDIT );
	await expect.poll( () => read( site.dir, 'build/pr-version' ) ).toBe( PR_EDIT );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	await ui.unlinkButton( page ).click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( 'trunk' );
	await ui.ticketField( page ).first().fill( '60002' );
	await ui.linkTicketButton( page ).first().click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( 'ticket/60002' );
	await ui.switchBackButton( page ).click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( `pr/${ PR }` );
	await expect( ui.workItemNumber( page, TICKET ) ).toBeVisible();
	expect( read( site.dir, LOGIN ) ).toBe( PR_EDIT );
	await expect.poll( () => read( site.dir, 'build/pr-version' ) ).toBe( PR_EDIT );
	await ui.revertPrButton( page ).click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( `ticket/${ TICKET }` );
	expect( read( site.dir, DOOMED ) ).toBe( TICKET_EDIT );
	await ui.unlinkButton( page ).click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( 'trunk' );
	await ui.linkTicket( page, TICKET );
	await expect.poll( () => currentBranch( site.dir ) ).toBe( `ticket/${ TICKET }` );
	await expect( ui.revertPrButton( page ) ).toHaveCount( 0 );
} );

test( 'a failed review reports an error instead of claiming there are no changes', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'git:get-patch' );
		ipcMain.handle( 'git:get-patch', () => ( { ok: false, error: 'Cannot read this patch' } ) );
	} );
	await ui.reviewChangesButton( page ).click();
	await expect( page.getByText( 'Error: Cannot read this patch', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( /There is nothing to send yet/ ) ).toHaveCount( 0 );
	await expect( page.getByRole( 'alert' ).filter( { hasText: 'Could not load your changes' } ) ).toBeVisible();
} );

test( 'switching tickets does not take over a running terminal command', async ( { session } ) => {
	const site = await makeSite( session );
	write( site.dir, 'package.json', JSON.stringify( { name: 'e2e-fixture-site', version: '1.0.0', scripts: { test: "node -e \"require('fs').writeFileSync('build/terminal-started', 'ready'); setTimeout(() => {}, 60000)\"" } } ) );
	commitFiles( site.dir, [ 'package.json' ], 'terminal script fixture' );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, TICKET );
	await expect( ui.unlinkButton( page ) ).toBeEnabled();
	const terminal = ui.terminalInput( page );
	await terminal.pressSequentially( 'npm run test', { delay: 30 } );
	await terminal.press( 'Enter' );
	await expect.poll( () => { try { return read( site.dir, 'build/terminal-started' ); } catch { return null; } } ).toBe( 'ready' );
	await ui.unlinkButton( page ).click();
	await expect( page.getByText( 'A command is already running. Stop it before switching tickets.', { exact: true } ) ).toBeVisible();
	expect( currentBranch( site.dir ) ).toBe( `ticket/${ TICKET }` );
	await terminal.press( 'Control+c' );
} );
