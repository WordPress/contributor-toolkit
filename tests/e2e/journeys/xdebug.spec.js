/**
 * Turning on step debugging for a site's server, and what the site's details
 * then say (#723).
 *
 * Xdebug is a setting, applied at the next start of a server. The Debugging
 * row of the details names it with the constants, as the next start is
 * given them, and says what the running server started with when that is
 * not the same; a server started with it offers a menu of editors to set up,
 * with the launch.json VS Code needs and the values PhpStorm's settings
 * need.
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
// Xdebug taken from the setting at that moment, and, when the test says
// another site's server has it, whose it is instead.
async function stubServer( app, session ) {
	await app.evaluate( ( { ipcMain, shell }, url ) => {
		shell.openExternal = async () => {};
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-xdebug' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async ( event, sitePath ) => {
			const xdebug = Boolean( global.e2eXdebug ) && ! global.e2eXdebugHeldBy;
			const report = { xdebug, ...( global.e2eXdebugHeldBy ? { xdebugHeldBy: global.e2eXdebugHeldBy } : {} ) };
			event.sender.send( 'playground:url', { sitePath, url, ...report } );
			return { ok: true, url, ...report };
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

test( 'the Debugging row says when Xdebug is on, and a server started with it offers the editor setup', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const followSetting = await stubServer( app, session );
	const setup = page.getByRole( 'button', { name: 'Set up Xdebug for your editor', exact: true } );
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
	// CHARACTERISATION — it is a notice as wide as the details, not one
	// squeezed to the width of its longest word.
	const notice = page.locator( '.details-notice' );
	const widths = await notice.evaluate( ( el ) => ( { notice: el.getBoundingClientRect().width, details: el.closest( '.dashboard-sidebar' ).clientWidth } ) );
	expect( widths.notice ).toBeGreaterThan( widths.details * 0.9 );
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
	// INVARIANT — the button is a menu of the editors, and each opens its
	// own setup.
	await setup.click();
	await page.getByRole( 'menuitem', { name: 'VS Code', exact: true } ).click();
	const vscode = page.getByRole( 'dialog', { name: 'Set up VS Code', exact: true } );
	await expect( vscode ).toBeVisible();
	const launch = JSON.parse( await vscode.locator( '.xdebug-launch-config' ).textContent() );
	expect( launch.configurations[ 0 ] ).toMatchObject( { type: 'php', request: 'launch', port: 9003 } );
	expect( launch.configurations[ 0 ].pathMappings ).toEqual( { '/wordpress': path.join( site.dir, 'src' ) } );
	await expect( vscode.getByRole( 'button', { name: 'Copy launch.json', exact: true } ) ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( vscode ).toHaveCount( 0 );
	// INVARIANT — closed, the dialog gives the focus back to the button,
	// and its focus ring is drawn whole: the details clip at their edges, and
	// a ring at the left one came back cut off.
	await expect( setup ).toBeFocused();
	const ring = await setup.evaluate( ( button ) => {
		const style = window.getComputedStyle( button );
		const slot = button.closest( '.dashboard-sidebar-slot' ).getBoundingClientRect();
		const box = button.getBoundingClientRect();
		const extent = parseFloat( style.outlineWidth ) + Math.max( 0, parseFloat( style.outlineOffset ) || 0 );
		return { shown: style.outlineStyle !== 'none' && extent > 0, extent, left: box.left - slot.left, right: slot.right - box.right };
	} );
	expect( ring.shown ).toBe( true );
	expect( ring.left ).toBeGreaterThanOrEqual( ring.extent );
	expect( ring.right ).toBeGreaterThanOrEqual( ring.extent );

	// INVARIANT — PhpStorm gets the same mapping, and the server the site
	// runs on, as values for its own settings, each with its copy button.
	await setup.click();
	await page.getByRole( 'menuitem', { name: 'PhpStorm', exact: true } ).click();
	const phpStorm = page.getByRole( 'dialog', { name: 'Set up PhpStorm', exact: true } );
	await expect( phpStorm ).toBeVisible();
	await expect( phpStorm.getByText( '39403', { exact: true } ) ).toBeVisible();
	await expect( phpStorm.getByText( path.join( site.dir, 'src' ), { exact: true } ) ).toBeVisible();
	await expect( phpStorm.getByText( '/wordpress', { exact: true } ) ).toBeVisible();
	await expect( phpStorm.getByRole( 'button', { name: 'Copy', exact: true } ) ).toHaveCount( 4 );
	await page.keyboard.press( 'Escape' );
	await expect( phpStorm ).toHaveCount( 0 );

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

// One running server has Xdebug at a time (#723). Main decides that at the
// start (`ipc-wiring.test.cjs`); a site started while another's server has
// it is told whose, and its details say so.
test( 'a site started while another site’s server has Xdebug says which site has it, and offers no setup', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const followSetting = await stubServer( app, session );
	await app.evaluate( () => { global.e2eXdebugHeldBy = '/elsewhere/other-site'; } );

	await setXdebug( page, true );
	await followSetting();
	await ui.startDevServerButton( page ).click();
	await expect( ui.stopDevServerButton( page ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the row names the site that has it, by the name the list
	// would show, and says how to have it here; there is no setup for a
	// server that would not connect.
	await expect( page.getByText( 'Xdebug is on for other-site, so this site started without it. Stop that site’s server, then restart this one to use it here.', { exact: true } ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'Set up Xdebug for your editor', exact: true } ) ).toHaveCount( 0 );
} );
