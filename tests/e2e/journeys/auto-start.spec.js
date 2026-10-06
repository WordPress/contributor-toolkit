/**
 * What opening a site starts, and what the next launch starts again (#559):
 * the two settings that start the server or the build watch when a site is
 * opened, and the quit setting that remembers what was running.
 *
 * Nothing is run. The handlers that start the server and a script are
 * answered by stubs that keep what they were asked, as dev-server.spec.js
 * does, and the test says what the main process would say. What the quit
 * writes is ipc-wiring's subject: here the list is seeded as a quit would
 * leave it, and what the launch does with it is what is watched.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const URL = 'http://127.0.0.1:9400/';
const CORE_WATCH = { name: 'grunt', args: [ '--', '_watch' ] };

// The stand-ins, in place before the window asks anything: a launch starts
// what it starts as soon as a site's status is read. So every journey here
// launches first with nothing to start, seeds the store once that launch is
// up, and relaunches with the stand-ins in place: a first launch with the
// setting on and no stand-in would start a real server.
async function standIn( app ) {
	await app.evaluate( ( { ipcMain } ) => {
		const asked = { starts: [], scripts: [] };
		global.__e2eAuto = asked;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'playground:start', ( event, dir ) => {
			asked.starts.push( dir );
			return { ok: true };
		} );
		replace( 'playground:stop', () => ( { ok: true } ) );
		replace( 'npm:run-script', ( event, dir, name, args ) => {
			asked.scripts.push( { dir, name, args } );
			return { runId: `e2e-run-${ asked.scripts.length }` };
		} );
		replace( 'npm:kill', () => ( { ok: true } ) );
		replace( 'url:open', () => true );
	} );
}
const asked = ( app ) => app.evaluate( () => global.__e2eAuto );
const tell = ( app, channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
	for ( const win of BrowserWindow.getAllWindows() ) win.webContents.send( to, what );
}, [ channel, payload ] );
// A settled moment: the site's status has been read, which is when a start
// would be asked for.
const settled = ( page ) => expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );

test( 'with the server set to start when a site is opened, opening one asks for its server once, and not again while it runs', async ( { session } ) => {
	const first = await makeSite( session, { label: 'first' } );
	const second = await makeSite( session, { label: 'second' } );
	const settings = {
		sites: [ first.dir, second.dir ],
		siteMeta: { ...first.settings.siteMeta, ...second.settings.siteMeta },
		preferences: { autoStartServer: true }
	};
	await session.start( { ...settings, preferences: {} } );
	session.writeSettings( settings );
	const { app, page } = await session.restart( { beforeWindow: standIn } );

	// INVARIANT — the site the window opens on, whichever the list puts
	// first, is opened: its server is asked for, once, and on Core the watch
	// with it, as a press of Start does. The terminal is held while the
	// server starts, so the terminal's hint is not what to wait for here;
	// the asking is.
	await expect.poll( async () => ( await asked( app ) ).starts.length, { timeout: 30_000 } ).toBe( 1 );
	const [ opened ] = ( await asked( app ) ).starts;
	const [ openedSite, otherSite ] = opened === first.dir ? [ first, second ] : [ second, first ];
	await expect( ui.siteHeading( page, openedSite.settings.siteMeta[ openedSite.dir ].label ) ).toBeVisible();
	await expect.poll( async () => ( await asked( app ) ).scripts ).toEqual( [ { dir: openedSite.dir, ...CORE_WATCH } ] );
	await tell( app, 'playground:url', { sitePath: openedSite.dir, url: URL } );
	await expect( ui.stopDevServerButton( page ) ).toBeVisible();

	// INVARIANT — opening another site asks for that site's server; coming
	// back to one whose server runs asks for nothing more.
	const otherLabel = otherSite.settings.siteMeta[ otherSite.dir ].label;
	const openedLabel = openedSite.settings.siteMeta[ openedSite.dir ].label;
	await ui.sidebarEntry( page, otherLabel ).click();
	await expect( ui.siteHeading( page, otherLabel ) ).toBeVisible();
	await expect.poll( async () => ( await asked( app ) ).starts ).toEqual( [ openedSite.dir, otherSite.dir ] );
	await ui.sidebarEntry( page, openedLabel ).click();
	await expect( ui.siteHeading( page, openedLabel ) ).toBeVisible();
	await ui.sidebarEntry( page, otherLabel ).click();
	await expect( ui.siteHeading( page, otherLabel ) ).toBeVisible();
	expect( ( await asked( app ) ).starts ).toEqual( [ openedSite.dir, otherSite.dir ] );
} );

test( 'with the watch set to start when a site is opened, opening one asks for the watch and not the server; with neither set, nothing', async ( { session } ) => {
	const site = await makeSite( session );
	await session.start( site.settings );
	session.writeSettings( { ...site.settings, preferences: { autoStartWatch: true } } );
	const { app, page } = await session.restart( { beforeWindow: standIn } );
	await ui.openTray( page, 'Terminal' );
	await settled( page );

	// INVARIANT — the watch, by its project's script, and no server.
	await expect.poll( async () => ( await asked( app ) ).scripts ).toEqual( [ { dir: site.dir, ...CORE_WATCH } ] );
	expect( ( await asked( app ) ).starts ).toEqual( [] );

	// INVARIANT — turned off in the settings, opening the site again starts
	// nothing: the watch was stopped by the test, so there is one to start.
	await tell( app, 'npm:run-script:done', { runId: 'e2e-run-1', code: 0 } );
	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	await dialog.getByRole( 'switch', { name: 'Start the build watch when I open a site', exact: true } ).click();
	await expect.poll( () => session.readSettings().preferences?.autoStartWatch ).toBe( false );
	await ui.closeDialogButton( dialog ).click();
	const again = await session.restart( { beforeWindow: standIn } );
	await ui.openTray( again.page, 'Terminal' );
	await settled( again.page );
	await again.page.waitForTimeout( 500 );
	expect( await asked( again.app ) ).toEqual( { starts: [], scripts: [] } );
} );

test( 'what the last quit stopped is started again at the next launch, once, and only while the quit setting says so', async ( { session } ) => {
	const served = await makeSite( session, { label: 'served' } );
	const watched = await makeSite( session, { label: 'watched' } );
	const idle = await makeSite( session, { label: 'idle' } );
	const settings = {
		sites: [ served.dir, watched.dir, idle.dir ],
		siteMeta: { ...served.settings.siteMeta, ...watched.settings.siteMeta, ...idle.settings.siteMeta },
		// As a quit under 'restart' leaves the store.
		preferences: { quitBehavior: 'restart', resume: { servers: [ served.dir ], watches: [ watched.dir ] } }
	};
	// The first launch is given nothing, and the list is seeded for the
	// launch that is watched only once that launch's main process is up: a
	// quit reads the store as it is, and the first launch's quit, finding
	// 'restart' and nothing running, would write an empty list over one
	// seeded before it.
	await session.start( { ...settings, preferences: { quitBehavior: 'stop' } } );
	const { app } = await session.restart( { beforeWindow: async ( launched ) => { session.writeSettings( settings ); await standIn( launched ); } } );

	// INVARIANT — the served site's server and the watched site's watch are
	// asked for, whichever site the window opened on, and the idle site's
	// nothing; on Core the served site's watch comes with its server. And
	// the list is forgotten as it is read.
	await expect.poll( async () => ( await asked( app ) ).starts, { timeout: 30_000 } ).toEqual( [ served.dir ] );
	const byDir = ( scripts ) => [ ...scripts ].sort( ( a, b ) => a.dir.localeCompare( b.dir ) );
	await expect.poll( async () => byDir( ( await asked( app ) ).scripts ) ).toEqual( byDir( [ { dir: watched.dir, ...CORE_WATCH }, { dir: served.dir, ...CORE_WATCH } ] ) );
	await expect.poll( () => 'resume' in ( session.readSettings().preferences || {} ) ).toBe( false );

	// INVARIANT — opened again with nothing left by a quit, nothing starts.
	const again = await session.restart( { beforeWindow: standIn } );
	await ui.openTray( again.page, 'Terminal' );
	await settled( again.page );
	await again.page.waitForTimeout( 500 );
	expect( await asked( again.app ) ).toEqual( { starts: [], scripts: [] } );

	// INVARIANT — a list left under 'restart' is not followed under 'stop'.
	session.writeSettings( { ...settings, preferences: { quitBehavior: 'stop', resume: settings.preferences.resume } } );
	const stopped = await session.restart( { beforeWindow: standIn } );
	await ui.openTray( stopped.page, 'Terminal' );
	await settled( stopped.page );
	await stopped.page.waitForTimeout( 500 );
	expect( await asked( stopped.app ) ).toEqual( { starts: [], scripts: [] } );
} );

test( 'the quit setting is chosen in the settings and kept', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.settingsButton( page ).click();
	const dialog = ui.settingsDialog( page );
	const quit = dialog.getByRole( 'combobox', { name: 'When I quit, running servers and build watches', exact: true } );
	await expect( quit ).toHaveText( 'Stop them' );
	await quit.click();
	await page.getByRole( 'option', { name: 'Stop them, and start them again next time', exact: true } ).click();
	await expect( quit ).toHaveText( 'Stop them, and start them again next time' );
	await expect.poll( () => session.readSettings().preferences?.quitBehavior ).toBe( 'restart' );
} );
