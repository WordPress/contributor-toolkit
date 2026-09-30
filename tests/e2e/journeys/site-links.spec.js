/**
 * Following a link to the running site, by a gesture that asks for a new
 * window (#284).
 *
 * The links under "Start dev server" are how a contributor gets to the site
 * they are working on, and the site belongs in their browser, where there is
 * an address bar and a back button. A plain click has always gone there. A
 * middle click asks for a new window instead, and the app has one window: the
 * one with its own interface in it, which no other page may share. So the
 * address goes to the browser by that gesture too, and nothing opens inside
 * the app.
 *
 * Only a journey can see it. A request for a window is raised by Chromium and
 * answered by how the app's window was set up, and nothing below this layer
 * has a window. What the window does with an address it is asked for is
 * `window-navigation.test.cjs`, and that the main window asks at all is in
 * `ipc-wiring.test.cjs`.
 *
 * The dev server is what shows the links, and a journey does not run one: the
 * two long-running processes it starts are answered by stubs, the way
 * mail.spec.js does it, and here the second reports an address the way the
 * real server does. Nothing reaches the contributor's browser either; the
 * function that would open it records the address instead.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const SERVER_URL = 'http://127.0.0.1:39400/';

test( 'a middle click on a link to the site opens it in the browser, and not in a window of the app', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await app.evaluate( ( { ipcMain, shell }, url ) => {
		global.e2eOpened = [];
		shell.openExternal = async ( target ) => {
			global.e2eOpened.push( target );
		};
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-links' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async ( event, sitePath ) => {
			event.sender.send( 'playground:url', { sitePath, url } );
			return { ok: true };
		} );
	}, SERVER_URL );
	const opened = () => app.evaluate( () => global.e2eOpened );
	await ui.startDevServerButton( page ).click();

	const admin = page.getByRole( 'link', { name: 'wp-admin', exact: true } );
	await expect( admin ).toBeVisible( { timeout: 30_000 } );
	// CHARACTERISATION — the app opens the site in the browser by itself once
	// the server is up, so that address is already there.
	await expect.poll( opened ).toEqual( [ SERVER_URL ] );
	const home = page.url();

	// INVARIANT — a middle click goes to the browser, to the address the link
	// names.
	await admin.click( { button: 'middle' } );
	await expect.poll( opened ).toEqual( [ SERVER_URL, `${ SERVER_URL }wp-admin/` ] );

	// INVARIANT — and the app opened no window of its own and went nowhere.
	expect( await app.evaluate( ( { BrowserWindow } ) => BrowserWindow.getAllWindows().length ) ).toBe( 1 );
	expect( page.url() ).toBe( home );
	await expect( admin ).toBeVisible();
} );
