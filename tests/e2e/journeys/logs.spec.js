/**
 * The Logs panel: what the dev server said, and what WordPress wrote to its
 * debug.log while it ran (#554).
 *
 * A contributor's change shows up here before it shows up anywhere else: a
 * notice, a deprecation, a fatal. The panel has to show what the file holds,
 * say that something arrived while they were reading the other tab, and keep
 * its three buttons honest: Copy copies what is on screen, Show in folder
 * reveals the file the path names, and Clear empties that file and not only
 * the pane, because the pane is refilled from the file the next time a server
 * starts.
 *
 * The debug.log half is real. The app tails a file under the site, and the
 * test writes to that file the way WordPress does. The dev server is not
 * real: a journey does not run one, so its start is answered by a stub and
 * what it would print is said for it, as TESTING.md describes. The file
 * manager and the clipboard are the person's who runs the suite, so both are
 * stand-ins.
 *
 * What the stand-in for the server leaves out. The real start answers only
 * once the server has an address; the stub answers at once, so here the
 * debug.log tail attaches while the button still reads "Starting dev
 * server...", which a real run never shows, and the test has to say the
 * address itself before there is a server to stop. The real server's output
 * goes to the window that asked for it and into the app's log; the test's
 * goes to every window, of which there is one, and into no log.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { TRAY_KEY_STEP } = require( '../../../src/renderer/tray.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

// The two processes the dev server starts never finish, the page it opens
// when it is up stays closed, and the file manager is asked nothing: the test
// keeps what it would have been shown.
async function standInForTheServer( app ) {
	await app.evaluate( ( { ipcMain, shell } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-logs' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async () => ( { ok: true } ) );
		ipcMain.removeHandler( 'url:open' );
		ipcMain.handle( 'url:open', () => true );
		shell.showItemInFolder = ( filePath ) => {
			global.__e2eRevealed = ( global.__e2eRevealed || [] ).concat( [ filePath ] );
		};
	} );
}

// What the main process tells the window while a server runs.
const tell = ( app, channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
	for ( const win of BrowserWindow.getAllWindows() ) {
		win.webContents.send( to, what );
	}
}, [ channel, payload ] );

// Told and heard: the reply to a question asked after the telling arrives
// after it.
const heard = ( page ) => page.evaluate( () => window.api.getSitesWithMeta() );

const lines = ( from, to, word ) => {
	let text = '';
	for ( let n = from; n <= to; n++ ) {
		text += `${ word } ${ n }\n`;
	}
	return text;
};

test( 'debug.log shows what the file holds, counts what arrived unseen, and copies, reveals and clears the file it tails', async ( { session } ) => {
	const site = await makeSite( session );
	// Where WordPress writes it. A line is already there, from an earlier run.
	const logFile = path.join( site.dir, 'build', 'wp-content', 'debug.log' );
	fs.mkdirSync( path.dirname( logFile ), { recursive: true } );
	fs.writeFileSync( logFile, 'PHP Notice: left by an earlier run\n' );
	const wordpressWrites = ( text ) => fs.appendFileSync( logFile, text );

	const { app, page } = await session.start( site.settings );
	await standInForTheServer( app );
	await page.evaluate( () => {
		navigator.clipboard.writeText = async ( text ) => {
			window.__e2eCopied = text;
		};
	} );

	const logs = await ui.openTray( page, 'Logs' );
	const serverTab = ui.logTab( page, 'Server' );
	const debugTab = ( unread ) => ui.logTab( page, unread ? `Debug.log (${ unread })` : 'Debug.log' );
	const line = ( text ) => logs.getByText( text, { exact: true } );
	const empty = logs.getByText( /^No PHP notices or errors yet\./ );
	const showInFolder = logs.getByRole( 'button', { name: 'Show in folder', exact: true } );
	const copy = logs.getByRole( 'button', { name: /^(Copy|Copied|Could not copy)$/ } );
	const clear = logs.getByRole( 'button', { name: 'Clear', exact: true } );

	// CHARACTERISATION — before a server has run the tab holds nothing,
	// though the file does, and there is nothing to copy, reveal or clear.
	await debugTab().click();
	await expect( empty ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the logs are in the tray (#558), which is named and headed
	// for what it shows, and a pane is the design system's weak surface, the
	// one the terminal has (#557).
	await expect( logs.getByRole( 'heading', { level: 2, name: 'Logs', exact: true } ) ).toBeVisible();
	await expect( ui.trayToggle( page, 'Logs' ) ).toHaveAttribute( 'aria-pressed', 'true' );
	const tokenColour = ( token ) => ui.tokenColour( page, token );
	expect( await empty.locator( '..' ).evaluate( ( pane ) => window.getComputedStyle( pane ).backgroundColor ) ).toBe( await tokenColour( 'var(--wpds-color-background-surface-neutral-weak)' ) );
	await expect( logs.getByText( 'The log file appears once the dev server has run.', { exact: true } ) ).toBeVisible();
	// INVARIANT — a pane takes the room the tray has, and is not the fixed
	// height it was on the page: the tray made taller by a step makes the
	// pane taller by as much.
	const paneHeight = async () => ( await empty.locator( '..' ).boundingBox() ).height;
	const heightAtFirst = await paneHeight();
	await page.getByRole( 'separator', { name: 'Resize tray', exact: true } ).focus();
	await page.keyboard.press( 'ArrowUp' );
	await expect.poll( paneHeight ).toBe( heightAtFirst + TRAY_KEY_STEP );
	await expect( showInFolder ).toBeDisabled();
	await expect( copy ).toBeDisabled();
	await expect( clear ).toBeDisabled();

	// INVARIANT — what arrives while the other tab is being read is counted
	// on this one. CHARACTERISATION — the count is two: the line the file
	// held, and the line the app adds to say where the earlier run ends, which
	// counts as unseen like any other.
	await serverTab.click();
	await ui.startDevServerButton( page ).click();
	await expect( debugTab( 2 ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — opening the tab shows them, says where the file is, and
	// takes the count away.
	await debugTab( 2 ).click();
	await expect( line( 'PHP Notice: left by an earlier run' ) ).toBeVisible();
	await expect( line( '—— tail attached; everything above is from an earlier run ——' ) ).toBeVisible();
	await expect( logs.getByText( logFile, { exact: true } ) ).toBeVisible();
	await expect( debugTab() ).toBeVisible();

	// INVARIANT — a line WordPress writes arrives without anything being
	// clicked, and one that arrives while the tab is open is not counted as
	// unseen.
	wordpressWrites( 'PHP Warning: seen as it arrives\n' );
	await expect( line( 'PHP Warning: seen as it arrives' ) ).toBeVisible();
	await heard( page );
	await expect( debugTab() ).toBeVisible();

	// INVARIANT — a line is coloured by what it is, in the design system's
	// colours (#557): a warning in the warning's, the notice left by the
	// earlier run in the caution's, and the two are not the same. The words
	// say it too; the colour is a second telling.
	const colourOf = ( locator ) => locator.evaluate( ( element ) => window.getComputedStyle( element ).color );
	const warning = await tokenColour( 'var(--wpds-color-foreground-content-warning-weak)' );
	const caution = await tokenColour( 'var(--wpds-color-foreground-content-caution-weak)' );
	expect( await colourOf( line( 'PHP Warning: seen as it arrives' ) ) ).toBe( warning );
	expect( await colourOf( line( 'PHP Notice: left by an earlier run' ) ) ).toBe( caution );
	expect( warning ).not.toBe( caution );

	// INVARIANT — and two that arrive unseen are counted as two.
	await serverTab.click();
	wordpressWrites( 'PHP Deprecated: first unseen\nPHP Deprecated: second unseen\n' );
	await expect( debugTab( 2 ) ).toBeVisible();
	await debugTab( 2 ).click();
	await expect( line( 'PHP Deprecated: second unseen' ) ).toBeVisible();

	// INVARIANT — a line that arrives while the tray is put away, or is
	// showing the terminal, is in the pane when the logs come back, and the
	// logs come back on the tab they were left on (#558).
	await ui.trayToggle( page, 'Logs' ).click();
	await expect( logs ).toHaveCount( 0 );
	wordpressWrites( 'PHP Notice: written with the tray closed\n' );
	await ui.openTray( page, 'Terminal' );
	wordpressWrites( 'PHP Notice: written under the terminal\n' );
	await heard( page );
	await ui.openTray( page, 'Logs' );
	await expect( debugTab() ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( line( 'PHP Notice: written with the tray closed' ) ).toBeVisible();
	await expect( line( 'PHP Notice: written under the terminal' ) ).toBeVisible();
	// INVARIANT — and lines that arrive on another tab's watch are still
	// counted when the tray has been away and come back: putting the logs
	// away is not reading them.
	await serverTab.click();
	wordpressWrites( 'PHP Notice: third unseen\nPHP Notice: fourth unseen\n' );
	await expect( debugTab( 2 ) ).toBeVisible();
	await ui.openTray( page, 'Terminal' );
	wordpressWrites( 'PHP Notice: fifth unseen\n' );
	await heard( page );
	await ui.openTray( page, 'Logs' );
	await expect( debugTab( 3 ) ).toBeVisible();
	await debugTab( 3 ).click();
	await expect( debugTab() ).toBeVisible();

	// INVARIANT — Copy copies what the pane shows, and says it did.
	await copy.click();
	await expect( copy ).toHaveAccessibleName( 'Copied' );
	const copied = await page.evaluate( () => window.__e2eCopied );
	expect( copied ).toContain( 'PHP Notice: left by an earlier run\n' );
	expect( copied ).toContain( 'PHP Deprecated: second unseen\n' );

	// INVARIANT — Show in folder reveals the file the panel names.
	await showInFolder.click();
	await expect.poll( () => app.evaluate( () => global.__e2eRevealed || [] ) ).toEqual( [ logFile ] );

	// INVARIANT — Clear empties the file and not only the pane, and the tail
	// goes on: the next line WordPress writes arrives.
	await clear.click();
	await expect( empty ).toBeVisible();
	await expect.poll( () => fs.statSync( logFile ).size ).toBe( 0 );
	wordpressWrites( 'PHP Notice: after the clear\n' );
	await expect( line( 'PHP Notice: after the clear' ) ).toBeVisible();

	// CHARACTERISATION — stopping the server leaves the pane as it was: after
	// a crash this is the thing to read. The button offers to stop only a
	// server that has an address, and the stub never gave one, so the test
	// says it.
	await tell( app, 'playground:url', { sitePath: site.dir, url: 'http://127.0.0.1:9400/' } );
	await ui.stopDevServerButton( page ).click();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await expect( line( 'PHP Notice: after the clear' ) ).toBeVisible();

	// INVARIANT — the next start shows the file once, from its first line to
	// the one written while nothing was running. Two things have to have
	// happened for that. The stop ended the tail in the main process: a tail
	// left running is not started again, so the file would not be replayed,
	// and neither the marker nor the earlier line would be there. And the
	// start emptied the pane before the replay: the line already in it would
	// otherwise be there twice.
	wordpressWrites( 'PHP Notice: written while stopped\n' );
	await ui.startDevServerButton( page ).click();
	await expect( line( 'PHP Notice: written while stopped' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( line( '—— tail attached; everything above is from an earlier run ——' ) ).toBeVisible();
	await heard( page );
	await expect( line( 'PHP Notice: after the clear' ) ).toHaveCount( 1 );
	await expect( line( 'PHP Notice: written while stopped' ) ).toHaveCount( 1 );
} );

test( 'the Server tab follows the server\'s output to its last line, stops following when scrolled away from it, and follows again from the bottom', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await standInForTheServer( app );
	const serverSays = ( text ) => tell( app, 'playground:log', { sitePath: site.dir, type: 'stdout', data: text } );

	const logs = await ui.openTray( page, 'Logs' );
	const line = ( text ) => logs.getByText( text, { exact: true } );
	// Where the pane a line is in has been scrolled to. A pane is the nearest
	// box around the line that scrolls, so this reads the shape of the markup;
	// it reads the pane's own scroll position and nothing of where the pane is
	// on the page, which moves as the page scrolls to the next step.
	const paneOf = ( locator ) => locator.evaluate( ( element ) => {
		let pane = element.parentElement;
		while ( pane && ! [ 'auto', 'scroll' ].includes( window.getComputedStyle( pane ).overflowY ) ) {
			pane = pane.parentElement;
		}
		return {
			atTop: pane.scrollTop === 0,
			atBottom: pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 8,
			scrolls: pane.scrollHeight > pane.clientHeight,
		};
	} );
	// Scrolls it, and tells the pane so. A page is told of a scroll when it
	// next draws, not when the position is set, and a window that is hidden
	// or covered does not draw; so the test sends the event the browser
	// would, and what follows does not depend on a frame.
	const scrollPaneOf = ( locator, to ) => locator.evaluate( ( element, where ) => {
		let pane = element.parentElement;
		while ( pane && ! [ 'auto', 'scroll' ].includes( window.getComputedStyle( pane ).overflowY ) ) {
			pane = pane.parentElement;
		}
		pane.scrollTop = where === 'top' ? 0 : pane.scrollHeight;
		pane.dispatchEvent( new window.Event( 'scroll' ) );
	}, to );

	// The page listens for the server's output from the moment it asks for a
	// server, which is some way into what the button does. Nothing on screen
	// marks that moment, so the test says one line until it is shown.
	await ui.startDevServerButton( page ).click();
	await expect.poll( async () => {
		await serverSays( 'the server is starting\n' );
		return line( 'the server is starting' ).count();
	}, { timeout: 30_000 } ).toBeGreaterThan( 0 );

	// INVARIANT — what the server prints is shown, and more than the pane
	// holds leaves it at the last line.
	await serverSays( lines( 1, 60, 'server line' ) );
	await expect( line( 'server line 60' ) ).toBeVisible();
	await expect.poll( async () => ( await paneOf( line( 'server line 60' ) ) ).scrolls ).toBe( true );
	await expect.poll( async () => ( await paneOf( line( 'server line 60' ) ) ).atBottom ).toBe( true );

	// INVARIANT — scrolled up to read something, the pane stays where it was
	// put when more arrives.
	await scrollPaneOf( line( 'server line 60' ), 'top' );
	await heard( page );
	await serverSays( lines( 61, 80, 'server line' ) );
	await expect( line( 'server line 80' ) ).toHaveCount( 1 );
	await heard( page );
	expect( ( await paneOf( line( 'server line 80' ) ) ).atTop ).toBe( true );

	// INVARIANT — scrolled back to the bottom, it follows again.
	await scrollPaneOf( line( 'server line 80' ), 'bottom' );
	await heard( page );
	await serverSays( lines( 81, 100, 'server line' ) );
	await expect( line( 'server line 100' ) ).toHaveCount( 1 );
	await expect.poll( async () => ( await paneOf( line( 'server line 100' ) ) ).atBottom ).toBe( true );

	// INVARIANT — a tab left and come back to is a new pane, and it opens at
	// the last line too, not at the top.
	await ui.logTab( page, 'Debug.log' ).click();
	await expect( line( 'server line 100' ) ).toHaveCount( 0 );
	await ui.logTab( page, 'Server' ).click();
	await expect( line( 'server line 100' ) ).toHaveCount( 1 );
	await expect.poll( async () => ( await paneOf( line( 'server line 100' ) ) ).atBottom ).toBe( true );

	// INVARIANT — and so is a pane whose tray was put away while the server
	// went on printing: brought back, it is at the last line, not where it
	// was left and not at the top (#558).
	await ui.trayToggle( page, 'Logs' ).click();
	await expect( logs ).toHaveCount( 0 );
	await serverSays( lines( 101, 160, 'server line' ) );
	await heard( page );
	await ui.openTray( page, 'Logs' );
	await expect( line( 'server line 160' ) ).toHaveCount( 1 );
	await expect.poll( async () => ( await paneOf( line( 'server line 160' ) ) ).atBottom ).toBe( true );
} );
