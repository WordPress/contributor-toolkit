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
const { pseudoLocalize } = require( '../../../src/renderer/pseudo-locale.cjs' );

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

test( 'the language set in the settings is the one the app starts in, and a change offers the relaunch that applies it', async ( { session } ) => {
	// The pseudo-locale, set as a contributor would set a language: in the
	// store, with no --lang to override it. It needs no catalog, so the build
	// under test need not ship one.
	const site = await makeSite( session );
	const { app, page } = await session.start( { ...site.settings, preferences: { locale: 'en-XA' } }, { lang: false } );
	await expect( page.locator( 'html' ) ).toHaveAttribute( 'lang', 'en-XA', { timeout: 30_000 } );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'app:relaunch' );
		ipcMain.handle( 'app:relaunch', () => { global.__e2eRelaunches = ( global.__e2eRelaunches || 0 ) + 1; return { ok: true }; } );
	} );

	// INVARIANT — the control shows the language that is set, even one the
	// build has no catalog for, and offers no relaunch while nothing changed.
	await page.getByRole( 'button', { name: pseudoLocalize( 'Settings' ), exact: true } ).click();
	const dialog = page.getByRole( 'dialog', { name: pseudoLocalize( 'Settings' ), exact: true } );
	const language = dialog.getByRole( 'combobox', { name: pseudoLocalize( 'Language' ), exact: true } );
	await expect( language ).toHaveText( 'en-XA' );
	await expect( dialog.getByRole( 'button', { name: pseudoLocalize( 'Relaunch now' ), exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — a language chosen is kept at once, and the dialog says the
	// window is not in it yet and offers the relaunch, which asks main.
	await language.click();
	await page.getByRole( 'option', { name: 'English', exact: true } ).click();
	await expect( language ).toHaveText( 'English' );
	await expect.poll( () => session.readSettings().preferences?.locale ).toBe( 'en' );
	await expect( dialog.getByRole( 'status' ) ).toContainText( pseudoLocalize( 'The app shows the new language once it has relaunched. Running servers and builds stop, as they do when the app quits.' ) );
	await dialog.getByRole( 'button', { name: pseudoLocalize( 'Relaunch now' ), exact: true } ).click();
	await expect.poll( () => app.evaluate( () => global.__e2eRelaunches ) ).toBe( 1 );

	// INVARIANT — the system's language is a choice like the others: kept as
	// none, and still not what the window started in, so the offer stays.
	// The language the window started in is still listed, and choosing it
	// is refused where it was chosen, since the build has no catalog for
	// it: what is kept stays as it was.
	await language.click();
	await page.getByRole( 'option', { name: pseudoLocalize( 'Your system’s language' ), exact: true } ).click();
	await expect.poll( () => session.readSettings().preferences?.locale ).toBe( null );
	await expect( dialog.getByRole( 'button', { name: pseudoLocalize( 'Relaunch now' ), exact: true } ) ).toBeVisible();
	await language.click();
	await page.getByRole( 'option', { name: 'en-XA', exact: true } ).click();
	await expect( dialog.getByRole( 'alert' ) ).toHaveText( pseudoLocalize( 'The app has no translation for that language.' ) );
	expect( session.readSettings().preferences.locale ).toBe( null );

	// INVARIANT — started again, as the relaunch would start it, the app is
	// in the language kept, and the control says so with no offer.
	await language.click();
	await page.getByRole( 'option', { name: 'English', exact: true } ).click();
	await expect.poll( () => session.readSettings().preferences?.locale ).toBe( 'en' );
	const relaunched = await session.restart();
	await expect( relaunched.page.locator( 'html' ) ).toHaveAttribute( 'lang', 'en', { timeout: 30_000 } );
	await ui.settingsButton( relaunched.page ).click();
	const after = ui.settingsDialog( relaunched.page );
	await expect( after.getByRole( 'combobox', { name: 'Language', exact: true } ) ).toHaveText( 'English' );
	await expect( after.getByRole( 'button', { name: 'Relaunch now', exact: true } ) ).toHaveCount( 0 );
} );

test( 'the Sites tab keeps the PHP version and the debug flags the next server start is given', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );

	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	await ui.settingsTab( page, 'Sites' ).click();
	const versions = dialog.getByRole( 'radiogroup', { name: 'PHP version', exact: true } );
	const wpDebug = dialog.getByRole( 'switch', { name: 'Show PHP errors (WP_DEBUG)', exact: true } );
	const scriptDebug = dialog.getByRole( 'switch', { name: 'Use unminified scripts (SCRIPT_DEBUG)', exact: true } );

	// INVARIANT — the fallbacks: 8.3, both constants on.
	await expect( versions.getByRole( 'radio', { name: '8.3', exact: true } ) ).toBeChecked();
	await expect( wpDebug ).toBeChecked();
	await expect( scriptDebug ).toBeChecked();

	// INVARIANT — a version the bundle has is kept, and so is a flag turned
	// off; the other flag is left as it was.
	await versions.getByRole( 'radio', { name: '8.4', exact: true } ).click();
	await expect( versions.getByRole( 'radio', { name: '8.4', exact: true } ) ).toBeChecked();
	await expect.poll( () => session.readSettings().preferences?.phpVersion ).toBe( '8.4' );
	await wpDebug.click();
	await expect( wpDebug ).not.toBeChecked();
	await expect.poll( () => session.readSettings().preferences?.wpDebug ).toBe( false );
	expect( session.readSettings().preferences.scriptDebug ).toBeUndefined();

	// INVARIANT — opened again after a restart, the tab shows what was kept.
	const again = await session.restart();
	await ui.settingsButton( again.page ).click();
	await ui.settingsTab( again.page, 'Sites' ).click();
	const kept = ui.settingsDialog( again.page );
	await expect( kept.getByRole( 'radio', { name: '8.4', exact: true } ) ).toBeChecked();
	await expect( kept.getByRole( 'switch', { name: 'Show PHP errors (WP_DEBUG)', exact: true } ) ).not.toBeChecked();
	await expect( kept.getByRole( 'switch', { name: 'Use unminified scripts (SCRIPT_DEBUG)', exact: true } ) ).toBeChecked();
} );
