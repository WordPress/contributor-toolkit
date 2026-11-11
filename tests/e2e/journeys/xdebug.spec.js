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

// Answers the server's start as main does: with whether it started with
// Xdebug, taken from the setting at that moment, and, when another site's
// stubbed server has it, whose it is instead. Main's own check is in
// `ipc-wiring.test.cjs`. Detection finds the editors given, VS Code and
// PhpStorm unless told otherwise, whatever the machine has installed.
const EDITORS = [ 'vscode', 'phpstorm' ];
async function stubServer( app, session, editors = EDITORS ) {
	await app.evaluate( ( { ipcMain, shell }, [ url, ids ] ) => {
		shell.openExternal = async () => {};
		global.e2eEditors = ids;
		ipcMain.removeHandler( 'editor:list' );
		ipcMain.handle( 'editor:list', () => ( { detected: global.e2eEditors.map( ( id ) => ( { id, name: id, path: `/e2e/${ id }` } ) ) } ) );
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-xdebug' } ) );
		ipcMain.removeHandler( 'playground:start' );
		global.e2eXdebugServers = new Set();
		ipcMain.handle( 'playground:start', async ( event, sitePath ) => {
			const heldBy = global.e2eXdebug ? [ ...global.e2eXdebugServers ].find( ( other ) => other !== sitePath ) : undefined;
			const xdebug = Boolean( global.e2eXdebug ) && ! heldBy;
			if ( xdebug ) global.e2eXdebugServers.add( sitePath );
			const report = { xdebug, ...( heldBy ? { xdebugHeldBy: heldBy } : {} ) };
			event.sender.send( 'playground:url', { sitePath, url, ...report } );
			return { ok: true, url, ...report };
		} );
		ipcMain.removeHandler( 'playground:stop' );
		ipcMain.handle( 'playground:stop', async ( event, sitePath ) => {
			global.e2eXdebugServers.delete( sitePath );
			event.sender.send( 'playground:stopped', { sitePath, code: 0 } );
			return { ok: true };
		} );
	}, [ SERVER_URL, editors ] );
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
	// INVARIANT — the launch.json listens on this machine only.
	expect( launch.configurations[ 0 ].hostname ).toBe( '127.0.0.1' );

	// INVARIANT — copying follows the design system's pattern: the button
	// keeps its name, shows a check for two seconds after the copy, an error
	// icon for a copy that failed, and the result is said. A second copy
	// restarts the two seconds. The clipboard is a stand-in, as in the other
	// journeys: it is the system's, shared with the person running them.
	const copyLaunch = vscode.getByRole( 'button', { name: 'Copy launch.json', exact: true } );
	const icon = () => copyLaunch.locator( 'svg' ).evaluate( ( svg ) => svg.innerHTML );
	const spoken = () => page.locator( '#a11y-speak-polite' ).textContent();
	await page.clock.install();
	await page.evaluate( () => {
		navigator.clipboard.writeText = async ( text ) => {
			window.__e2eCopied = text;
		};
	} );
	const resting = await icon();
	await copyLaunch.click();
	await expect.poll( () => page.evaluate( () => window.__e2eCopied ) ).toBe( await vscode.locator( '.xdebug-launch-config' ).textContent() );
	await expect.poll( spoken ).toContain( 'Copied to clipboard' );
	await expect( copyLaunch ).toHaveAccessibleName( 'Copy launch.json' );
	const success = await icon();
	expect( success ).not.toBe( resting );
	await page.clock.fastForward( 1500 );
	await copyLaunch.click();
	await page.clock.fastForward( 1500 );
	expect( await icon() ).toBe( success );
	await page.clock.fastForward( 600 );
	await expect.poll( icon ).toBe( resting );
	await page.evaluate( () => {
		navigator.clipboard.writeText = async () => {
			throw new Error( 'the document is not focused' );
		};
	} );
	await copyLaunch.click();
	await expect.poll( spoken ).toContain( 'Couldn’t copy to clipboard.' );
	await expect( copyLaunch ).toHaveAccessibleName( 'Copy launch.json' );
	const failure = await icon();
	expect( failure ).not.toBe( resting );
	expect( failure ).not.toBe( success );
	await page.evaluate( () => {
		navigator.clipboard.writeText = async ( text ) => {
			window.__e2eCopied = text;
		};
	} );
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
	// INVARIANT — each value's Copy copies that value, and is described by
	// its field's name.
	const copyLocal = phpStorm.getByRole( 'button', { name: 'Copy', exact: true, description: 'File/Directory' } );
	await copyLocal.click();
	await expect.poll( () => page.evaluate( () => window.__e2eCopied ) ).toBe( path.join( site.dir, 'src' ) );
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
// start (`ipc-wiring.test.cjs`); a site whose server started without it says
// which site's server has it now, from what each site says of its own.
test( 'a site whose server started without Xdebug names the site that has it now, and says to restart once no site does', async ( { session } ) => {
	const made = [];
	for ( const label of [ 'first-site', 'second-site', 'third-site' ] ) made.push( await makeSite( session, { label } ) );
	const { app, page } = await session.start( {
		...made[ 0 ].settings,
		sites: made.map( ( site ) => site.dir ),
		siteMeta: Object.assign( {}, ...made.map( ( site ) => site.settings.siteMeta ) ),
	} );
	const followSetting = await stubServer( app, session );
	// A site's entry in the list is named with its server's state while it
	// runs, as "first-site (Server running)".
	const open = async ( label ) => {
		await page.getByRole( 'button', { name: new RegExp( `^${ label }( \\(.*\\))?$` ) } ).click();
		await expect( ui.siteHeading( page, label ) ).toBeVisible();
	};
	const heldBy = ( label ) => page.getByText( `Xdebug is on for ${ label }. Stop that site’s server, then restart this one to use it here.`, { exact: true } );
	const freed = page.getByText( 'This site started without Xdebug because another site’s server had it. Restart the server to use it.', { exact: true } );
	const setup = page.getByRole( 'button', { name: 'Set up Xdebug for your editor', exact: true } );
	const start = async ( label ) => {
		await open( label );
		await ui.startDevServerButton( page ).click();
		await expect( ui.stopDevServerButton( page ) ).toBeVisible( { timeout: 30_000 } );
	};
	const stop = async ( label ) => {
		await open( label );
		await ui.stopDevServerButton( page ).click();
		await expect( ui.startDevServerButton( page ) ).toBeVisible();
	};

	await setXdebug( page, true );
	await followSetting();
	await start( 'first-site' );
	await expect( setup ).toBeVisible();

	// INVARIANT — the second site's server starts without Xdebug, and its
	// row names the site that has it; there is no setup for a server that
	// would not connect.
	await start( 'second-site' );
	await expect( heldBy( 'first-site' ) ).toBeVisible();
	await expect( setup ).toHaveCount( 0 );

	// INVARIANT — once the first site's server stops, the second site no
	// longer sends the contributor to stop it, and says to restart.
	await stop( 'first-site' );
	await open( 'second-site' );
	await expect( freed ).toBeVisible();

	// INVARIANT — a third site started now has Xdebug, and the second names
	// it, not the first: a restart now would not give it Xdebug.
	await start( 'third-site' );
	await expect( setup ).toBeVisible();
	await open( 'second-site' );
	await expect( heldBy( 'third-site' ) ).toBeVisible();
	await expect( freed ).toHaveCount( 0 );

	// INVARIANT — with the third stopped, the second, restarted, has it.
	await stop( 'third-site' );
	await stop( 'second-site' );
	await start( 'second-site' );
	await expect( setup ).toBeVisible();
} );

// The setup dialog shows only while the server has Xdebug. A server that goes
// while the dialog is open closes it, and the next start with Xdebug must not
// open it again: the contributor did not ask for it.
test( 'a setup dialog closed by the server going does not open again by itself at the next start', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const followSetting = await stubServer( app, session );
	const setup = page.getByRole( 'button', { name: 'Set up Xdebug for your editor', exact: true } );
	const vscode = page.getByRole( 'dialog', { name: 'Set up VS Code', exact: true } );

	await setXdebug( page, true );
	await expect.poll( () => session.readSettings().preferences?.xdebug ).toBe( true );
	await followSetting();
	await ui.startDevServerButton( page ).click();
	await setup.click();
	await page.getByRole( 'menuitem', { name: 'VS Code', exact: true } ).click();
	await expect( vscode ).toBeVisible();

	// The server goes by itself while the dialog is open.
	await app.evaluate( ( { BrowserWindow }, sitePath ) => {
		global.e2eXdebugServers.delete( sitePath );
		for ( const win of BrowserWindow.getAllWindows() ) win.webContents.send( 'playground:stopped', { sitePath, code: 1 } );
	}, site.dir );
	await expect( vscode ).toHaveCount( 0 );
	await expect( ui.startDevServerButton( page ) ).toBeVisible();

	// INVARIANT — started again with Xdebug, the setup is offered and the
	// dialog stays closed.
	await ui.startDevServerButton( page ).click();
	await expect( setup ).toBeVisible( { timeout: 30_000 } );
	await expect( vscode ).toHaveCount( 0 );
} );

// The menu offers the editors found on this machine that have a setup (#723):
// Cursor gets VS Code's, Zed its own, and Sublime Text none. Finding none of
// them offers VS Code and PhpStorm, since detection misses some installs.
test( 'the setup menu offers the detected editors that have a setup, and VS Code and PhpStorm when it finds none', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const followSetting = await stubServer( app, session, [ 'sublime', 'zed', 'cursor' ] );
	const setup = page.getByRole( 'button', { name: 'Set up Xdebug for your editor', exact: true } );
	const items = () => page.getByRole( 'menuitem' ).allTextContents();

	await setXdebug( page, true );
	await expect.poll( () => session.readSettings().preferences?.xdebug ).toBe( true );
	await followSetting();
	await ui.startDevServerButton( page ).click();
	await setup.click();
	// INVARIANT — only the detected editors with a setup, in a fixed order.
	await expect.poll( items ).toEqual( [ 'Cursor', 'Zed' ] );

	// INVARIANT — Cursor's is VS Code's launch.json, under Cursor's name.
	await page.getByRole( 'menuitem', { name: 'Cursor', exact: true } ).click();
	const cursor = page.getByRole( 'dialog', { name: 'Set up Cursor', exact: true } );
	await expect( cursor ).toBeVisible();
	expect( JSON.parse( await cursor.locator( '.xdebug-launch-config' ).textContent() ).configurations[ 0 ] ).toMatchObject( { type: 'php', port: 9003 } );
	await page.keyboard.press( 'Escape' );
	await expect( cursor ).toHaveCount( 0 );

	// INVARIANT — Zed's is a .zed/debug.json for its Xdebug adapter, listening
	// on this machine only, with the same mapping.
	await setup.click();
	await page.getByRole( 'menuitem', { name: 'Zed', exact: true } ).click();
	const zed = page.getByRole( 'dialog', { name: 'Set up Zed', exact: true } );
	await expect( zed ).toBeVisible();
	await expect( zed.getByText( '.zed/debug.json', { exact: true } ) ).toBeVisible();
	// INVARIANT — it says where the PHP extension comes from, and what Zed
	// says without it: Zed hides a scenario whose adapter is missing.
	await expect( zed.getByText( 'Run zed: extensions from the command palette, and install PHP. Its Xdebug adapter is what Zed debugs PHP with.', { exact: true } ) ).toBeVisible();
	await expect( zed.getByText( 'If Zed says no debug tasks were found, the PHP extension is not installed.', { exact: true } ) ).toBeVisible();
	const [ scenario ] = JSON.parse( await zed.locator( '.xdebug-launch-config' ).textContent() );
	expect( scenario ).toMatchObject( { adapter: 'Xdebug', request: 'launch', port: 9003, hostname: '127.0.0.1' } );
	expect( scenario.pathMappings ).toEqual( { '/wordpress': path.join( site.dir, 'src' ) } );
	await expect( zed.getByRole( 'button', { name: 'Copy debug.json', exact: true } ) ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( zed ).toHaveCount( 0 );

	// INVARIANT — with nothing detected that has a setup, VS Code and PhpStorm.
	await app.evaluate( () => { global.e2eEditors = [ 'sublime' ]; } );
	await ui.stopDevServerButton( page ).click();
	await ui.startDevServerButton( page ).click();
	await setup.click();
	await expect.poll( items ).toEqual( [ 'VS Code', 'PhpStorm' ] );
} );
