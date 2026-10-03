/**
 * Renaming a site, through the dialog a contributor uses (#553, #557).
 *
 * The name is what tells two checkouts of the same repository apart, and it is
 * shown in two places that have to agree: the sidebar and the heading of the
 * open site. That the name survives a restart is `engine.spec.js`'s claim, made
 * there through the same handler; this is the half only the interface can
 * show, that the dialog writes the name a contributor typed, where they will
 * look for it, and nothing when they back out.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

/**
 * The site's name as the main process holds it, asked for after whatever the
 * test just did. A write the dialog should not have made would have been sent
 * before this question, and the main process answers in the order it is asked,
 * so the name read here is the name after that write. Reading the settings
 * file straight after a click would only show that the write had not landed
 * yet.
 *
 * @param {Object} page
 * @param {string} dir
 * @return {Promise<string>} The label.
 */
const storedName = ( page, dir ) => page.evaluate( async ( sitePath ) => ( await window.api.getSitesWithMeta() ).siteMeta[ sitePath ].label, dir );

test( 'the rename dialog changes the name in the sidebar and the heading, refuses an empty one, and writes nothing when it is closed', async ( { session } ) => {
	const site = await makeSite( session, { label: 'first-name' } );
	const { page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'first-name' ) ).toBeVisible( { timeout: 30_000 } );

	// Renaming is in the site's menu, in the page's header (#556).
	const openDialog = { click: async () => {
		await ui.siteMenuButton( page ).click();
		await page.getByRole( 'menuitem', { name: 'Rename…', exact: true } ).click();
	} };
	const dialog = page.getByRole( 'dialog', { name: 'Rename site', exact: true } );
	const field = dialog.getByLabel( 'Site name', { exact: true } );
	const rename = dialog.getByRole( 'button', { name: 'Rename', exact: true } );

	// INVARIANT — the dialog opens on the name the site has, ready to be typed
	// over: the field holds it, has the focus, and the whole name is selected,
	// so the first key pressed replaces it.
	await openDialog.click();
	await expect( field ).toHaveValue( 'first-name' );
	await expect( field ).toBeFocused();
	expect( await field.evaluate( ( input ) => [ input.selectionStart, input.selectionEnd ] ) ).toEqual( [ 0, 'first-name'.length ] );

	// INVARIANT — a name of nothing but spaces is refused where it was typed, and
	// the dialog stays open to be corrected. The site behind it cannot be read
	// by role while a dialog is up; that it kept its name is asserted once this
	// one is closed, below.
	await field.fill( '   ' );
	await rename.click();
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( 'Site name cannot be empty.' );
	expect( await storedName( page, site.dir ) ).toBe( 'first-name' );

	// INVARIANT — backing out writes nothing, gives the focus back to the
	// menu's button, and what was typed is not kept for the next time the
	// dialog opens.
	await field.fill( 'abandoned-name' );
	await ui.closeDialogButton( dialog ).click();
	await expect( dialog ).toHaveCount( 0 );
	await expect( ui.siteMenuButton( page ) ).toBeFocused();
	expect( await storedName( page, site.dir ) ).toBe( 'first-name' );
	await expect( ui.siteHeading( page, 'first-name' ) ).toBeVisible();
	await openDialog.click();
	await expect( field ).toHaveValue( 'first-name' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );

	// INVARIANT — renaming closes the dialog and the new name is in both places
	// a contributor reads it. It is typed with spaces around it, which neither
	// the dialog nor the main process keeps. Enter in the field renames as the
	// button does.
	await field.fill( '  second-name  ' );
	await field.press( 'Enter' );
	await expect( dialog ).toHaveCount( 0 );
	await expect( ui.siteHeading( page, 'second-name' ) ).toBeVisible();
	await expect( ui.sidebarEntry( page, 'second-name' ) ).toBeVisible();
	await expect( ui.siteHeading( page, 'first-name' ) ).toHaveCount( 0 );

	// CHARACTERISATION — the name is the site's label in the store.
	expect( session.readSettings().siteMeta[ site.dir ].label ).toBe( 'second-name' );

	// INVARIANT — the next time the dialog opens it starts from the new name.
	await openDialog.click();
	await expect( field ).toHaveValue( 'second-name' );
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );
} );

test( 'while a name is being written the dialog waits for the answer, and a name that could not be written is said in the dialog and can be tried again', async ( { session } ) => {
	const site = await makeSite( session, { label: 'first-name' } );
	const { app, page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'first-name' ) ).toBeVisible( { timeout: 30_000 } );
	// The write itself, held until the test says how it ends: refused, or let
	// through to the real handler.
	await app.evaluate( ( { ipcMain } ) => {
		const real = ipcMain._invokeHandlers.get( 'sites:set-label' );
		ipcMain.removeHandler( 'sites:set-label' );
		ipcMain.handle( 'sites:set-label', ( ...args ) => new Promise( ( resolve, reject ) => {
			global.__e2eAskedNames = ( global.__e2eAskedNames || [] ).concat( [ args[ 2 ] ] );
			global.__e2eEndRename = ( refusal ) => ( refusal ? reject( new Error( refusal ) ) : resolve( real( ...args ) ) );
		} ) );
	} );
	const askedNames = () => app.evaluate( () => global.__e2eAskedNames || [] );
	const endRename = ( refusal ) => app.evaluate( ( electron, text ) => global.__e2eEndRename( text ), refusal );
	const dialog = page.getByRole( 'dialog', { name: 'Rename site', exact: true } );
	const field = dialog.getByLabel( 'Site name', { exact: true } );
	const rename = dialog.getByRole( 'button', { name: 'Rename', exact: true } );

	await ui.siteMenuButton( page ).click();
	await page.getByRole( 'menuitem', { name: 'Rename…', exact: true } ).click();
	await field.fill( '  second-name  ' );
	await rename.click();

	// INVARIANT — the name is asked for without the spaces around it. The
	// main process would take them off too, and the page shows a name without
	// them either way: what is pinned here is what the dialog sends.
	await expect.poll( askedNames ).toEqual( [ 'second-name' ] );

	// INVARIANT — while the answer is awaited the dialog is held, so that the
	// answer has somewhere to arrive: nothing in it can be changed or pressed
	// a second time, and neither Escape nor a press outside closes it. It
	// has no button that would.
	await expect( rename ).toBeDisabled();
	await expect( field ).toBeDisabled();
	await expect( ui.closeDialogButton( dialog ) ).toHaveCount( 0 );
	await page.keyboard.press( 'Escape' );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( dialog ).toHaveAttribute( 'data-open', '' );
	await page.mouse.click( 5, 5 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( dialog ).toHaveAttribute( 'data-open', '' );

	// INVARIANT — a name that could not be written is said in the dialog, as
	// an alert, with what was typed still in the field, and the site keeps
	// the name it had.
	await endRename( 'the settings file could not be written' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( /the settings file could not be written/ );
	await expect( field ).toHaveValue( '  second-name  ' );
	await expect( field ).toBeEnabled();
	await expect( ui.closeDialogButton( dialog ) ).toBeVisible();
	expect( session.readSettings().siteMeta[ site.dir ].label ).toBe( 'first-name' );

	// INVARIANT — and it can be tried again from there, which takes the
	// complaint away and, once the write goes through, renames the site.
	await rename.click();
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );
	await endRename( '' );
	await expect( dialog ).toHaveCount( 0 );
	await expect( ui.siteHeading( page, 'second-name' ) ).toBeVisible();
	expect( session.readSettings().siteMeta[ site.dir ].label ).toBe( 'second-name' );
} );
