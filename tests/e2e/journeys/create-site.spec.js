/**
 * The dialog a site is created from (#553, #557).
 *
 * Three answers and a button: what the site is called, which project it is a
 * checkout of, and where it goes. Everything after the button is a clone that
 * takes minutes, on the say-so of what this dialog sent, so what it sends has
 * to be what the contributor chose, and it has to refuse to send anything
 * while an answer is missing.
 *
 * The setup itself is not run here. The handler that starts it is replaced by
 * one that records what it was asked for and then waits to be told to fail,
 * which is how the test sees the app while a setup is under way and when one
 * goes wrong. The real thing, clone and install and build, is
 * `tests/e2e/real-setup/create-site.spec.js`, run by hand.
 *
 * The site the app opens on is one the old engine made, for its notice: that
 * notice has the dialog's other door, a "Create site" button that works while
 * a setup is running, which the sidebar's does not.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );
const { projectHelp } = require( '../../../src/renderer/create-site.cjs' );

test( 'the create-site dialog refuses a missing name or location, starts clean each time, sends the setup what was chosen, and says why a setup failed', async ( { session } ) => {
	const parent = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-parent-' ) ) );
	const oldSite = await makeSite( session, { label: 'old-engine-site', legacy: true } );
	const { app, page } = await session.start( oldSite.settings );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'wordpress:setup' );
		ipcMain.handle( 'wordpress:setup', ( event, dir, options ) => {
			global.__e2eSetupCalls = ( global.__e2eSetupCalls || [] ).concat( [ { dir, options } ] );
			return new Promise( ( resolve, reject ) => {
				global.__e2eFailSetup = ( message ) => reject( new Error( message ) );
			} );
		} );
	} );
	const setupCalls = () => app.evaluate( () => global.__e2eSetupCalls || [] );
	const failSetup = ( message ) => app.evaluate( ( electron, text ) => global.__e2eFailSetup( text ), message );
	await session.answerFileDialog( [ parent ] );

	const dialog = ui.createSiteDialog( page );
	const name = dialog.getByLabel( 'Site name', { exact: true } );
	const location = dialog.getByLabel( 'Location', { exact: true } );
	const core = dialog.getByRole( 'radio', { name: 'WordPress Core', exact: true } );
	const gutenberg = dialog.getByRole( 'radio', { name: 'Gutenberg', exact: true } );
	const create = dialog.getByRole( 'button', { name: 'Create site', exact: true } );

	// INVARIANT — the dialog opens empty, on the name, with Core chosen and no
	// folder, and says of the project that is chosen what it is and that the
	// choice is for good.
	await ui.createSiteButton( page ).click();
	await expect( name ).toBeFocused();
	await expect( name ).toHaveValue( '' );
	await expect( core ).toBeChecked();
	await expect( dialog.getByText( 'No folder selected yet.', { exact: true } ) ).toBeVisible();
	const projects = dialog.getByRole( 'radiogroup', { name: 'Project', exact: true } );
	await expect( projects ).toHaveAccessibleDescription( `${ projectHelp( 'core' ).about } ${ projectHelp( 'core' ).lasting }` );
	expect( projectHelp( 'core' ).lasting ).toBe( 'A site’s project cannot be changed later.' );

	// INVARIANT — it says which answer is missing, one at a time, as an
	// alert, and starts nothing while one is: a name of spaces is no name.
	// Enter in the name asks for the site as the button does.
	await name.fill( '   ' );
	await create.click();
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( 'Please provide a site name.' );
	await name.fill( 'Abandoned site' );
	await name.press( 'Enter' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( 'Please choose where to create the site.' );
	expect( await setupCalls() ).toEqual( [] );

	// INVARIANT — choosing a folder shows the folder and takes the complaint
	// about it away.
	await location.press( 'Enter' );
	await expect( dialog.getByText( parent, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( 'Please choose where to create the site.', { exact: true } ) ).toHaveCount( 0 );
	await gutenberg.click();
	await expect( gutenberg ).toBeChecked();
	await expect( projects ).toHaveAccessibleDescription( `${ projectHelp( 'gutenberg' ).about } ${ projectHelp( 'gutenberg' ).lasting }` );

	// INVARIANT — backing out starts nothing, gives the focus back to the
	// button the dialog was opened from, and the next time the dialog opens
	// none of it is still there: not the name, the folder, or the project.
	await ui.closeDialogButton( dialog ).click();
	await expect( dialog ).toHaveCount( 0 );
	await expect( ui.createSiteButton( page ) ).toBeFocused();
	expect( await setupCalls() ).toEqual( [] );
	await ui.createSiteButton( page ).click();
	await expect( name ).toHaveValue( '' );

	// INVARIANT — nor is it there when the dialog is opened again at once,
	// while the one that was closed is still fading: Escape, and Enter on
	// the button the focus went back to.
	await name.fill( 'Left behind' );
	await page.keyboard.press( 'Escape' );
	await expect( ui.createSiteButton( page ) ).toBeFocused();
	await page.keyboard.press( 'Enter' );
	await expect( dialog ).toHaveAttribute( 'data-open', '' );
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
		options: { siteName: 'My-Gutenberg-fix', siteLabel: 'My Gutenberg fix', projectType: 'gutenberg' },
	} ] );

	// INVARIANT — while that setup runs the app shows that it is running and
	// will not start a second one: not from the sidebar, and not from the
	// dialog's other door, which opens it with nothing in it to press.
	await expect( page.getByText( 'Setting up new site…', { exact: true } ) ).toBeVisible();
	await expect( ui.createSiteButton( page ) ).toBeDisabled();
	await ui.sidebarEntry( page, 'old-engine-site' ).click();
	await page.getByRole( 'button', { name: 'Create site', exact: true } ).click();
	await expect( create ).toBeDisabled();
	await expect( name ).toBeDisabled();
	await expect( core ).toBeDisabled();
	await expect( location ).toBeDisabled();

	// INVARIANT — a press on the held button does nothing. One that got
	// through would be answered by the form, which has no name in it: that
	// it has nothing to say, a round trip later, is what shows the press
	// went nowhere.
	await create.click( { force: true } );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );
	expect( await setupCalls() ).toHaveLength( 1 );

	// CHARACTERISATION — and it stays until the setup has ended, as it did
	// before it was redrawn: it has no button that closes it, and neither
	// Escape nor a press outside it does. A dialog that is closing is still
	// on the page while it fades, so it is asked whether it is open, and
	// not whether it can be seen.
	await expect( ui.closeDialogButton( dialog ) ).toHaveCount( 0 );
	await page.keyboard.press( 'Escape' );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( dialog ).toHaveAttribute( 'data-open', '' );
	await page.mouse.click( 5, 5 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( dialog ).toHaveAttribute( 'data-open', '' );

	// INVARIANT — when the setup fails, the dialog that is open says why, and
	// can be used again. It is the one place in the window that says it.
	await failSetup( 'the clone could not reach the network' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( /the clone could not reach the network/ );
	await expect( create ).toBeEnabled();
	await expect( name ).toBeEnabled();
	expect( await setupCalls() ).toHaveLength( 1 );

	// INVARIANT — and can be closed again, by Escape as by its button.
	await expect( ui.closeDialogButton( dialog ) ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );
} );
