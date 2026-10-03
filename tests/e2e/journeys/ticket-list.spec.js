/**
 * The list of a site's tickets (#108, #240, #557): the card under the ticket
 * in hand that says what else the site is holding, and offers to go back to
 * each or to delete its work.
 *
 * What the switch and the delete do to the repository is ticket-branches.spec.js's
 * subject. This file is about the card: what it lists, what its buttons are
 * called, and when they can be pressed.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, branches, currentBranch } = require( '../helpers/git-site.cjs' );
const { ticketActionDisabledReason } = require( '../../../src/renderer/ticket-actions.cjs' );
const { deleteWorkQuestion } = require( '../../../src/renderer/ticket-branch-list.cjs' );

/**
 * Answers for GitHub and Trac, which a linked ticket is looked up on: no pull
 * requests and no attachments. Nothing here is about either, no journey
 * should wait on them, and reading a ticket's attachments opens a window of
 * its own, which the journeys that speak to the app's window must not find
 * in its place.
 *
 * @param {Object} app
 */
async function standIns( app ) {
	await app.evaluate( ( { ipcMain } ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: null, items: [] } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
}

/**
 * Parks one ticket and leaves the site on another.
 *
 * @param {Object} page
 */
async function parkOneLinkAnother( page ) {
	await ui.linkTicket( page, '60001' );
	await ui.unlinkButton( page ).click();
	await expect( ui.ticketField( page ).first() ).toBeVisible();
	await ui.linkTicket( page, '60002' );
}

test( 'the list is a card of its own, one row a ticket, and each row\'s buttons are named for their ticket', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await standIns( app );
	await parkOneLinkAnother( page );

	// INVARIANT — with a ticket linked, the card lists the others and is
	// named for that: a region a screen reader can go to, with a list in it.
	const others = page.getByRole( 'region', { name: 'Other tickets on this site', exact: true } );
	await expect( others ).toBeVisible( { timeout: 30_000 } );
	await expect( others.getByRole( 'heading', { level: 2, name: 'Other tickets on this site', exact: true } ) ).toBeVisible();
	await expect( others.getByRole( 'listitem' ) ).toHaveCount( 1 );

	// INVARIANT — the row says which ticket and when it was last worked on,
	// and its two buttons are told apart from another row's by the number.
	const row = ui.ticketRow( page, '60001' );
	await expect( row.getByText( 'Edited just now', { exact: true } ) ).toBeVisible();
	// The row's number is not the linked ticket's. Journeys wait for the
	// linked ticket's number to know a switch has ended, and a row, which is
	// there before its switch begins, must not be what answers them.
	await expect( row.getByText( '#60001', { exact: true } ) ).toBeVisible();
	await expect( ui.workItemNumber( page, '60001' ) ).toHaveCount( 0 );
	await expect( ui.workItemNumber( page, '60002' ) ).toHaveCount( 1 );
	await expect( row.getByRole( 'button' ) ).toHaveCount( 2 );
	await expect( ui.switchBackButton( page, '60001' ) ).toBeEnabled();
	await expect( ui.switchBackButton( page, '60001' ) ).toHaveText( 'Switch' );
	await expect( ui.deleteWorkButton( page, '60001' ) ).toBeEnabled();
	await expect( ui.deleteWorkButton( page, '60001' ) ).toHaveText( 'Delete this ticket’s work' );

	// INVARIANT — with none linked the same card lists every ticket, under
	// the heading for that state, the one worked on last first, and a row
	// offers to go on with its ticket.
	await ui.unlinkButton( page ).click();
	const yours = page.getByRole( 'region', { name: 'Your tickets on this site', exact: true } );
	await expect( yours.getByRole( 'listitem' ) ).toHaveCount( 2, { timeout: 30_000 } );
	await expect( others ).toHaveCount( 0 );
	await expect( yours.getByRole( 'listitem' ).first() ).toContainText( '#60002' );
	await expect( ui.continueWorkingButton( page ) ).toHaveCount( 2 );
	await expect( ui.continueWorkingButton( page, '60001' ) ).toHaveText( 'Continue working' );
	await expect( ui.switchBackButton( page ) ).toHaveCount( 0 );
	await expect( ui.deleteWorkButton( page, '60001' ) ).toBeVisible();
	await expect( ui.deleteWorkButton( page, '60002' ) ).toBeVisible();
} );

test( 'a row\'s buttons are held while the site builds, and say why', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await standIns( app );
	await parkOneLinkAnother( page );
	// A build that runs until the test says it has ended. Nothing is run:
	// the stand-in answers with the run's name and starts no process, and the
	// end is said by the test, on the channel and in the shape the main
	// process says it.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', () => ( { runId: 'e2e-run-1' } ) );
	} );
	const switchBack = ui.switchBackButton( page, '60001' );
	const remove = ui.deleteWorkButton( page, '60001' );
	await expect( switchBack ).toBeEnabled( { timeout: 30_000 } );

	const terminal = ui.terminalInput( page );
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await terminal.pressSequentially( 'npm run build', { delay: 10 } );
	await terminal.press( 'Enter' );

	// INVARIANT — a switch and a delete are checkouts of the directory the
	// build is reading, so both wait for it, and each says what it is
	// waiting for to whoever lands on it (#409).
	const reason = ticketActionDisabledReason( { building: true } );
	await expect( switchBack ).toBeDisabled();
	await expect( switchBack ).toHaveAccessibleDescription( reason );
	await expect( remove ).toBeDisabled();
	await expect( remove ).toHaveAccessibleDescription( reason );
	// Held, they are still what they were called.
	await expect( switchBack ).toHaveAccessibleName( 'Switch #60001' );

	// INVARIANT — a held button does nothing when pressed. A press that got
	// through would be turned away at once, a command being under way, and
	// the ticket's card would say so. That it says nothing, a round trip
	// later, is what shows the press went nowhere. The rest is for the day
	// that refusal is gone: a switch that started would be what the list
	// says it waits for, and one that ended would have moved the checkout.
	await switchBack.click( { force: true } );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( ui.workItemCard( page, 'Trac ticket' ).getByRole( 'alert' ) ).toHaveCount( 0 );
	await expect( switchBack ).toHaveAccessibleDescription( reason );
	await expect( ui.workItemNumber( page, '60002' ) ).toBeVisible();
	expect( currentBranch( site.dir ) ).toBe( 'ticket/60002' );

	// INVARIANT — the build over, both can be pressed again, and say nothing
	// more than their names.
	await app.evaluate( ( { BrowserWindow } ) => {
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'npm:run-script:done', { runId: 'e2e-run-1', code: 0 } );
	} );
	await expect( switchBack ).toBeEnabled();
	await expect( switchBack ).toHaveAccessibleDescription( '' );
	await expect( remove ).toBeEnabled();
	await expect( remove ).toHaveAccessibleDescription( '' );
} );

test( 'a ticket\'s work is deleted only after a question that names it, and saying no deletes nothing', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await standIns( app );
	await parkOneLinkAnother( page );
	const question = ui.confirmDialog( page );
	const remove = ui.deleteWorkButton( page, '60001' );
	const untouched = async () => {
		await page.evaluate( () => window.api.getSitesWithMeta() );
		expect( branches( site.dir ) ).toContain( 'ticket/60001' );
		expect( currentBranch( site.dir ) ).toBe( 'ticket/60002' );
	};

	await remove.click();

	// INVARIANT — it asks, by the ticket's number, says what would go and
	// that it is for good, and opens on the answer that deletes nothing.
	const asked = deleteWorkQuestion( 60001 );
	await expect( question ).toHaveAccessibleName( 'Delete all work on ticket #60001?' );
	await expect( question ).toHaveAccessibleDescription( asked.description );
	expect( asked.description ).toMatch( /This can’t be undone\.$/ );
	await expect( ui.confirmNoButton( page ) ).toBeFocused();
	await untouched();

	// INVARIANT — a press outside the question is not an answer.
	await page.mouse.click( 5, 5 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( question ).toHaveAttribute( 'data-open', '' );

	// INVARIANT — a no leaves everything where it was, the branch, the
	// checkout and the row, and gives the focus back to the button that
	// asked. Cancel and Escape are both a no.
	await ui.confirmNoButton( page ).click();
	await expect( question ).toHaveCount( 0 );
	await expect( remove ).toBeFocused();
	await untouched();
	await remove.click();
	await expect( question ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( question ).toHaveCount( 0 );
	await untouched();
	await expect( ui.switchBackButton( page, '60001' ) ).toBeEnabled();

	// INVARIANT — and a yes deletes that ticket's work and no other's.
	await remove.click();
	await ui.confirmYesButton( page, asked.confirm ).click();
	await expect( question ).toHaveCount( 0 );
	await expect.poll( () => branches( site.dir ), { timeout: 30_000 } ).not.toContain( 'ticket/60001' );
	expect( branches( site.dir ) ).toContain( 'ticket/60002' );
	await expect( ui.ticketListCard( page ) ).toHaveCount( 0 );
} );

test( 'while a ticket\'s work is being deleted its button says so, and the rest of the list waits for it', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await standIns( app );
	await parkOneLinkAnother( page );
	await ui.unlinkButton( page ).click();
	await expect( ui.continueWorkingButton( page ) ).toHaveCount( 2, { timeout: 30_000 } );
	// The delete itself, held until the test lets it go: the real one, so
	// that what it leaves behind is what the app would.
	await app.evaluate( ( { ipcMain } ) => {
		const real = ipcMain._invokeHandlers.get( 'branches:delete' );
		const gate = new Promise( ( open ) => {
			global.__e2eLetDelete = open;
		} );
		ipcMain.removeHandler( 'branches:delete' );
		ipcMain.handle( 'branches:delete', async ( ...args ) => {
			await gate;
			return real( ...args );
		} );
	} );
	// What is said to a screen reader from here on, as ticket-rebase.spec.js
	// records it.
	await page.evaluate( () => {
		window.__e2eSpoken = [];
		new window.MutationObserver( ( records ) => {
			for ( const record of records ) {
				const within = record.target.nodeType === 1 ? record.target : record.target.parentElement;
				if ( ! within || ! within.closest( '[aria-live]' ) ) continue;
				for ( const node of record.addedNodes ) {
					const text = node.textContent.trim();
					if ( text ) window.__e2eSpoken.push( text );
				}
			}
		} ).observe( document.body, { subtree: true, childList: true } );
	} );

	await ui.deleteWorkButton( page, '60001' ).click();
	await ui.confirmYesButton( page, 'Delete this ticket’s work' ).click();
	await expect( ui.confirmDialog( page ) ).toHaveCount( 0 );

	// INVARIANT — the button that was pressed says it is at work, to the ear
	// as to the eye, and every other button of the list waits and says what
	// for: a second delete, or a switch, would be a checkout under the first.
	const reason = ticketActionDisabledReason( { deletingBranch: 'ticket/60001' } );
	await expect.poll( () => page.evaluate( () => window.__e2eSpoken ) ).toContain( 'Deleting' );
	for ( const held of [ ui.deleteWorkButton( page, '60001' ), ui.deleteWorkButton( page, '60002' ), ui.continueWorkingButton( page, '60001' ), ui.continueWorkingButton( page, '60002' ) ] ) {
		await expect( held ).toBeDisabled();
		await expect( held ).toHaveAccessibleDescription( reason );
	}
	// Only the one that was pressed says it: the other row's is held, not busy.
	expect( ( await page.evaluate( () => window.__e2eSpoken ) ).filter( ( text ) => text === 'Deleting' ) ).toHaveLength( 1 );
	expect( branches( site.dir ) ).toContain( 'ticket/60001' );

	// INVARIANT — once it is gone its row is gone, and the ticket that is
	// left can be gone on with or deleted again.
	await app.evaluate( () => global.__e2eLetDelete() );
	await expect( ui.ticketRow( page, '60001' ) ).toHaveCount( 0, { timeout: 30_000 } );
	await expect( ui.continueWorkingButton( page, '60002' ) ).toBeEnabled();
	await expect( ui.deleteWorkButton( page, '60002' ) ).toHaveAccessibleDescription( '' );
	expect( branches( site.dir ) ).not.toContain( 'ticket/60001' );
	expect( branches( site.dir ) ).toContain( 'ticket/60002' );
} );

test( 'on a site that works on GitHub issues the list says issues, in its headings and on its buttons', async ( { session } ) => {
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );
	await standIns( app );
	const link = async ( issue ) => {
		await ui.issueField( page ).fill( issue );
		await ui.linkIssueButton( page ).click();
		await expect( ui.workItemNumber( page, issue ) ).toBeVisible( { timeout: 30_000 } );
	};

	// INVARIANT — with none linked: your issues, and the work that is
	// deleted is an issue's.
	await expect( ui.issueField( page ) ).toBeVisible( { timeout: 30_000 } );
	await link( '71234' );
	await ui.unlinkButton( page ).click();
	const yours = page.getByRole( 'region', { name: 'Your issues on this site', exact: true } );
	await expect( yours.getByRole( 'listitem' ) ).toHaveCount( 1, { timeout: 30_000 } );
	await expect( ui.continueWorkingButton( page, '71234' ) ).toBeEnabled();
	await expect( ui.deleteWorkButton( page, '71234', 'github-issue' ) ).toHaveText( 'Delete this issue’s work' );

	// INVARIANT — with one linked: the other issues.
	await link( '71235' );
	const others = page.getByRole( 'region', { name: 'Other issues on this site', exact: true } );
	await expect( others.getByRole( 'listitem' ) ).toHaveCount( 1, { timeout: 30_000 } );
	await expect( ui.switchBackButton( page, '71234' ) ).toBeEnabled();
	await expect( ui.deleteWorkButton( page, '71234', 'github-issue' ) ).toBeEnabled();

	// INVARIANT — and nothing in the list calls an issue a ticket.
	await expect( others.getByText( /ticket/i ) ).toHaveCount( 0 );
	await expect( page.getByRole( 'region', { name: /tickets on this site$/ } ) ).toHaveCount( 0 );
} );
