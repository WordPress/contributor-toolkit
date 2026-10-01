/**
 * A site the old engine made, seen through the app (#385).
 *
 * The app's Git engine changed and the sites the old one cloned are refused on
 * every write. The refusal starts in the main process and ends on the card, so
 * only a journey can say the contributor actually sees it: the banner, the
 * refused ticket link, the way out (a new site), and that the way out is open
 * (deleting the old site still works).
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, exists, branches, LOGIN } = require( '../helpers/git-site.cjs' );

test( 'a site the old engine made is read, refused on every write, and can still be deleted', async ( { session } ) => {
	const site = await makeSite( session, { legacy: true } );
	const { page } = await session.start( site.settings );
	const confirmsAnswered = await session.acceptConfirms();

	// INVARIANT — the card says why the site cannot be used and where to go.
	await expect( page.getByText( 'This site was created by an earlier version of the app.' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — linking a ticket is refused with the same sentence, and the
	// repository is left as it was: no branch, no checkout.
	await ui.ticketField( page ).first().fill( '60001' );
	await ui.linkTicketButton( page ).first().click();
	await expect( page.getByRole( 'alert' ).filter( { hasText: 'earlier version of the app' } ).first() ).toBeVisible( { timeout: 30_000 } );
	expect( branches( site.dir ) ).not.toContain( 'ticket/60001' );
	expect( exists( site.dir, LOGIN ) ).toBe( true );

	// INVARIANT — the way out is one click away: the banner opens the create
	// modal the sidebar button opens.
	await page.getByRole( 'button', { name: 'Create site', exact: true } ).click();
	const createDialog = ui.createSiteDialog( page );
	await expect( createDialog ).toBeVisible();
	// INVARIANT — the dialog offers both targets and defaults to Core (#251).
	await expect( createDialog.getByRole( 'radio', { name: 'WordPress Core', exact: true } ) ).toBeChecked();
	await expect( createDialog.getByRole( 'radio', { name: 'Gutenberg', exact: true } ) ).not.toBeChecked();
	// INVARIANT — opened from here a second time, the dialog has kept nothing
	// of the first: an abandoned name or project is not waiting in a form the
	// contributor expects to be new (#553). The sidebar button always opened it
	// empty; this button did not.
	await createDialog.getByLabel( 'Site name', { exact: true } ).fill( 'Abandoned site' );
	await createDialog.getByRole( 'radio', { name: 'Gutenberg', exact: true } ).click();
	await page.keyboard.press( 'Escape' );
	await expect( ui.createSiteDialog( page ) ).toHaveCount( 0 );
	await page.getByRole( 'button', { name: 'Create site', exact: true } ).click();
	await expect( createDialog.getByLabel( 'Site name', { exact: true } ) ).toHaveValue( '' );
	await expect( createDialog.getByRole( 'radio', { name: 'WordPress Core', exact: true } ) ).toBeChecked();
	await page.keyboard.press( 'Escape' );
	await expect( ui.createSiteDialog( page ) ).toHaveCount( 0 );

	// INVARIANT — deleting is not behind the refusal.
	await ui.siteMenuButton( page ).click();
	await ui.deleteSiteMenuItem( page ).click();
	await expect( page.getByText( 'No sites yet.' ).first() ).toBeVisible( { timeout: 30_000 } );
	expect( await confirmsAnswered() ).toBe( 1 );
	// CHARACTERISATION — the registry forgot it.
	expect( session.readSettings().sites ).toEqual( [] );
} );
