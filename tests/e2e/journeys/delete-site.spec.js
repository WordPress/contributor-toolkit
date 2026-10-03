/**
 * Deleting a site, through the question a contributor is asked (#557).
 *
 * A site is a folder with a checkout, an install and somebody's work in it,
 * and deleting it removes the folder. What stands between the menu's item
 * and that is one question, so this is about the question: that it is asked,
 * that it names the site, that everything but a yes leaves the site alone,
 * and that a yes deletes the site it named.
 *
 * What happens while a deletion runs, and when one fails, is engine.spec.js's.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );
const { deleteSiteQuestion } = require( '../../../src/renderer/site-dialogs.cjs' );

test( 'a site is deleted only after a question that names it, and nothing but a yes deletes it', async ( { session } ) => {
	const site = await makeSite( session, { label: 'doomed-site' } );
	const { page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'doomed-site' ) ).toBeVisible( { timeout: 30_000 } );
	const question = ui.confirmDialog( page );
	const ask = async () => {
		await ui.siteMenuButton( page ).click();
		await ui.deleteSiteMenuItem( page ).click();
		await expect( question ).toBeVisible();
	};
	const untouched = async () => {
		await page.evaluate( () => window.api.getSitesWithMeta() );
		expect( fs.existsSync( site.dir ) ).toBe( true );
		expect( session.readSettings().sites ).toEqual( [ site.dir ] );
	};

	// INVARIANT — the menu's item asks, by the site's name, says what would
	// go and that it is for good, and opens on the answer that deletes
	// nothing.
	await ask();
	const asked = deleteSiteQuestion( 'doomed-site' );
	await expect( question ).toHaveAccessibleName( 'Delete doomed-site?' );
	await expect( question ).toHaveAccessibleDescription( asked.description );
	expect( asked.description ).toMatch( /from your computer\. This can’t be undone\.$/ );
	await expect( ui.confirmNoButton( page ) ).toBeFocused();
	await untouched();

	// INVARIANT — a press outside the question is not an answer.
	await page.mouse.click( 5, 5 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( question ).toHaveAttribute( 'data-open', '' );

	// INVARIANT — a no leaves the site where it was and gives the focus back
	// to the menu's button. Cancel and Escape are both a no.
	await ui.confirmNoButton( page ).click();
	await expect( question ).toHaveCount( 0 );
	await expect( ui.siteMenuButton( page ) ).toBeFocused();
	await untouched();
	await ask();
	await page.keyboard.press( 'Escape' );
	await expect( question ).toHaveCount( 0 );
	await untouched();
	await expect( ui.siteHeading( page, 'doomed-site' ) ).toBeVisible();

	// INVARIANT — a yes deletes it: the folder is gone, the app has forgotten
	// it, and the window says there are no sites.
	await ask();
	await ui.confirmYesButton( page, 'Delete site' ).click();
	await expect( question ).toHaveCount( 0 );
	await expect( ui.noSitesTitle( page ) ).toBeVisible( { timeout: 30_000 } );
	expect( fs.existsSync( site.dir ) ).toBe( false );
	expect( session.readSettings().sites ).toEqual( [] );
} );
