/**
 * The settings dialog (#559): where it opens from, and the two things it
 * holds in its first form: the folder new sites go in, and who the
 * contributor is.
 *
 * What a setting accepts is settings.cjs's subject, and what the handlers do
 * with the store is ipc-wiring's. This file is about the window: that the
 * dialog opens from the footer and from the menu, that what is chosen in it
 * is what the app then holds and uses, and that a refusal is said where it
 * was made.
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

const openFromMenu = ( app ) => app.evaluate( ( { Menu } ) => Menu.getApplicationMenu().getMenuItemById( 'settings' ).click() );

test( 'the folder new sites go in is chosen in the settings, used by the create-site dialog, and can be forgotten', async ( { session } ) => {
	const parent = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-parent-' ) ) );
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );

	// INVARIANT — the footer's cog opens the dialog, on General, and with no
	// folder set the dialog says so and that the create-site dialog asks.
	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	await expect( dialog ).toBeVisible();
	await expect( ui.settingsTab( page, 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
	const notSet = dialog.getByText( 'Not set: the create-site dialog asks each time.', { exact: true } );
	await expect( notSet ).toBeVisible();
	await expect( dialog.getByRole( 'button', { name: 'Forget this folder', exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — a folder chosen is shown, kept, and offered to be forgotten.
	await session.answerFileDialog( [ parent ] );
	const field = dialog.getByLabel( 'New sites go here', { exact: true } );
	await field.press( 'Enter' );
	await expect( dialog.getByText( parent, { exact: true } ) ).toBeVisible();
	await expect( notSet ).toHaveCount( 0 );
	await expect.poll( () => session.readSettings().preferences?.newSiteLocation ).toBe( parent );
	await expect( dialog.getByRole( 'button', { name: 'Forget this folder', exact: true } ) ).toBeVisible();

	// INVARIANT — a folder that is not there is refused where it was chosen,
	// with the words main gives, and the one kept stays.
	await session.answerFileDialog( [ path.join( parent, 'gone' ) ] );
	await field.press( 'Enter' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( 'That folder does not exist.' );
	await expect( dialog.getByText( parent, { exact: true } ) ).toBeVisible();
	expect( session.readSettings().preferences.newSiteLocation ).toBe( parent );

	// INVARIANT — the create-site dialog starts on that folder, and still
	// lets another be chosen.
	await ui.closeDialogButton( dialog ).click();
	await expect( dialog ).toHaveCount( 0 );
	await ui.createSiteButton( page ).click();
	const create = ui.createSiteDialog( page );
	await expect( create ).toBeVisible();
	await expect( create.getByText( parent, { exact: true } ) ).toBeVisible();
	await expect( create.getByText( 'No folder selected yet.', { exact: true } ) ).toHaveCount( 0 );
	const other = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-other-' ) ) );
	await session.answerFileDialog( [ other ] );
	await create.getByLabel( 'Location', { exact: true } ).press( 'Enter' );
	await expect( create.getByText( other, { exact: true } ) ).toBeVisible();
	await ui.closeDialogButton( create ).click();
	await expect( create ).toHaveCount( 0 );
	// Choosing another for one site did not change the setting.
	expect( session.readSettings().preferences.newSiteLocation ).toBe( parent );

	// INVARIANT — the menu's Settings… opens the same dialog, and forgetting
	// the folder puts both dialogs back as they were.
	await openFromMenu( app );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByText( parent, { exact: true } ) ).toBeVisible();
	await dialog.getByRole( 'button', { name: 'Forget this folder', exact: true } ).click();
	await expect( notSet ).toBeVisible();
	await expect.poll( () => session.readSettings().preferences?.newSiteLocation ).toBe( null );
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );
	await ui.createSiteButton( page ).click();
	await expect( create.getByText( 'No folder selected yet.', { exact: true } ) ).toBeVisible();
	await expect( create.getByText( parent, { exact: true } ) ).toHaveCount( 0 );
} );

test( 'the Account tab remembers who the contributor is the way the mentor handoff does, and shows the GitHub account', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// An account signed in, as the review dialog would have left it.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'github:account' );
		ipcMain.handle( 'github:account', () => ( { ok: true, login: 'janedoe', configured: true, testMode: null } ) );
		ipcMain.removeHandler( 'github:sign-out' );
		ipcMain.handle( 'github:sign-out', () => { global.__e2eSignedOut = ( global.__e2eSignedOut || 0 ) + 1; return { ok: true }; } );
	} );

	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	await ui.settingsTab( page, 'Account' ).click();
	const username = dialog.getByLabel( 'WordPress.org username', { exact: true } );
	const event = dialog.getByLabel( 'Event', { exact: true } );
	const save = dialog.getByRole( 'button', { name: 'Save', exact: true } );
	await expect( username ).toHaveValue( '' );

	// INVARIANT — a username that is not one is refused with the handoff's
	// words, as an alert, and nothing is kept.
	await username.fill( 'jane doe' );
	await save.click();
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( 'Enter your WordPress.org username, like janedoe, or your profiles.wordpress.org URL.' );
	expect( session.readSettings().preferences?.wporgHandle ).toBeUndefined();

	// INVARIANT — a profile link is kept as the username it names, the event
	// with it, and the dialog says it saved. Enter in a field saves as the
	// button does.
	await username.fill( 'https://profiles.wordpress.org/JaneDoe/' );
	await event.fill( 'WordCamp Europe 2026' );
	await event.press( 'Enter' );
	await expect( dialog.getByRole( 'status' ) ).toHaveText( 'Saved.' );
	await expect( username ).toHaveValue( 'janedoe' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );
	await expect.poll( () => session.readSettings().preferences ).toMatchObject( { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Europe 2026' } );

	// INVARIANT — an emptied event is forgotten, and the username stays.
	await event.fill( '' );
	await save.click();
	await expect( dialog.getByRole( 'status' ) ).toHaveText( 'Saved.' );
	await expect.poll( () => session.readSettings().preferences ).toMatchObject( { wporgHandle: 'janedoe', contributionEvent: null } );

	// INVARIANT — the GitHub account is named, and signing out here asks
	// main to forget it and says so.
	await expect( dialog.getByText( 'Signed in as janedoe.', { exact: true } ) ).toBeVisible();
	await dialog.getByRole( 'button', { name: 'Sign out', exact: true } ).click();
	await expect( dialog.getByText( 'Not signed in. The app asks you to sign in when you open a pull request.', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByRole( 'button', { name: 'Sign out', exact: true } ) ).toHaveCount( 0 );
	expect( await app.evaluate( () => global.__e2eSignedOut ) ).toBe( 1 );

	// INVARIANT — opened again, the dialog is on General and the Account tab
	// shows what was kept, not what was typed.
	await ui.closeDialogButton( dialog ).click();
	await expect( dialog ).toHaveCount( 0 );
	await ui.settingsButton( page ).click();
	await expect( ui.settingsTab( page, 'General' ) ).toHaveAttribute( 'aria-selected', 'true' );
	await ui.settingsTab( page, 'Account' ).click();
	await expect( username ).toHaveValue( 'janedoe' );
	await expect( event ).toHaveValue( '' );
} );
