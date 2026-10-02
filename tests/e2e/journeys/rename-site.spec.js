/**
 * Renaming a site, through the dialog a contributor uses (#553).
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

test( 'the rename dialog changes the name in the sidebar and the heading, refuses an empty one, and writes nothing when cancelled', async ( { session } ) => {
	const site = await makeSite( session, { label: 'first-name' } );
	const { page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'first-name' ) ).toBeVisible( { timeout: 30_000 } );

	// Renaming is in the site's menu, in the page's header (#556).
	const openDialog = { click: async () => {
		await ui.siteMenuButton( page ).click();
		await page.getByRole( 'menuitem', { name: 'Rename…', exact: true } ).click();
	} };
	const dialog = page.getByRole( 'dialog', { name: 'Rename site' } );
	const field = dialog.getByLabel( 'Site name' );

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
	await dialog.getByRole( 'button', { name: 'Save', exact: true } ).click();
	await expect( dialog.getByText( 'Site name cannot be empty.', { exact: true } ) ).toBeVisible();
	expect( await storedName( page, site.dir ) ).toBe( 'first-name' );

	// INVARIANT — backing out writes nothing, and what was typed is not kept for
	// the next time the dialog opens.
	await field.fill( 'abandoned-name' );
	await dialog.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
	await expect( dialog ).toHaveCount( 0 );
	expect( await storedName( page, site.dir ) ).toBe( 'first-name' );
	await expect( ui.siteHeading( page, 'first-name' ) ).toBeVisible();
	await openDialog.click();
	await expect( field ).toHaveValue( 'first-name' );
	await expect( dialog.getByText( 'Site name cannot be empty.', { exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — saving closes the dialog and the new name is in both places a
	// contributor reads it. It is typed with spaces around it, which neither the
	// dialog nor the main process keeps.
	await field.fill( '  second-name  ' );
	await dialog.getByRole( 'button', { name: 'Save', exact: true } ).click();
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
