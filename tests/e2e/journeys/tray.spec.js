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
 * Then the one time the tray opens without being asked. On the page the
 * terminal and the logs were always in view, and the page still says "its
 * output is in the Terminal" of a build that failed, still refuses an action
 * with a line printed there, and still says "its last lines are in the Logs"
 * of a build watch that ended by itself. So each brings up the one it points
 * at, and not the other.
 *
 * The last is the tray holding one thing at a time: the footer has a button
 * for the terminal and one for the logs, and pressing one puts its own in
 * the tray in the other's place.
 *
 * What the terminal does with what is typed in it is `terminal.spec.js`, and
 * what the logs show is `logs.spec.js`.
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
		global.__e2eTrayKills = [];
		ipcMain.removeHandler( 'npm:kill' );
		ipcMain.handle( 'npm:kill', ( event, params ) => {
			global.__e2eTrayKills.push( params.runId );
			return { ok: true };
		} );
	} );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	return {
		asked: () => app.evaluate( () => global.__e2eTrayScripts ),
		kills: () => app.evaluate( () => global.__e2eTrayKills ),
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
	// The two hints under the terminal arrive with the site's status, once it
	// is known to be built, and take their two lines from the terminal's
	// room. Nothing is measured until they are there.
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	const edge = trayEdge( page );
	const limits = trayHeightLimits( await page.evaluate( () => window.innerHeight ) );
	const height = async () => Math.round( ( await tray.boundingBox() ).height );
	const said = async () => Number( await edge.getAttribute( 'aria-valuenow' ) );
	// How many rows the terminal has drawn, and how many more rows and
	// columns would fit in the element it is drawn in: none, when it is
	// fitted, and fewer than none when it was given more than there is room
	// for. The room is what is left beside the scrollbar, where the platform
	// draws one.
	//
	// The columns are counted from what is left over beside the rows, in
	// columns as wide as the text on screen is drawn: the longest run of
	// text, over the characters in it. That is this test's own measure and
	// not the terminal's, which is the point of it, and the two differ by a
	// hair with the font. So a column is taken a twentieth wider than
	// measured, and half a pixel is let go: what is left then has to be less
	// than a column, and not less than nothing.
	const fit = () => terminalScreen( page ).evaluate( ( rows ) => {
		const screen = rows.closest( '.xterm' ).parentElement;
		const viewport = screen.querySelector( '.xterm-viewport' );
		const rowHeight = rows.firstElementChild.getBoundingClientRect().height;
		const line = Array.from( rows.querySelectorAll( 'span' ) ).reduce( ( longest, span ) => ( span.textContent.length > longest.textContent.length ? span : longest ) );
		const drawn = document.createRange();
		drawn.selectNodeContents( line );
		const columnWidth = drawn.getBoundingClientRect().width / line.textContent.length;
		const room = screen.clientWidth - ( viewport.offsetWidth - viewport.clientWidth );
		const leftOver = room - rows.getBoundingClientRect().width;
		return {
			rows: rows.children.length,
			spare: Math.floor( ( screen.clientHeight - rows.children.length * rowHeight ) / rowHeight ),
			spareColumns: Math.floor( ( leftOver + 0.5 ) / ( columnWidth * 1.05 ) ),
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
	// tray has room for: not one fewer, and none that run under the tray's
	// edge or the terminal's own scrollbar.
	await expect.poll( fit ).toMatchObject( { spare: 0, spareColumns: 0 } );
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
	await expect.poll( fit ).toMatchObject( { spare: 0, spareColumns: 0 } );
	await page.keyboard.press( 'Home' );
	await expect.poll( height ).toBe( limits.min );
	await page.keyboard.press( 'ArrowDown' );
	await expect.poll( height ).toBe( limits.min );

	// INVARIANT — at its smallest the tray still holds a terminal that can
	// be read, with what it says beneath itself inside the tray. A terminal
	// keeps two rows however little room it has, so two is what it would
	// have with no room at all, and rows it has no room for show as fewer
	// than none to spare.
	await expect.poll( fit ).toMatchObject( { spare: 0, spareColumns: 0 } );
	expect( ( await fit() ).rows ).toBeGreaterThan( 2 );
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

test( 'an update that cannot fetch says why in the terminal, and brings the terminal up', async ( { session } ) => {
	// A site with nowhere to fetch from: the update is given up before it
	// touches anything, and the reason is a line the main process prints.
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	const tray = ui.tray( page, 'Terminal' );
	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await expect( tray ).toHaveCount( 0 );
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();

	// INVARIANT — the reason is on screen. It is printed in the terminal and
	// nowhere else, and no run ended to show it: without the terminal the
	// update would look like one that was never asked for.
	await expect( tray ).toBeVisible( { timeout: 30_000 } );
	await expect( terminalScreen( page ) ).toContainText( 'This site has no origin remote to fetch from, so it cannot be updated.' );
} );

test( 'a build that was asked to stop does not bring the terminal back', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	advanceOrigin( site.origin, { 'src/wp-login.php': '<?php // newer trunk\n' } );
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );
	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
	await expect.poll( scripts.asked, { timeout: 60_000 } ).toEqual( [ 'build' ] );

	// The build is stopped from the terminal, and the tray is then put away
	// before the build has ended.
	const tray = await ui.openTray( page, 'Terminal' );
	await ui.terminalInput( page ).press( 'Control+c' );
	await expect.poll( scripts.kills ).toEqual( [ 'e2e-run-1' ] );
	await tray.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( tray ).toHaveCount( 0 );

	// INVARIANT — a run that was asked to stop did not fail: it ends as a
	// killed process does, with no code, the page says where the update
	// stands, and the tray stays where it was put.
	await scripts.ends( 1, null );
	await expect( page.getByText( 'Update incomplete', { exact: true } ) ).toBeVisible();
	await expect( tray ).toHaveCount( 0 );
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

test( 'a site deleted while it builds does not open the tray on the site that is left', async ( { session } ) => {
	const doomed = await makeSite( session, { label: 'doomed-site', origin: true } );
	const kept = await makeSite( session, { label: 'kept-site' } );
	advanceOrigin( doomed.origin, { 'src/wp-login.php': '<?php // newer trunk\n' } );
	// The app opens on the newest site.
	kept.settings.siteMeta[ kept.dir ].createdAt = new Date( Date.now() - 7 * 24 * 60 * 60 * 1000 ).toISOString();
	const { app, page } = await session.start( {
		sites: [ doomed.dir, kept.dir ],
		siteMeta: { ...doomed.settings.siteMeta, ...kept.settings.siteMeta },
		preferences: {},
	} );
	const scripts = await standInForScripts( app, page );
	const tray = ui.tray( page, 'Terminal' );
	await expect( ui.siteHeading( page, 'doomed-site' ) ).toBeVisible( { timeout: 30_000 } );
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
	await expect.poll( scripts.asked, { timeout: 60_000 } ).toEqual( [ 'build' ] );

	// The site is deleted with its build under way, and the build then ends
	// as a run does whose site was taken from under it.
	await ui.siteMenuButton( page ).click();
	await ui.deleteSiteMenuItem( page ).click();
	await ui.confirmYesButton( page, 'Delete site' ).click();
	await expect( ui.siteHeading( page, 'kept-site' ) ).toBeVisible( { timeout: 30_000 } );
	await scripts.ends( 1, 1 );

	// INVARIANT — the tray stays closed: the site that is left has had no
	// failure, and its terminal has nothing to show for one. Nothing on
	// screen changes when the build's end is taken in, so the page is asked
	// what the end itself asks, the gone site's status, and then once more:
	// by the second answer the first asking has been answered and acted on.
	await page.evaluate( ( dir ) => window.api.getSiteStatus( dir ), doomed.dir );
	await scripts.heard();
	await expect( tray ).toHaveCount( 0 );
	await expect( ui.trayToggle( page, 'Terminal' ) ).toHaveAttribute( 'aria-pressed', 'false' );
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

test( 'a build that fails with its output in the logs brings the logs up, on the watch\'s tab, and not the terminal', async ( { session } ) => {
	// A site with no build: the watch's button runs the build first, and
	// that build prints in the watch's log, not in the terminal.
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );
	const scripts = await standInForScripts( app, page );
	const logs = ui.tray( page, 'Logs' );
	await expect( ui.startBuildWatchButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( scripts.asked ).toEqual( [ 'build' ] );

	// INVARIANT — while it builds, nothing has opened the tray.
	await scripts.prints( 1, 'PRINTED-BEFORE-IT-FAILED\n' );
	await scripts.heard();
	await expect( logs ).toHaveCount( 0 );
	await expect( ui.tray( page, 'Terminal' ) ).toHaveCount( 0 );

	// INVARIANT — it fails, the page says so and says its last lines are in
	// the logs, and the logs are on screen, on the watch's tab, with those
	// lines. The terminal, which has none of them, is not what came up.
	await scripts.ends( 1, 1 );
	await expect( page.getByText( /^The build that has to finish before the watch can start failed.* Its last lines are in the Logs\.$/ ) ).toBeVisible();
	await expect( logs ).toBeVisible();
	await expect( ui.logTab( page, 'Build watch (exited 1)' ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( logs.getByText( 'PRINTED-BEFORE-IT-FAILED', { exact: true } ) ).toBeVisible();
	await expect( logs.getByText( 'npm run build failed with code 1 — build watch not started.', { exact: true } ) ).toBeVisible();
	await expect( ui.trayToggle( page, 'Logs' ) ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( ui.trayToggle( page, 'Terminal' ) ).toHaveAttribute( 'aria-pressed', 'false' );

	// INVARIANT — a watch stopped by its own button ended because it was
	// asked to, and brings nothing up: the tray, put away, stays away.
	await logs.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( logs ).toHaveCount( 0 );
	await ui.startBuildWatchButton( page ).click();
	await expect.poll( scripts.asked ).toEqual( [ 'build', 'build' ] );
	await ui.stopBuildWatchButton( page ).click();
	await scripts.ends( 2, null );
	// The line that says the stop has been taken in. It is in the logs, which
	// are not on screen, so it is counted and not looked at.
	await expect( page.getByText( 'npm run build was stopped — build watch not started.', { exact: true } ) ).toHaveCount( 1 );
	await expect( logs ).toHaveCount( 0 );
} );

test( 'the tray holds one thing at a time: each footer button puts its own in it, in the other\'s place', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	const terminal = ui.tray( page, 'Terminal' );
	const logs = ui.tray( page, 'Logs' );
	const pressed = async () => ( {
		terminal: await ui.trayToggle( page, 'Terminal' ).getAttribute( 'aria-pressed' ),
		logs: await ui.trayToggle( page, 'Logs' ).getAttribute( 'aria-pressed' ),
	} );
	await expect( ui.trayToggle( page, 'Logs' ) ).toBeVisible( { timeout: 30_000 } );
	expect( await pressed() ).toEqual( { terminal: 'false', logs: 'false' } );

	// INVARIANT — the logs' button opens the tray on the logs: named and
	// headed for them, with their tabs, and the terminal's button not pressed.
	await ui.trayToggle( page, 'Logs' ).click();
	await expect( logs ).toBeVisible();
	await expect( logs.getByRole( 'heading', { level: 2, name: 'Logs', exact: true } ) ).toBeVisible();
	await expect( ui.logTab( page, 'Server' ) ).toBeVisible();
	await expect( terminal ).toHaveCount( 0 );
	expect( await pressed() ).toEqual( { terminal: 'false', logs: 'true' } );

	// INVARIANT — the terminal's button, pressed while the logs show, puts
	// the terminal there in their place: one tray, and one button pressed.
	await ui.trayToggle( page, 'Terminal' ).click();
	await expect( terminal ).toBeVisible();
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );
	await expect( logs ).toHaveCount( 0 );
	await expect( ui.logTab( page, 'Server' ) ).toHaveCount( 0 );
	expect( await pressed() ).toEqual( { terminal: 'true', logs: 'false' } );

	// INVARIANT — and back, the tray is as tall as it was left: its height
	// is the tray's, whichever it holds.
	await trayEdge( page ).focus();
	await page.keyboard.press( 'ArrowUp' );
	const height = ( await terminal.boundingBox() ).height;
	expect( height ).toBe( DEFAULT_TRAY_HEIGHT + TRAY_KEY_STEP );
	await ui.trayToggle( page, 'Logs' ).click();
	await expect( logs ).toBeVisible();
	expect( ( await logs.boundingBox() ).height ).toBe( height );

	// INVARIANT — closed from inside, the focus goes back to the button of
	// what the tray was holding.
	await logs.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( logs ).toHaveCount( 0 );
	await expect( ui.trayToggle( page, 'Logs' ) ).toBeFocused();
	expect( await pressed() ).toEqual( { terminal: 'false', logs: 'false' } );
} );
