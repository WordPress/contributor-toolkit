/**
 * The engine's own test (#360).
 *
 * Not a journey: it asserts nothing about ticket branches or patches. It asserts
 * that the things every journey depends on actually work, so that when a
 * journey fails it is about the flow and not about the harness.
 *
 *   1. The app launches from the source tree and paints.
 *   2. The design system's tokens and the styles it adds at run time are applied.
 *   3. It uses the throwaway profile, and nothing else.
 *   4. What it persists survives closing and reopening it.
 *   5. A native file dialog can be answered from the test.
 *   6. An app that will not quit is ended, so teardown always finishes.
 *   7. A launch can be asked what it came to, for the one that opens no window.
 *
 * If this file is red, no other journey's result means anything.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect, launchState } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );

// Directories made during a test, removed after it. The profile is the session
// fixture's problem; these are the fake sites and patch files pointed at from it.
// The site's name is on screen twice — the sidebar entry and the heading of the
// open site — so neither can be reached by text alone. Roles tell them apart, and
// say which half of the app the assertion is about: `ui.sidebarEntry` and
// `ui.siteHeading`.

const scratch = [];
test.afterEach( () => {
	while ( scratch.length ) fs.rmSync( scratch.pop(), { recursive: true, force: true } );
} );

/**
 * A site directory the app can list without being able to read Git metadata from
 * it. The renderer tolerates that — it shows the site with no snapshot date
 * rather than crashing — which is enough for everything below. Journeys build a
 * real repository instead.
 *
 * @param {Object} session The session that will list it, and clean it up.
 * @param {string} label
 * @return {{dir: string, settings: Object}} The directory, and settings that list it.
 */
function makeListedSite( session, label ) {
	const yesterday = new Date( Date.now() - 24 * 60 * 60 * 1000 ).toISOString();
	const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );
	fs.mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
	return {
		dir,
		settings: {
			sites: [ dir ],
			siteMeta: {
				[ dir ]: {
					initialized: true,
					createdAt: yesterday,
					label,
					// Relative to now, not a fixed date. The staleness dot appears
					// once a snapshot is a fortnight old, and it joins the sidebar
					// entry's accessible name when it does — so a hardcoded date
					// would quietly change what the selectors below match, months
					// after anyone touched this file.
					trunkDate: yesterday,
					skipInitWizard: true,
				},
			},
			preferences: {},
		},
	};
}

test( 'the app launches from source, styled, and lists the site it was seeded with', async ( { session } ) => {
	const site = makeListedSite( session, 'engine-check' );
	const { page } = await session.start( site.settings );

	await expect( page ).toHaveTitle( 'WordPress Contributor Toolkit' );
	// #root is in the static HTML, so its presence proves nothing, and neither does
	// its one child: that is the design system's provider, which is there whatever
	// the app inside it rendered. What the app rendered is one level further down.
	await expect( ui.renderedApp( page ) ).not.toHaveCount( 0 );

	// `exact`, because the sidebar heading "Contributor Toolkit" is a substring of
	// several button labels further down the page.
	await expect( ui.sidebarEntry( page, 'engine-check' ) ).toBeVisible();
	// The row wears its project (#251): a Core site says Core, not nothing.
	await expect( ui.sidebarEntry( page, 'engine-check' ) ).toHaveAccessibleName( 'engine-check Core' );
	await expect( page.getByText( 'No sites yet.', { exact: true } ) ).toHaveCount( 0 );

	// The design system reaches the window (#549), asserted here because it needs
	// a painted window and nothing else, and this test already has one.
	//
	// The tokens are a stylesheet the bundle has to carry. Without it every
	// `var(--wpds-…)` in the app's own styles resolves to nothing, and nothing
	// fails: the components fall back to their built-in values and only the
	// parts written against the tokens lose their colour. Which value it holds
	// is the design system's business, so only that it holds one is asserted:
	// an element painted with a token is not left transparent.
	const painted = await page.evaluate( () => {
		const probe = document.createElement( 'div' );
		probe.style.background = 'var(--wpds-color-background-interactive-brand-strong)';
		document.body.appendChild( probe );
		const background = window.getComputedStyle( probe ).backgroundColor;
		probe.remove();
		return background;
	} );
	expect( painted ).not.toBe( 'rgba(0, 0, 0, 0)' );

	// `@wordpress/theme` and `@wordpress/ui` do not ship a stylesheet for their
	// components: each one adds a `<style>` element when its module loads, which
	// the window's content security policy has to allow. If it stops allowing
	// it, these two are what show it first. The provider's wrapper becomes a
	// block between `#root` and the app, and the text read aloud for the next
	// step (#252) appears on screen.
	const wrapper = await page.locator( '#root > *' ).first().evaluate( ( el ) => window.getComputedStyle( el ).display );
	expect( wrapper ).toBe( 'contents' );
	// Found by what it says, which is the only thing a screen reader user has of
	// it. Not by the attribute the component puts on it: `@wordpress/components`
	// puts the same one on its own hidden text, and hides that with inline
	// styles, so the first match could pass with no injected style at all.
	const spoken = page.getByRole( 'status' ).filter( { hasText: /^Next step: / } );
	await expect( spoken ).toHaveCount( 1 );
	await expect( spoken ).toHaveAttribute( 'aria-live', 'polite' );
	const box = await spoken.evaluate( ( el ) => {
		const style = window.getComputedStyle( el );
		return { position: style.position, width: style.width };
	} );
	expect( box ).toEqual( { position: 'absolute', width: '1px' } );
} );

test( 'the app writes to the throwaway profile and not to the real one', async ( { session } ) => {
	const { app } = await session.start();

	// The launch guard already refuses to proceed otherwise, so this is here to
	// make the guarantee visible as a test rather than only as a helper's
	// precondition — the whole suite is unsafe to run the day it stops holding.
	const inUse = await app.evaluate( ( { app: electronApp } ) => electronApp.getPath( 'userData' ) );
	expect( path.resolve( inUse ) ).toBe( path.resolve( session.userDataDir ) );

	// And it is genuinely this app's store: the seeded file is the one it read.
	expect( session.readSettings() ).toHaveProperty( 'sites' );
} );

test( 'state written by the app survives closing and reopening it', async ( { session } ) => {
	const site = makeListedSite( session, 'before-restart' );
	const { page } = await session.start( site.settings );
	await expect( ui.sidebarEntry( page, 'before-restart' ) ).toBeVisible();

	// Renaming goes through the app's own persistence path, so this proves the
	// round trip the journeys rely on: the app wrote it, the app read it back.
	// Anything asserted only within one launch could be memory, not storage.
	await page.evaluate(
		( [ sitePath, label ] ) => window.api.setSiteLabel( sitePath, label ),
		[ site.dir, 'after-restart' ]
	);
	// No assertion on the sidebar here, deliberately. The rename went straight to
	// the main process, which does not push an update back to a renderer that did
	// not ask for one — so the old name stays on screen until something reloads.
	// That is the app's business; what this test is about is the write reaching
	// disk, and the reader for that is the relaunch below.

	const { page: reopened } = await session.restart();
	await expect( ui.sidebarEntry( reopened, 'after-restart' ) ).toBeVisible();
	await expect( ui.siteHeading( reopened, 'after-restart' ) ).toBeVisible();
	expect( session.readSettings().siteMeta[ site.dir ].label ).toBe( 'after-restart' );
} );

test( 'a native file dialog can be answered from the test', async ( { session } ) => {
	const patchDir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-patch-' ) ) );
	const patchFile = path.join( patchDir, 'engine.patch' );
	fs.writeFileSync( patchFile, '--- a/wp-login.php\n+++ b/wp-login.php\n' );

	const { page } = await session.start();
	await session.answerFileDialog( [ patchFile ] );

	// Straight through the app's real handler, which opens the dialog, reads the
	// file and returns its text — so this covers the whole path a journey uses to
	// bring a patch in, not just that the stub was installed.
	const chosen = await page.evaluate( () => window.api.choosePatchFile() );
	expect( chosen.filePath ).toBe( patchFile );
	expect( chosen.name ).toBe( 'engine.patch' );
	expect( chosen.text ).toContain( 'wp-login.php' );
} );

/**
 * Whether a process is still there. Signal 0 delivers nothing and only asks.
 *
 * @param {number} pid
 * @return {boolean} False once the process has gone.
 */
function isRunning( pid ) {
	try {
		process.kill( pid, 0 );
		return true;
	} catch {
		return false;
	}
}

test( 'closing ends an app that has stopped answering', async ( { session } ) => {
	const { app } = await session.start();

	// A main process that has stopped answering, which is how a launch that
	// never finished looked from outside on a macOS runner: asked to quit it
	// stays, and a termination signal is one more thing it never gets to.
	const pid = await app.evaluate( () => {
		setTimeout( () => {
			for ( ;; ) {
				// Busy for good, once this call has answered.
			}
		}, 0 );
		return process.pid;
	} );
	expect( isRunning( pid ) ).toBe( true );

	// INVARIANT: by the time close() returns the app has gone. Left running, it
	// is what Playwright waits on when the worker stops, and the run fails on
	// "Worker teardown timeout" a minute after its last test passed.
	await session.close();
	expect( isRunning( pid ) ).toBe( false );
} );

test( 'the main process says what a launch came to', async ( { session } ) => {
	const { app, page } = await session.start();
	await expect( ui.renderedApp( page ) ).not.toHaveCount( 0 );

	// Read here on a launch that worked, because the launch it is for cannot be
	// staged: it is what the helper puts in the error when no window opens.
	await expect.poll( () => launchState( app ) ).toEqual( {
		ready: true,
		windows: [ {
			visible: true,
			url: expect.stringMatching( /\/src\/renderer\/index\.html$/ ),
			loading: false,
			crashed: false,
		} ],
	} );
} );

test( 'a failed site deletion stays visible, reports the failure, and can be retried (#414)', async ( { session } ) => {
	const site = makeListedSite( session, 'delete-retry' );
	const { app, page } = await session.start( site.settings );
	const confirmsAnswered = await session.acceptConfirms();

	// Hold the IPC reply in the main process. This keeps the UI operation pending
	// without shipping a test-only delay or relying on filesystem timing.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'sites:delete' );
		ipcMain.handle( 'sites:delete', ( _event, sitePath ) => new Promise( ( resolve ) => {
			globalThis.__toolkitDeleteRequest = { resolve, sitePath };
		} ) );
	} );

	await ui.siteMenuButton( page ).click();
	await ui.deleteSiteMenuItem( page ).click();

	// The row speaks while the call is outstanding, and the only delete action is
	// disabled so a second request cannot race the first one.
	const deletingEntry = page.getByRole( 'button', { name: 'delete-retry, Deleting', exact: true } );
	await expect( deletingEntry ).toBeDisabled();
	await expect( deletingEntry.getByText( 'Deleting site…', { exact: true } ) ).toBeVisible();
	await page.getByRole( 'button', { name: 'Collapse site list', exact: true } ).click();
	await expect( deletingEntry.locator( '.components-spinner' ) ).toBeVisible();
	await page.getByRole( 'button', { name: 'Expand site list', exact: true } ).click();
	await ui.siteMenuButton( page ).click();
	await expect( page.getByRole( 'menuitem', { name: 'Deleting…', exact: true } ) ).toBeDisabled();
	await ui.siteMenuButton( page ).click();

	await app.evaluate( () => {
		const request = globalThis.__toolkitDeleteRequest;
		if ( ! request ) throw new Error( 'The renderer never reached sites:delete' );
		request.resolve( { ok: false, reason: 'remove-failed', path: request.sitePath, code: 'EBUSY' } );
	} );

	const failure = `The site is still listed because its folder could not be deleted (EBUSY). Close anything using it, then try again. Folder: ${ site.dir }`;
	await expect( page.getByText( failure, { exact: true } ) ).toBeVisible();
	await expect( ui.sidebarEntry( page, 'delete-retry' ) ).toBeVisible();
	await expect( page.getByText( 'Deleting site…', { exact: true } ) ).toHaveCount( 0 );

	await ui.siteMenuButton( page ).click();
	await expect( ui.deleteSiteMenuItem( page ) ).toBeEnabled();
	expect( await confirmsAnswered() ).toBe( 1 );
	expect( session.readSettings().sites ).toEqual( [ site.dir ] );
} );
