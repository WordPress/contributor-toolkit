/**
 * The dialog a site is created from (#553).
 *
 * Three answers and a button: what the site is called, which project it is a
 * checkout of, and where it goes. Everything after the button is a clone that
 * takes minutes, on the say-so of what this dialog sent, so what it sends has
 * to be what the contributor chose, and it has to refuse to send anything
 * while an answer is missing.
 *
 * The setup itself is not run here. The handler that starts it is replaced by
 * one that records what it was asked for and never finishes, which is also
 * how the test sees the app while a setup is under way. The real thing, clone
 * and install and build, is `tests/e2e/real-setup/create-site.spec.js`, run by
 * hand.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { sanitizeSiteFolder } = require( '../../../src/renderer/site-folder.cjs' );

test( 'the create-site dialog refuses a missing name or location, starts clean each time, and sends the setup what was chosen', async ( { session } ) => {
	const parent = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-parent-' ) ) );
	const { app, page } = await session.start();
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'wordpress:setup' );
		ipcMain.handle( 'wordpress:setup', ( event, dir, options ) => {
			global.__e2eSetupCalls = ( global.__e2eSetupCalls || [] ).concat( [ { dir, options } ] );
			return new Promise( () => {} );
		} );
	} );
	const setupCalls = () => app.evaluate( () => global.__e2eSetupCalls || [] );
	await session.answerFileDialog( [ parent ] );

	const dialog = ui.createSiteDialog( page );
	const name = dialog.getByLabel( 'Site name', { exact: true } );
	const location = dialog.getByLabel( 'Site location', { exact: true } );
	const core = dialog.getByRole( 'radio', { name: 'WordPress Core', exact: true } );
	const gutenberg = dialog.getByRole( 'radio', { name: 'Gutenberg', exact: true } );
	const create = dialog.getByRole( 'button', { name: 'Create site', exact: true } );

	// INVARIANT — the dialog opens empty, on the name, with Core chosen and no
	// folder.
	await ui.createSiteButton( page ).click();
	await expect( name ).toBeFocused();
	await expect( name ).toHaveValue( '' );
	await expect( core ).toBeChecked();
	await expect( dialog.getByText( 'No folder selected yet.', { exact: true } ) ).toBeVisible();

	// INVARIANT — it says which answer is missing, one at a time, and starts
	// nothing while one is: a name of spaces is no name.
	await name.fill( '   ' );
	await create.click();
	await expect( dialog.getByText( 'Please provide a site name.', { exact: true } ) ).toBeVisible();
	await name.fill( 'Abandoned site' );
	await create.click();
	await expect( dialog.getByText( 'Please choose where to create the site.', { exact: true } ) ).toBeVisible();
	expect( await setupCalls() ).toEqual( [] );

	// INVARIANT — choosing a folder shows the folder and takes the complaint
	// about it away.
	await location.press( 'Enter' );
	await expect( dialog.getByText( parent, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( 'Please choose where to create the site.', { exact: true } ) ).toHaveCount( 0 );
	await gutenberg.click();
	await expect( gutenberg ).toBeChecked();

	// INVARIANT — backing out starts nothing, and the next time the dialog
	// opens none of it is still there: not the name, the folder, or the
	// project.
	await dialog.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
	await expect( dialog ).toHaveCount( 0 );
	expect( await setupCalls() ).toEqual( [] );
	await ui.createSiteButton( page ).click();
	await expect( name ).toHaveValue( '' );
	await expect( core ).toBeChecked();
	await expect( dialog.getByText( 'No folder selected yet.', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( parent, { exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — the setup is asked for exactly what was chosen: the folder
	// picked, the name as typed without the spaces around it, the folder name
	// made from it, and the project. Once, and the dialog closes.
	await name.fill( '  My Gutenberg fix  ' );
	await location.press( 'Enter' );
	await gutenberg.click();
	await create.click();
	await expect( dialog ).toHaveCount( 0 );
	await expect.poll( setupCalls ).toEqual( [ {
		dir: parent,
		options: { siteName: sanitizeSiteFolder( 'My Gutenberg fix' ), siteLabel: 'My Gutenberg fix', projectType: 'gutenberg' },
	} ] );

	// INVARIANT — while that setup runs the app shows that it is running and
	// will not start a second one.
	await expect( page.getByText( 'Setting up new site…', { exact: true } ) ).toBeVisible();
	await expect( ui.createSiteButton( page ) ).toBeDisabled();
} );
