/**
 * The open site's header and its details (#556).
 *
 * The page's header is the window's, and what is in it is the open site's:
 * the button that shows and hides the site's details, and the site's menu,
 * which holds everything that is done to a site as a whole. The window leaves
 * a place in the header and the open site's view fills it, so the thing to
 * hold is that the header always acts on the site that is open, and on no
 * other.
 *
 * The details are the facts about the checkout that do not change while a
 * contributor works. They can be put away, and that is the window's choice,
 * not one site's: it stays as it was left when another site is opened. Put
 * away, they are out of reach of a screen reader and the keyboard too.
 *
 * What the menu offers and when is `site-menu.cjs`'s, held by its unit tests.
 * Renaming, updating and deleting from the menu are `rename-site.spec.js`,
 * `trunk-update.spec.js` and `engine.spec.js`. This is the rest: copying the
 * path, and opening the folder.
 *
 * Nothing is opened. The three handlers that look for applications, open the
 * folder in one and show it in the file manager are answered by stubs that
 * keep what they were asked, so the journey says the same on a machine with
 * no editor installed as on one with five. Copying is asked of a stand-in
 * too: the clipboard is the person's who runs the suite, so the page's write
 * to it is replaced by one that keeps the text. What that leaves out is the
 * clipboard itself refusing. The sites are folders with no checkout in them,
 * which is all the header and the details need of one.
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
const EDITOR = { name: 'Example Editor', path: path.join( os.tmpdir(), 'example-editor' ) };

// The button that puts the details away and the one that brings them back:
// one button, named by what pressing it does.
const hideDetailsButton = ( page ) => page.getByRole( 'button', { name: 'Hide details', exact: true } );
const showDetailsButton = ( page ) => page.getByRole( 'button', { name: 'Show details', exact: true } );
// The open site's details. A site that is not open has details too, in its
// hidden view, which this does not find.
const details = ( page, label ) => page.getByRole( 'complementary', { name: `Details of ${ label }`, exact: true } );

/**
 * Settings for an app that knows the given sites, oldest first, each a folder
 * of its own with a trunk recent enough to have nothing to report.
 *
 * @param {Object}   session
 * @param {Object[]} sites   `{ label, ...meta }`.
 * @return {{dirs: string[], settings: Object}}
 */
function listedSites( session, sites ) {
	const settings = { sites: [], siteMeta: {}, preferences: {} };
	const dirs = sites.map( ( { label, ...meta }, index ) => {
		const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );
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

/**
 * Stands in for the three handlers that touch other applications, and keeps
 * what each was asked. `openAnswer` is what opening a folder answers.
 *
 * @param {Object} app
 * @return {Promise<{asked: Function, answerOpenWith: Function}>}
 */
async function standInForApplications( app ) {
	await app.evaluate( ( { ipcMain }, editor ) => {
		const asked = { lists: 0, opens: [], shows: [] };
		global.__e2eApplications = asked;
		global.__e2eOpenAnswer = { ok: true };
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'editor:list', () => {
			asked.lists += 1;
			return { detected: [ editor ] };
		} );
		replace( 'editor:open', ( event, sitePath, editorPath ) => {
			asked.opens.push( { sitePath, editorPath } );
			return global.__e2eOpenAnswer;
		} );
		replace( 'dir:show', ( event, sitePath ) => {
			asked.shows.push( sitePath );
			return { ok: true };
		} );
	}, EDITOR );
	return {
		asked: () => app.evaluate( () => global.__e2eApplications ),
		answerOpenWith: ( answer ) => app.evaluate( ( electron, value ) => {
			global.__e2eOpenAnswer = value;
		}, answer ),
	};
}

// Replaces the page's write to the clipboard with one that keeps the text.
const standInForClipboard = ( page ) => page.evaluate( () => {
	window.__e2eCopied = [];
	navigator.clipboard.writeText = async ( text ) => {
		window.__e2eCopied.push( text );
	};
} );
const copied = ( page ) => page.evaluate( () => window.__e2eCopied );

test( 'the header\'s menu acts on the site that is open: it copies that site\'s path and opens that site\'s folder', async ( { session } ) => {
	const { dirs, settings } = listedSites( session, [ { label: 'older-site' }, { label: 'newer-site' } ] );
	const [ olderDir, newerDir ] = dirs;
	const { app, page } = await session.start( settings );
	const applications = await standInForApplications( app );
	await standInForClipboard( page );
	await expect( ui.siteHeading( page, 'newer-site' ) ).toBeVisible( { timeout: 30_000 } );
	const menu = page.getByRole( 'menu', { name: 'Site actions' } );

	// INVARIANT — the menu looks for applications as it opens, offers each by
	// name, and always offers the way to choose another.
	await ui.siteMenuButton( page ).click();
	await expect( menu.getByRole( 'menuitem', { name: `Open in ${ EDITOR.name }`, exact: true } ) ).toBeVisible();
	await expect( menu.getByRole( 'menuitem', { name: 'Open in other application…', exact: true } ) ).toBeVisible();
	expect( ( await applications.asked() ).lists ).toBe( 1 );

	// INVARIANT — copying the path puts the open site's path on the
	// clipboard, and says so where it will be seen with the menu gone.
	await menu.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	await expect( page.getByTestId( 'snackbar' ).filter( { hasText: 'Copied the path' } ) ).toBeVisible();
	expect( await copied( page ) ).toEqual( [ newerDir ] );
	await expect( menu ).toHaveCount( 0 );

	// INVARIANT — opening in a named application asks for this site's folder
	// in that application; "other application" asks with none named, which is
	// what makes the main process ask which.
	await ui.siteMenuButton( page ).click();
	await menu.getByRole( 'menuitem', { name: `Open in ${ EDITOR.name }`, exact: true } ).click();
	await expect.poll( async () => ( await applications.asked() ).opens ).toEqual( [ { sitePath: newerDir, editorPath: EDITOR.path } ] );
	await ui.siteMenuButton( page ).click();
	await menu.getByRole( 'menuitem', { name: 'Open in other application…', exact: true } ).click();
	await expect.poll( async () => ( await applications.asked() ).opens ).toEqual( [
		{ sitePath: newerDir, editorPath: EDITOR.path },
		{ sitePath: newerDir, editorPath: null },
	] );

	// INVARIANT — with another site open, the same header acts on that one.
	await ui.sidebarEntry( page, 'older-site' ).click();
	await expect( ui.siteHeading( page, 'older-site' ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'Site actions', exact: true } ) ).toHaveCount( 1 );
	await ui.siteMenuButton( page ).click();
	// CHARACTERISATION — the file manager's name is the platform's.
	await menu.getByRole( 'menuitem', { name: /^Show in (Finder|Explorer|file manager)$/ } ).click();
	await expect.poll( async () => ( await applications.asked() ).shows ).toEqual( [ olderDir ] );
	await ui.siteMenuButton( page ).click();
	await menu.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	await expect.poll( () => copied( page ) ).toEqual( [ newerDir, olderDir ] );
} );

test( 'an application that will not open the folder says why on the page, with the way to choose another', async ( { session } ) => {
	const { dirs, settings } = listedSites( session, [ { label: 'only-site' } ] );
	const { app, page } = await session.start( settings );
	const applications = await standInForApplications( app );
	await expect( ui.siteHeading( page, 'only-site' ) ).toBeVisible( { timeout: 30_000 } );
	await applications.answerOpenWith( { ok: false, reason: 'unlaunchable-editor' } );

	// INVARIANT — the menu is gone by the time the answer comes, so the
	// refusal is said on the page, and it carries the way out with it.
	await ui.siteMenuButton( page ).click();
	await page.getByRole( 'menuitem', { name: `Open in ${ EDITOR.name }`, exact: true } ).click();
	const refusal = page.getByRole( 'alert' ).filter( { hasText: 'That application is no longer where it was. Choose another.' } );
	await expect( refusal ).toBeVisible();
	await applications.answerOpenWith( { ok: true } );
	await refusal.getByRole( 'button', { name: 'Choose application…', exact: true } ).click();
	await expect.poll( async () => ( await applications.asked() ).opens ).toEqual( [
		{ sitePath: dirs[ 0 ], editorPath: EDITOR.path },
		{ sitePath: dirs[ 0 ], editorPath: null },
	] );
	// INVARIANT — and once an open has worked, the refusal is gone.
	await expect( refusal ).toHaveCount( 0 );
} );

test( 'the details say what the checkout is, copy its path, and can be put away for every site at once', async ( { session } ) => {
	const { dirs, settings } = listedSites( session, [
		{ label: 'old-trunk', projectType: 'gutenberg', trunkDate: new Date( Date.now() - 30 * DAY ).toISOString() },
		{ label: 'fresh-site' },
	] );
	const [ oldDir, freshDir ] = dirs;
	const { page } = await session.start( settings );
	await standInForClipboard( page );
	await expect( ui.siteHeading( page, 'fresh-site' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the details are the open site's: its folder, its project,
	// and that its setup is done. A recent trunk has no age to report.
	const fresh = details( page, 'fresh-site' );
	await expect( fresh.getByRole( 'heading', { name: 'Details', exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( freshDir, { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( 'WordPress Core', { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( 'Initialized', { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( /days? old$/ ) ).toHaveCount( 0 );

	// INVARIANT — their button copies the path and says so itself, for the
	// moment it takes to notice.
	await fresh.getByRole( 'button', { name: 'Copy', exact: true } ).click();
	await expect( fresh.getByRole( 'button', { name: 'Copied', exact: true } ) ).toBeVisible();
	expect( await copied( page ) ).toEqual( [ freshDir ] );
	await expect( fresh.getByRole( 'button', { name: 'Copy', exact: true } ) ).toBeVisible();

	// INVARIANT — another site's details are that site's, and an old trunk
	// says how old.
	await ui.sidebarEntry( page, 'old-trunk (WordPress code is 30 days old — update to latest trunk)' ).click();
	await expect( ui.siteHeading( page, 'old-trunk' ) ).toBeVisible();
	const old = details( page, 'old-trunk' );
	await expect( old.getByText( oldDir, { exact: true } ) ).toBeVisible();
	await expect( old.getByText( 'Gutenberg', { exact: true } ) ).toBeVisible();
	await expect( old.getByText( '30 days old', { exact: true } ) ).toBeVisible();
	await expect( fresh ).toHaveCount( 0 );

	// INVARIANT — put away, the details are gone for a screen reader and for
	// the keyboard, the button says they are closed, and what it names is
	// still there to be brought back.
	await expect( hideDetailsButton( page ) ).toHaveAttribute( 'aria-expanded', 'true' );
	const controlled = await hideDetailsButton( page ).getAttribute( 'aria-controls' );
	expect( controlled ).toBeTruthy();
	await expect( page.locator( `[id="${ controlled }"]` ).getByRole( 'complementary' ) ).toBeVisible();
	await hideDetailsButton( page ).click();
	await expect( showDetailsButton( page ) ).toHaveAttribute( 'aria-expanded', 'false' );
	await expect( old ).toHaveCount( 0 );
	const hiddenCopy = page.locator( `[id="${ controlled }"]` ).getByRole( 'button', { name: 'Copy', exact: true, includeHidden: true } );
	await expect( hiddenCopy ).toHaveCount( 1 );
	await hiddenCopy.focus();
	await expect( hiddenCopy ).not.toBeFocused();

	// INVARIANT — it is the window's choice and not one site's: the other
	// site opens with its details put away too, and bringing them back there
	// brings them back here.
	await ui.sidebarEntry( page, 'fresh-site' ).click();
	await expect( ui.siteHeading( page, 'fresh-site' ) ).toBeVisible();
	await expect( fresh ).toHaveCount( 0 );
	await showDetailsButton( page ).click();
	await expect( fresh ).toBeVisible();
	await ui.sidebarEntry( page, 'old-trunk (WordPress code is 30 days old — update to latest trunk)' ).click();
	await expect( old ).toBeVisible();
} );
