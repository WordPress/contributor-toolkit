/**
 * Turning on step debugging for a site's server, and what the site's details
 * then say (#723).
 *
 * Xdebug is a setting, applied at the next start of a server. The Debugging
 * row of the details names it with the constants, as the next start is
 * given them, and says what the running server started with when that is
 * not the same; a server started with it offers the VS Code setup, with the
 * launch.json VS Code needs.
 *
 * A journey does not run the Playground server, so the start is answered by
 * a stub that reports an address the way the real one does and says whether
 * the server has Xdebug, as main does from the setting; that main reads the
 * setting into the runner's config and the URL it reports is in
 * `ipc-wiring.test.cjs`, and that the runner hands it to the CLI is in
 * `runner-wiring.test.cjs`. Whether VS Code then stops on a breakpoint is a
 * manual check: no layer of the suite runs Xdebug or an editor.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const SERVER_URL = 'http://127.0.0.1:39403/';

// Answers the server's start as main does, with whether it started with
// Xdebug taken from the setting at that moment.
async function stubServer( app, session ) {
	await app.evaluate( ( { ipcMain, shell }, url ) => {
		shell.openExternal = async () => {};
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-xdebug' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async ( event, sitePath ) => {
			const xdebug = Boolean( global.e2eXdebug );
			event.sender.send( 'playground:url', { sitePath, url, xdebug } );
			return { ok: true, url, xdebug };
		} );
		ipcMain.removeHandler( 'playground:stop' );
		ipcMain.handle( 'playground:stop', async ( event, sitePath ) => {
			event.sender.send( 'playground:stopped', { sitePath, code: 0 } );
			return { ok: true };
		} );
	}, SERVER_URL );
	return async () => {
		const xdebug = Boolean( session.readSettings().preferences?.xdebug );
		await app.evaluate( ( _electron, value ) => { global.e2eXdebug = value; }, xdebug );
	};
}

async function setXdebug( page, on ) {
	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	await ui.settingsTab( page, 'Sites' ).click();
	const toggle = dialog.getByRole( 'switch', { name: 'Step debugging (Xdebug)', exact: true } );
	if ( on ) await expect( toggle ).not.toBeChecked();
	else await expect( toggle ).toBeChecked();
	await toggle.click();
	await ui.closeDialogButton( dialog ).click();
	await expect( dialog ).toHaveCount( 0 );
}

test( 'the Debugging row says when Xdebug is on, and a server started with it offers the VS Code setup', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const followSetting = await stubServer( app, session );
	const setup = page.getByRole( 'button', { name: 'Set up your editor', exact: true } );
	const debugging = ( value ) => page.getByText( value, { exact: true } );

	// INVARIANT — off by default: nothing says Xdebug, whether or not the
	// server runs.
	await expect( debugging( 'WP_DEBUG · SCRIPT_DEBUG' ) ).toBeVisible();
	await followSetting();
	await ui.startDevServerButton( page ).click();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( /Xdebug/ ) ).toHaveCount( 0 );

	// INVARIANT — turned on while the server runs, the row names it, and says
	// the server does not have it yet; there is no setup for a server that
	// would not connect.
	await setXdebug( page, true );
	await expect.poll( () => session.readSettings().preferences?.xdebug ).toBe( true );
	await expect( debugging( 'WP_DEBUG · SCRIPT_DEBUG · Xdebug' ) ).toBeVisible();
	await expect( page.getByText( 'Xdebug is turned on, but this site started before that. Restart the server to use it.', { exact: true } ) ).toBeVisible();
	await expect( setup ).toHaveCount( 0 );

	// INVARIANT — restarted, the server has it: the note goes, and the setup
	// shows a launch.json that maps the served WordPress to this checkout's
	// src/.
	await ui.stopDevServerButton( page ).click();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await followSetting();
	await ui.startDevServerButton( page ).click();
	await expect( setup ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( /Restart the server/ ) ).toHaveCount( 0 );
	await setup.click();
	const dialog = page.getByRole( 'dialog', { name: 'Debug in VS Code', exact: true } );
	await expect( dialog ).toBeVisible();
	const launch = JSON.parse( await dialog.locator( '.xdebug-launch-config' ).textContent() );
	expect( launch.configurations[ 0 ] ).toMatchObject( { type: 'php', request: 'launch', port: 9003 } );
	expect( launch.configurations[ 0 ].pathMappings ).toEqual( { '/wordpress': path.join( site.dir, 'src' ) } );
	await expect( dialog.getByRole( 'button', { name: 'Copy launch.json', exact: true } ) ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );

	// INVARIANT — turned off while it runs, the row no longer names it, says
	// the server still has it until a restart, and keeps the setup.
	await setXdebug( page, false );
	await expect( debugging( 'WP_DEBUG · SCRIPT_DEBUG' ) ).toBeVisible();
	await expect( page.getByText( 'Xdebug is still on for this site until you restart the server.', { exact: true } ) ).toBeVisible();
	await expect( setup ).toBeVisible();

	// INVARIANT — stopped, nothing says Xdebug.
	await ui.stopDevServerButton( page ).click();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( page.getByText( /Xdebug/ ) ).toHaveCount( 0 );
} );
