/**
 * The window's shell (#555): the sites list, the open site's page beside it,
 * and the footer under the page.
 *
 * The shell is what a contributor moves through to get anywhere else, and
 * three of the things it has to do are not visible in any one screen. A site
 * that is not open is still running: its terminal, its server and what was
 * typed into its fields are in its view, so the views are hidden and shown
 * and never rebuilt. A list that is hidden is hidden from the keyboard and
 * from a screen reader as well as from sight. And one site is always open:
 * pressing the open site's entry does not close it.
 *
 * What a site's entry says about it, the project or that it is being deleted,
 * is `engine.spec.js`'s; which entry a selection opens, and what a dot
 * reports, are decided in `sites-list.cjs` and held by its unit tests. The
 * sites here are folders with no checkout in them: the shell never asks what
 * is inside one.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );

const DAY = 24 * 60 * 60 * 1000;
const FEEDBACK_FORM = 'https://docs.google.com/forms/d/e/1FAIpQLScnMxicyDxZO2OoaS5ela8FArYWjCyLfC3hxRBBRSF7XLPzKg/viewform';

/**
 * Settings for an app that knows the given sites. Each is a folder of its
 * own, created a day apart in the order given, with a trunk recent enough to
 * have nothing to report unless the site says otherwise.
 *
 * @param {Object}   session
 * @param {Object[]} sites   `{ label, folder, ...meta }`, oldest first. `folder` is the start of the folder's name, for a site whose path matters.
 * @return {{dirs: string[], settings: Object}} The folders, in the order given, and the settings.
 */
function listedSites( session, sites ) {
	const settings = { sites: [], siteMeta: {}, preferences: {} };
	const dirs = sites.map( ( { label, folder = 'wpct-e2e-site-', ...meta }, index ) => {
		const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), folder ) ) );
		fs.mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
		settings.sites.push( dir );
		settings.siteMeta[ dir ] = {
			initialized: true,
			createdAt: new Date( Date.now() - ( sites.length - index ) * DAY ).toISOString(),
			label,
			trunkDate: new Date( Date.now() - DAY ).toISOString(),
			skipInitWizard: true,
			...meta,
		};
		return dir;
	} );
	return { dirs, settings };
}

test( 'the sites list opens a site without closing the others, and the open site stays open when its own entry is pressed', async ( { session } ) => {
	const { settings } = listedSites( session, [ { label: 'older-site' }, { label: 'newer-site', projectType: 'gutenberg' } ] );
	const { page } = await session.start( settings );
	const older = ui.sidebarEntry( page, 'older-site' );
	const newer = ui.sidebarEntry( page, 'newer-site' );

	// CHARACTERISATION — the list is newest first, and the newest site is the
	// one the app opens on.
	await expect( ui.siteHeading( page, 'newer-site' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByRole( 'grid' ).getByRole( 'row' ) ).toHaveText( [ /newer-site/, /older-site/ ] );
	// INVARIANT — the list says which site is open, and the page's header says
	// its name and its project.
	await expect( newer ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( older ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( page.getByRole( 'region', { name: 'newer-site' } ).getByText( 'Gutenberg', { exact: true } ) ).toBeVisible();

	// Something only this site's view holds: what is typed into its field.
	const issue = ui.issueField( page ).filter( { visible: true } );
	await issue.fill( '12345' );

	// INVARIANT — pressing another entry opens that site: the header, the
	// list's mark and the view all follow.
	await older.click();
	await expect( ui.siteHeading( page, 'older-site' ) ).toBeVisible();
	await expect( ui.siteHeading( page, 'newer-site' ) ).toHaveCount( 0 );
	await expect( older ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( newer ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( ui.ticketField( page ).filter( { visible: true } ) ).toHaveValue( '' );
	await expect( issue ).toHaveCount( 0 );

	// INVARIANT — pressing the open site's entry leaves it open: a window
	// with sites in it always has one open.
	await older.click();
	await expect( ui.siteHeading( page, 'older-site' ) ).toBeVisible();
	await expect( older ).toHaveAttribute( 'aria-pressed', 'true' );

	// INVARIANT — the site that was left is as it was left: its view was
	// hidden, not thrown away and built again.
	await newer.click();
	await expect( ui.siteHeading( page, 'newer-site' ) ).toBeVisible();
	await expect( issue ).toHaveValue( '12345' );
} );

test( 'a site in a folder with a space in its path is named in the list, and opens, like any other', async ( { session } ) => {
	// A Windows home folder is "C:\\Users\\First Last" for anyone whose
	// name has two words, so this is an ordinary site and not an odd one.
	const { settings } = listedSites( session, [ { label: 'spaced-site', folder: 'wpct e2e site-' }, { label: 'plain-site' } ] );
	const { page } = await session.start( settings );
	await expect( ui.siteHeading( page, 'plain-site' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — its entry has its name, which is what the list is found and
	// read by, and pressing it opens the site.
	await expect( ui.sidebarEntry( page, 'spaced-site' ) ).toBeVisible();
	await ui.sidebarEntry( page, 'spaced-site' ).click();
	await expect( ui.siteHeading( page, 'spaced-site' ) ).toBeVisible();
	await expect( ui.sidebarEntry( page, 'spaced-site' ) ).toHaveAttribute( 'aria-pressed', 'true' );
} );

test( 'a site with something to report says so in the list before it is opened', async ( { session } ) => {
	const { settings } = listedSites( session, [
		{ label: 'unfinished', updateIncomplete: true },
		{ label: 'old-trunk', trunkDate: new Date( Date.now() - 30 * DAY ).toISOString() },
		{ label: 'up-to-date' },
	] );
	const { page } = await session.start( settings );
	await expect( ui.siteHeading( page, 'up-to-date' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the two sites that are not open say what is wrong with them
	// as part of their name, which is what a screen reader hears and what the
	// dot shows on hover (#94). The site with nothing to report has its name
	// alone.
	await expect( page.getByRole( 'button', { name: 'Update incomplete — code is new, built assets are old. unfinished', exact: true } ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'WordPress code is 30 days old — update to latest trunk. old-trunk', exact: true } ) ).toBeVisible();
	await expect( ui.sidebarEntry( page, 'up-to-date' ) ).toBeVisible();
} );

test( 'the sites list can be put away and brought back, and while it is away it cannot be reached at all', async ( { session } ) => {
	const { settings } = listedSites( session, [ { label: 'only-site' } ] );
	const { page } = await session.start( settings );
	const entry = ui.sidebarEntry( page, 'only-site' );
	await expect( entry ).toBeVisible( { timeout: 30_000 } );
	await expect( ui.createSiteButton( page ) ).toBeVisible();

	// INVARIANT — hidden, the list is gone for a screen reader and for the
	// keyboard too, and the open site is still there with the way to bring
	// the list back.
	await ui.hideSitesListButton( page ).click();
	await expect( entry ).toHaveCount( 0 );
	await expect( ui.createSiteButton( page ) ).toHaveCount( 0 );
	await expect( ui.siteHeading( page, 'only-site' ) ).toBeVisible();
	await expect( ui.hideSitesListButton( page ) ).toHaveCount( 0 );
	// The keyboard half: the list's button is still in the document, found
	// here as a hidden one, and it does not take focus when it is given it.
	const hiddenCreate = page.getByRole( 'button', { name: 'Create new site', exact: true, includeHidden: true } );
	await expect( hiddenCreate ).toHaveCount( 1 );
	await hiddenCreate.focus();
	await expect( hiddenCreate ).not.toBeFocused();

	// INVARIANT — and it comes back as it was.
	await ui.showSitesListButton( page ).click();
	await expect( entry ).toBeVisible();
	await expect( entry ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( ui.createSiteButton( page ) ).toBeVisible();
	await ui.createSiteButton( page ).focus();
	await expect( ui.createSiteButton( page ) ).toBeFocused();
} );

test( 'a window with no site in it has no list, says what to do, and keeps the footer', async ( { session } ) => {
	const { app, page } = await session.start();
	const opened = async () => app.evaluate( () => global.__e2eOpened );
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eOpened = [];
		ipcMain.removeHandler( 'url:open' );
		ipcMain.handle( 'url:open', ( event, url ) => {
			global.__e2eOpened.push( url );
			return true;
		} );
	} );

	// INVARIANT — there is nothing to list, so there is no list and no button
	// to hide one: the window says there are no sites and offers the one thing
	// to do about it.
	await expect( ui.noSitesTitle( page ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByRole( 'region', { name: 'My sites' } ) ).toHaveCount( 0 );
	await expect( ui.hideSitesListButton( page ) ).toHaveCount( 0 );
	await ui.createFirstSiteButton( page ).click();
	await expect( ui.createSiteDialog( page ) ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( ui.createSiteDialog( page ) ).toHaveCount( 0 );

	// INVARIANT — giving feedback is about the app, so it is there with no
	// site. It says where the form is and who reads it before anything is
	// opened, and then opens that form and nothing else.
	await ui.giveFeedbackButton( page ).click();
	const popover = page.locator( '.components-popover' );
	await expect( popover.getByText( 'Submissions are anonymous unless you add your email.', { exact: false } ) ).toBeVisible();
	expect( await opened() ).toEqual( [] );
	await popover.getByRole( 'button', { name: 'Open the feedback form ↗', exact: true } ).click();
	await expect.poll( opened ).toEqual( [ FEEDBACK_FORM ] );
	await expect( popover ).toHaveCount( 0 );
} );

test( 'the window opens at the size the shell is designed for, or the screen\'s if that is smaller, and cannot be made smaller than its page', async ( { session } ) => {
	const { app } = await session.start();
	const measured = await app.evaluate( ( { BrowserWindow, screen } ) => {
		const win = BrowserWindow.getAllWindows()[ 0 ];
		return { size: win.getSize(), minimum: win.getMinimumSize(), workArea: screen.getPrimaryDisplay().workAreaSize };
	} );

	// INVARIANT — as wide and as tall as designed (#555) where the screen has
	// the room, and never larger than the screen. The numbers are
	// `window-size.cjs`'s, whose unit tests hold the arithmetic; this is that
	// the window is given them.
	expect( measured.size ).toEqual( [ Math.min( 1280, measured.workArea.width ), Math.min( 800, measured.workArea.height ) ] );
	expect( measured.minimum ).toEqual( [ Math.min( 800, measured.size[ 0 ] ), Math.min( 600, measured.size[ 1 ] ) ] );
} );
