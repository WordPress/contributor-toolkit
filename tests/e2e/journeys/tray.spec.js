/**
 * The tray along the bottom of the window (#558).
 *
 * The terminal used to be a panel at the foot of a site's page, always there
 * and always that site's. It is in a tray now: the window's, closed until it
 * is asked for, opened from the footer, as tall as it is dragged, and showing
 * whichever site is open. Moving it must not cost a site its terminal, so
 * the first journey is that: each site's terminal is its own, and is still
 * there, with what was printed in it, after the tray was closed and after
 * another site was looked at.
 *
 * The second is the tray's edge: moved with the keyboard and with a pointer,
 * kept inside its limits, and the terminal fitted to the room it is given.
 *
 * The last two are the one time the tray opens without being asked. On the
 * page the terminal was always in view, and the page still says "its output
 * is in the Terminal" of a build that failed, and still refuses an action
 * with a line printed there. So either brings the terminal up, and a failure
 * whose output is somewhere else does not.
 *
 * What the terminal does with what is typed in it is `terminal.spec.js`.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, advanceOrigin } = require( '../helpers/git-site.cjs' );
const { DEFAULT_TRAY_HEIGHT, MIN_TRAY_HEIGHT, TRAY_KEY_STEP, trayHeightLimits } = require( '../../../src/renderer/tray.cjs' );

// What the terminal has drawn. It has no role of its own, so it is found by
// the element xterm draws its rows in, inside the tray.
const terminalScreen = ( page ) => ui.tray( page, 'Terminal' ).locator( '.xterm-rows' ).filter( { visible: true } );
// The tray's top edge, which is dragged or moved with the arrow keys.
const trayEdge = ( page ) => page.getByRole( 'separator', { name: 'Resize tray', exact: true } );

/**
 * Stands in for the site's npm scripts: nothing runs, and the test says what
 * a run prints and how it ends, on the channels the real runner uses.
 *
 * @param {Object} app
 * @param {Object} page
 * @return {Promise<Object>} What was asked for, and the ways to answer.
 */
async function standInForScripts( app, page ) {
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eTrayScripts = [];
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', ( event, dir, name ) => {
			global.__e2eTrayScripts.push( name );
			return { runId: `e2e-run-${ global.__e2eTrayScripts.length }` };
		} );
	} );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	return {
		asked: () => app.evaluate( () => global.__e2eTrayScripts ),
		prints: ( run, text ) => tell( 'npm:run-script:log', { runId: `e2e-run-${ run }`, type: 'stdout', data: text } ),
		ends: ( run, code ) => tell( 'npm:run-script:done', { runId: `e2e-run-${ run }`, code } ),
		heard: () => page.evaluate( () => window.api.getSitesWithMeta() ),
	};
}

test( 'the tray is closed until the footer opens it, shows the open site\'s own terminal, and keeps each one through a close and a look at another site', async ( { session } ) => {
	const first = await makeSite( session, { label: 'first-site' } );
	const second = await makeSite( session, { label: 'second-site' } );
	// The app opens on the newest site.
	second.settings.siteMeta[ second.dir ].createdAt = new Date( Date.now() - 7 * 24 * 60 * 60 * 1000 ).toISOString();
	const { page } = await session.start( {
		sites: [ first.dir, second.dir ],
		siteMeta: { ...first.settings.siteMeta, ...second.settings.siteMeta },
		preferences: {},
	} );
	await expect( ui.siteHeading( page, 'first-site' ) ).toBeVisible( { timeout: 30_000 } );
	const toggle = ui.trayToggle( page, 'Terminal' );
	const tray = ui.tray( page, 'Terminal' );
	const terminal = ui.terminalInput( page );

	// INVARIANT — the window opens with the tray closed: nothing of it on
	// screen, and its button not pressed.
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( tray ).toHaveCount( 0 );
	await expect( page.getByRole( 'heading', { name: 'Terminal', exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — the button opens it: named and headed for what it holds,
	// and the button says so.
	await toggle.click();
	await expect( tray ).toBeVisible();
	await expect( tray.getByRole( 'heading', { level: 2, name: 'Terminal', exact: true } ) ).toBeVisible();
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );

	// INVARIANT — the tray takes its room from the page and covers none of
	// it: the last thing on the page can still be brought wholly into view,
	// above the tray.
	// Asked until it is so: the page moves as its cards arrive.
	const lastCard = ui.card( page, 'Mail' );
	await lastCard.scrollIntoViewIfNeeded();
	await expect( lastCard ).toBeInViewport( { ratio: 1 } );
	await expect.poll( async () => {
		const cardBox = await lastCard.boundingBox();
		const trayBox = await tray.boundingBox();
		return trayBox.y - ( cardBox.y + cardBox.height );
	} ).toBeGreaterThanOrEqual( 0 );

	// INVARIANT — a confirmation, which is drawn in the corner the tray
	// comes up into, stands clear of the tray and covers none of it.
	await ui.siteMenuButton( page ).click();
	await page.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	const toast = ui.toast( page, 'Copied the path' );
	await expect( toast ).toBeVisible();
	await expect.poll( async () => {
		const toastBox = await toast.boundingBox();
		const trayBox = await tray.boundingBox();
		return trayBox.y - ( toastBox.y + toastBox.height );
	} ).toBeGreaterThanOrEqual( 0 );

	// Something only this site's terminal has: a command it does not know,
	// which it names back. The other site's terminal has not been drawn yet,
	// so this is the one place there is to type.
	await terminal.pressSequentially( 'only-in-first', { delay: 10 } );
	await terminal.press( 'Enter' );
	await expect( terminalScreen( page ) ).toContainText( 'Unsupported command: only-in-first' );

	// INVARIANT — the tray is the window's: it stays open across a change of
	// site, and what it shows is the site now open, whose terminal has none
	// of the other's.
	await ui.sidebarEntry( page, 'second-site' ).click();
	await expect( ui.siteHeading( page, 'second-site' ) ).toBeVisible();
	await expect( tray ).toBeVisible();
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );
	await expect( terminalScreen( page ) ).not.toContainText( 'only-in-first' );

	// INVARIANT — closed from inside, the tray goes and the focus goes back
	// to the button that opened it, not to the top of the document.
	await tray.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( tray ).toHaveCount( 0 );
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( toggle ).toBeFocused();

	// INVARIANT — closing it and looking at another site cost the first
	// site's terminal nothing: opened again on that site, what was printed
	// is there.
	await ui.sidebarEntry( page, 'first-site' ).click();
	await expect( ui.siteHeading( page, 'first-site' ) ).toBeVisible();
	await toggle.click();
	await expect( terminalScreen( page ) ).toContainText( 'Unsupported command: only-in-first' );

	// INVARIANT — and the button that opened it closes it.
	await toggle.click();
	await expect( tray ).toHaveCount( 0 );
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
} );

test( 'the tray\'s edge is moved with the arrow keys and with a pointer, stays inside its limits, and the terminal is fitted to the room', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	const tray = await ui.openTray( page, 'Terminal' );
	const edge = trayEdge( page );
	const limits = trayHeightLimits( await page.evaluate( () => window.innerHeight ) );
	const height = async () => Math.round( ( await tray.boundingBox() ).height );
	const said = async () => Number( await edge.getAttribute( 'aria-valuenow' ) );
	// How many rows the terminal has drawn, and how many more rows and
	// columns would fit in the element it is drawn in: none, when it is
	// fitted. A column is as wide as the widest row drawn is long, over the
	// characters it holds; the room is what is left beside the scrollbar,
	// where the platform draws one.
	const fit = () => terminalScreen( page ).evaluate( ( rows ) => {
		const screen = rows.closest( '.xterm' ).parentElement;
		const viewport = screen.querySelector( '.xterm-viewport' );
		const rowHeight = rows.firstElementChild.getBoundingClientRect().height;
		const measure = screen.querySelector( '.xterm-char-measure-element' );
		const columnWidth = measure.getBoundingClientRect().width / measure.textContent.length;
		const room = screen.clientWidth - ( viewport.offsetWidth - viewport.clientWidth );
		const columns = Math.round( rows.getBoundingClientRect().width / columnWidth );
		return {
			rows: rows.children.length,
			spare: Math.floor( ( screen.clientHeight - rows.children.length * rowHeight ) / rowHeight ),
			spareColumns: Math.floor( room / columnWidth ) - columns,
			overhang: Math.max( 0, Math.ceil( rows.getBoundingClientRect().width - room ) ),
		};
	} );
	// The tray's notes, under the terminal, are inside the tray.
	const notesInside = async () => {
		const notes = await tray.getByText( /^Type help to list supported commands/ ).boundingBox();
		const box = await tray.boundingBox();
		return notes.y + notes.height <= box.y + box.height;
	};

	// CHARACTERISATION — it opens at the height it is given until someone
	// moves it. INVARIANT — and the edge says how tall the tray is, and how
	// tall it may be.
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );
	expect( await height() ).toBe( DEFAULT_TRAY_HEIGHT );
	expect( await said() ).toBe( DEFAULT_TRAY_HEIGHT );
	await expect( edge ).toHaveAttribute( 'aria-valuemin', String( limits.min ) );
	await expect( edge ).toHaveAttribute( 'aria-valuemax', String( limits.max ) );
	expect( limits.min ).toBe( MIN_TRAY_HEIGHT );

	// INVARIANT — the terminal has as many rows and as many columns as the
	// tray has room for, and no row runs under the tray's edge or its own
	// scrollbar.
	await expect.poll( fit ).toMatchObject( { spare: 0, spareColumns: 0, overhang: 0 } );
	const rowsAtFirst = ( await fit() ).rows;

	// INVARIANT — the up arrow makes the tray taller by a step, the terminal
	// gains rows to match, and the down arrow takes both back.
	await edge.focus();
	await page.keyboard.press( 'ArrowUp' );
	await expect.poll( height ).toBe( DEFAULT_TRAY_HEIGHT + TRAY_KEY_STEP );
	expect( await said() ).toBe( DEFAULT_TRAY_HEIGHT + TRAY_KEY_STEP );
	await expect.poll( async () => ( await fit() ).spare ).toBe( 0 );
	expect( ( await fit() ).rows ).toBeGreaterThan( rowsAtFirst );
	await page.keyboard.press( 'ArrowDown' );
	await expect.poll( height ).toBe( DEFAULT_TRAY_HEIGHT );
	await expect.poll( async () => ( await fit() ).rows ).toBe( rowsAtFirst );

	// INVARIANT — End is the tray at its largest and Home at its smallest,
	// as a splitter's keys are for the pane it sizes, and no key goes past
	// either. The edge names the tray as what it sizes.
	await expect( edge ).toHaveAttribute( 'aria-controls', await tray.getAttribute( 'id' ) );
	await page.keyboard.press( 'End' );
	await expect.poll( height ).toBe( limits.max );
	await page.keyboard.press( 'ArrowUp' );
	await expect.poll( height ).toBe( limits.max );
	await expect.poll( fit ).toMatchObject( { spare: 0, spareColumns: 0, overhang: 0 } );
	await page.keyboard.press( 'Home' );
	await expect.poll( height ).toBe( limits.min );
	await page.keyboard.press( 'ArrowDown' );
	await expect.poll( height ).toBe( limits.min );

	// INVARIANT — at its smallest the tray still holds a terminal that can
	// be read, fitted, with what it says beneath itself inside the tray.
	await expect.poll( fit ).toMatchObject( { spare: 0, spareColumns: 0, overhang: 0 } );
	expect( ( await fit() ).rows ).toBeGreaterThanOrEqual( 2 );
	expect( await notesInside() ).toBe( true );

	// INVARIANT — dragged, the edge follows the pointer: up by this much
	// makes the tray this much taller, and the terminal is fitted again.
	const edgeBox = await edge.boundingBox();
	const hold = { x: edgeBox.x + edgeBox.width / 2, y: edgeBox.y + edgeBox.height / 2 };
	await page.mouse.move( hold.x, hold.y );
	await page.mouse.down();
	await page.mouse.move( hold.x, hold.y - 60, { steps: 6 } );
	await page.mouse.up();
	await expect.poll( height ).toBe( limits.min + 60 );
	expect( await said() ).toBe( limits.min + 60 );
	await expect.poll( async () => ( await fit() ).spare ).toBe( 0 );

	// INVARIANT — and a drag past the limit stops at it.
	await page.mouse.move( hold.x, hold.y - 60 );
	await page.mouse.down();
	await page.mouse.move( hold.x, 0, { steps: 6 } );
	await page.mouse.up();
	await expect.poll( height ).toBe( limits.max );

	// INVARIANT — a drag that loses the pointer is over. The edge is taken
	// hold of, the pointer is taken from it without the button being let go,
	// as leaving the window mid-drag does, and a move across the edge then
	// moves nothing.
	const top = await edge.boundingBox();
	const grip = { x: top.x + top.width / 2, y: top.y + top.height / 2 };
	await page.mouse.move( grip.x, grip.y );
	await page.mouse.down();
	// A first move, which is when the edge has the pointer; upward, where the
	// tray is at its limit and has nowhere to go.
	await page.mouse.move( grip.x, grip.y - 2 );
	// The mouse is pointer 1.
	await edge.evaluate( ( element ) => element.releasePointerCapture( 1 ) );
	await page.mouse.move( grip.x + 20, grip.y + 3 );
	await page.mouse.up();
	await page.evaluate( () => window.api.getSitesWithMeta() );
	expect( await height() ).toBe( limits.max );

	// INVARIANT — the height is the tray's, not the terminal's: closed and
	// opened again, it is as tall as it was left.
	await ui.trayToggle( page, 'Terminal' ).click();
	await expect( tray ).toHaveCount( 0 );
	await ui.trayToggle( page, 'Terminal' ).click();
	await expect.poll( height ).toBe( limits.max );
} );

test( 'a build that fails with its output in the terminal brings the terminal up', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	advanceOrigin( site.origin, { 'src/wp-login.php': '<?php // newer trunk\n' } );
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );
	const tray = ui.tray( page, 'Terminal' );
	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await expect( tray ).toHaveCount( 0 );

	// An update, which resets the tree and then builds, printing in the
	// terminal. CHARACTERISATION — with the lockfile unchanged the build is
	// the one script it runs.
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
	await expect.poll( scripts.asked, { timeout: 60_000 } ).toEqual( [ 'build' ] );

	// INVARIANT — while it runs, nothing has opened the tray: it is the
	// failure that does, not the build.
	await scripts.prints( 1, 'PRINTED-BEFORE-IT-FAILED\n' );
	await scripts.heard();
	await expect( tray ).toHaveCount( 0 );

	// INVARIANT — the build fails, the page says the update is incomplete,
	// and the terminal is on screen with what the build printed and how it
	// ended, its button in the footer pressed.
	await scripts.ends( 1, 1 );
	await expect( page.getByText( 'Update incomplete', { exact: true } ) ).toBeVisible();
	await expect( tray ).toBeVisible();
	await expect( ui.trayToggle( page, 'Terminal' ) ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( terminalScreen( page ) ).toContainText( 'PRINTED-BEFORE-IT-FAILED' );
	await expect( terminalScreen( page ) ).toContainText( 'Update incomplete — the build failed.' );
} );

test( 'a failure on a site that is not the open one waits for that site to be opened', async ( { session } ) => {
	const updating = await makeSite( session, { label: 'updating-site', origin: true } );
	const other = await makeSite( session, { label: 'other-site' } );
	advanceOrigin( updating.origin, { 'src/wp-login.php': '<?php // newer trunk\n' } );
	// The app opens on the newest site.
	other.settings.siteMeta[ other.dir ].createdAt = new Date( Date.now() - 7 * 24 * 60 * 60 * 1000 ).toISOString();
	const { app, page } = await session.start( {
		sites: [ updating.dir, other.dir ],
		siteMeta: { ...updating.settings.siteMeta, ...other.settings.siteMeta },
		preferences: {},
	} );
	const scripts = await standInForScripts( app, page );
	const tray = ui.tray( page, 'Terminal' );
	await expect( ui.siteHeading( page, 'updating-site' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
	await expect.poll( scripts.asked, { timeout: 60_000 } ).toEqual( [ 'build' ] );

	// INVARIANT — the tray shows the open site's terminal, so a build that
	// fails on another site does not open it: what would come up is not
	// where the output is.
	await ui.sidebarEntry( page, 'other-site' ).click();
	await expect( ui.siteHeading( page, 'other-site' ) ).toBeVisible();
	await scripts.ends( 1, 1 );
	// The site's page, out of sight, says the update is incomplete once the
	// build's end has been taken in, which is after the tray was or was not
	// asked for.
	await expect( page.getByText( 'Update incomplete', { exact: true } ) ).toHaveCount( 1 );
	await expect( tray ).toHaveCount( 0 );

	// INVARIANT — going back to the site whose build failed brings its
	// terminal up, with the failure in it: its page is saying where to look.
	// The sites list names the site with how its update stands.
	await page.getByRole( 'button', { name: /^updating-site \(Update incomplete/ } ).click();
	await expect( ui.siteHeading( page, 'updating-site' ) ).toBeVisible();
	await expect( tray ).toBeVisible();
	await expect( terminalScreen( page ) ).toContainText( 'Update incomplete — the build failed.' );
} );

test( 'an action refused because a command is running brings the terminal up to say so', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );
	const tray = await ui.openTray( page, 'Terminal' );

	// A command that holds the terminal and is neither an install nor a
	// build: a script typed there. Then the tray is put away, as it would be
	// by someone who went back to the page while their tests run.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.terminalInput( page ).pressSequentially( 'npm run test', { delay: 10 } );
	await ui.terminalInput( page ).press( 'Enter' );
	await expect.poll( scripts.asked ).toEqual( [ 'test' ] );
	await tray.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( tray ).toHaveCount( 0 );

	// INVARIANT — an update asked for now is turned away, and the line that
	// says so is printed in the terminal and nowhere else: the terminal comes
	// up with it, so that the menu item is not a control that did nothing.
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
	await expect( tray ).toBeVisible();
	await expect( terminalScreen( page ) ).toContainText( 'A command is already running. Press Ctrl+C to stop it.' );
	// INVARIANT — and it was turned away: nothing else was run.
	expect( await scripts.asked() ).toEqual( [ 'test' ] );
} );

test( 'a build that fails with its output in the logs leaves the tray closed', async ( { session } ) => {
	// A site with no build: the watch's button runs the build first, and
	// that build prints in the watch's log, not in the terminal.
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );
	const tray = ui.tray( page, 'Terminal' );
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( scripts.asked ).toEqual( [ 'build' ] );

	// INVARIANT — it fails, the page says so and says its last lines are in
	// the logs, and the terminal, which has none of them, is not brought up.
	await scripts.ends( 1, 1 );
	await expect( page.getByText( /^The build that has to finish before the watch can start failed.* Its last lines are in the Logs\.$/ ) ).toBeVisible();
	await scripts.heard();
	await expect( tray ).toHaveCount( 0 );
} );
