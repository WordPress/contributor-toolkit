/**
 * The logs, in the tray along the bottom of the window (#558): what the dev
 * server said, and what WordPress wrote to its debug.log while it ran (#554).
 *
 * A contributor's change shows up here before it shows up anywhere else: a
 * notice, a deprecation, a fatal. The logs have to show what the file holds,
 * say that something arrived while nobody was reading it, on the tab and on
 * the footer's button, and keep debug.log's three buttons honest: Copy
 * copies what is on screen, Show in folder reveals the file the path names,
 * and Clear empties that file and not only the pane, because the pane is
 * refilled from the file the next time a server starts.
 *
 * The debug.log half is real. The app tails a file under the site, and the
 * test writes to that file the way WordPress does. The dev server is not
 * real: a journey does not run one, so its start is answered by a stub and
 * what it would print is said for it, as TESTING.md describes. The file
 * manager and the clipboard are the person's who runs the suite, so both are
 * stand-ins.
 *
 * What the stand-in for the server leaves out. The real start answers only
 * once the server has an address; the stub answers at once, or when a test
 * that holds it says so, and the test has to say the address itself before
 * there is a server to stop. The real server's output goes to the window
 * that asked for it and into the app's log; the test's goes to every window,
 * of which there is one, and into no log.
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
	await app.evaluate( ( { BrowserWindow, ipcMain, shell } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-logs' } ) );
		// A server that is up at once, unless the test has asked for it to be
		// kept starting until it says: `__e2eHoldStart` before the button is
		// pressed, and `__e2eLetServerStart()` to let it finish.
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async () => {
			if ( global.__e2eHoldStart ) {
				await new Promise( ( finish ) => {
					global.__e2eLetServerStart = finish;
				} );
			}
			return { ok: true };
		} );
		ipcMain.removeHandler( 'url:open' );
		ipcMain.handle( 'url:open', () => true );
		shell.showItemInFolder = ( filePath ) => {
			global.__e2eRevealed = ( global.__e2eRevealed || [] ).concat( [ filePath ] );
		};
		// And what the window is told of debug.log is kept as well as told:
		// a pane that is not on screen cannot say that a line has arrived.
		global.__e2eDebugTold = [];
		for ( const win of BrowserWindow.getAllWindows() ) {
			const send = win.webContents.send.bind( win.webContents );
			win.webContents.send = ( channel, ...args ) => {
				if ( channel === 'wp:debug-log:data' ) global.__e2eDebugTold.push( args[ 0 ].data );
				return send( channel, ...args );
			};
		}
	} );
}

// Everything the window has been told of debug.log so far, as one text.
const debugTold = ( app ) => app.evaluate( () => ( global.__e2eDebugTold || [] ).join( '' ) );
const MARKER = '—— tail attached; everything above is from an earlier run ——';

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

test( 'debug.log shows what the file holds, counts what arrived unseen on its tab and on the footer, and copies, reveals and clears the file it tails', async ( { session } ) => {
	const site = await makeSite( session, { label: 'logs-site' } );
	// And a site with nothing in its log, older, so that the first is the one
	// the window opens on: what the footer counts is the open site's.
	const other = await makeSite( session, { label: 'other-site' } );
	other.settings.siteMeta[ other.dir ].createdAt = new Date( Date.now() - 7 * 24 * 60 * 60 * 1000 ).toISOString();
	const settings = { ...site.settings, sites: [ site.dir, other.dir ], siteMeta: { ...site.settings.siteMeta, ...other.settings.siteMeta } };
	// Where WordPress writes it. A line is already there, from an earlier run.
	const logFile = path.join( site.dir, 'build', 'wp-content', 'debug.log' );
	fs.mkdirSync( path.dirname( logFile ), { recursive: true } );
	fs.writeFileSync( logFile, 'PHP Notice: left by an earlier run\n' );
	const wordpressWrites = ( text ) => fs.appendFileSync( logFile, text );

	const { app, page } = await session.start( settings );
	await standInForTheServer( app );
	await page.evaluate( () => {
		navigator.clipboard.writeText = async ( text ) => {
			window.__e2eCopied = text;
		};
	} );
	await expect( ui.siteHeading( page, 'logs-site' ) ).toBeVisible( { timeout: 30_000 } );

	// What the footer's Logs button says of lines not yet seen: a number on
	// it, and the words that say what the number counts, which are the
	// button's description.
	const logsToggle = ui.trayToggle( page, 'Logs' );
	const countOnFooter = ( count ) => page.getByRole( 'contentinfo' ).getByText( String( count ), { exact: true } );

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
	// height it was on the page: the tray made taller makes the pane taller
	// by as much. How much taller is the window's to say, a step where there
	// is room for one and less in a window whose half the tray has nearly
	// reached, so the pane is read against the tray and not against a number.
	// CHARACTERISATION — the tray is as tall as its edge says it is, which is
	// what the pane's room is measured from.
	const edge = page.getByRole( 'separator', { name: 'Resize tray', exact: true } );
	const saidHeight = async () => Number( await edge.getAttribute( 'aria-valuenow' ) );
	const trayHeight = async () => ( await logs.boundingBox() ).height;
	const paneHeight = async () => ( await empty.locator( '..' ).boundingBox() ).height;
	const saidAtFirst = await saidHeight();
	await expect.poll( trayHeight, { message: `the Logs tray is as tall as its edge says, ${ saidAtFirst }px` } ).toBe( saidAtFirst );
	const paneAtFirst = await paneHeight();
	await edge.focus();
	await page.keyboard.press( 'ArrowUp' );
	await expect.poll( saidHeight ).toBeGreaterThan( saidAtFirst );
	const grownBy = ( await saidHeight() ) - saidAtFirst;
	expect( grownBy ).toBeLessThanOrEqual( TRAY_KEY_STEP );
	await expect.poll( trayHeight ).toBe( saidAtFirst + grownBy );
	await expect.poll( paneHeight, { message: `a pane ${ paneAtFirst }px tall in a tray of ${ saidAtFirst }px is taller by the ${ grownBy }px the tray was made taller by` } ).toBe( paneAtFirst + grownBy );
	await expect( showInFolder ).toBeDisabled();
	await expect( copy ).toBeDisabled();
	await expect( clear ).toBeDisabled();
	// INVARIANT — and it has that room from the moment its tab is selected.
	// The tabs keep the panel that is leaving in the document until the next
	// frame is drawn, and it must not hold a share of the tray for that
	// long: asked before any frame has passed, one panel is taking room,
	// and one still is when the tab just left is gone back to at once.
	// The macOS runner, slow to draw, measured a pane 42.5px short here.
	const oneAtATime = { selected: true, panels: 1 };
	expect( await ui.panelsTakingRoom( logs, 'Server', 'Debug.log' ) ).toEqual( [ oneAtATime, oneAtATime ] );
	await expect( debugTab() ).toHaveAttribute( 'aria-selected', 'true' );

	// INVARIANT — what the file already held when the server started is
	// shown and is not news (#558): told to the window, with the app's line
	// that says where the earlier run ends, it is counted on the tab and on
	// the footer as nothing, or every start would report the last run's
	// notices as unseen.
	await expect( logsToggle ).toHaveAccessibleDescription( '' );
	await serverTab.click();
	await ui.startDevServerButton( page ).click();
	await expect.poll( () => debugTold( app ), { timeout: 30_000 } ).toContain( MARKER );
	expect( await debugTold( app ) ).toContain( 'PHP Notice: left by an earlier run' );
	await heard( page );
	await expect( debugTab() ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '' );
	// INVARIANT — what is written from then on, while the other tab is being
	// read, is counted on this one, and the footer's button counts the same
	// lines, in a number on it and in words with it.
	wordpressWrites( 'PHP Notice: first since the start\nPHP Notice: second since the start\n' );
	await expect( debugTab( 2 ) ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '2 unseen lines in Debug.log' );
	await expect( countOnFooter( 2 ) ).toBeVisible();

	// INVARIANT — opening the tab shows them under what the file held, says
	// where the file is, and takes the count away, from the tab and from the
	// footer.
	await debugTab( 2 ).click();
	await expect( line( 'PHP Notice: left by an earlier run' ) ).toBeVisible();
	await expect( line( MARKER ) ).toBeVisible();
	await expect( line( 'PHP Notice: second since the start' ) ).toBeVisible();
	await expect( logs.getByText( logFile, { exact: true } ) ).toBeVisible();
	await expect( debugTab() ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '' );
	await expect( countOnFooter( 2 ) ).toHaveCount( 0 );

	// INVARIANT — a line WordPress writes arrives without anything being
	// clicked, and one that arrives while the tab is open is not counted as
	// unseen.
	wordpressWrites( 'PHP Warning: seen as it arrives\n' );
	await expect( line( 'PHP Warning: seen as it arrives' ) ).toBeVisible();
	await heard( page );
	await expect( debugTab() ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '' );

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
	// logs come back on the tab they were left on (#558). Until they do the
	// line has not been seen, though its tab is the one that was left
	// selected, and the footer's button is what says so: one line, and then
	// two.
	await logsToggle.click();
	await expect( logs ).toHaveCount( 0 );
	wordpressWrites( 'PHP Notice: written with the tray closed\n' );
	await expect( logsToggle ).toHaveAccessibleDescription( '1 unseen line in Debug.log' );
	await expect( countOnFooter( 1 ) ).toBeVisible();
	await ui.openTray( page, 'Terminal' );
	wordpressWrites( 'PHP Notice: written under the terminal\n' );
	await expect( logsToggle ).toHaveAccessibleDescription( '2 unseen lines in Debug.log' );
	await expect( countOnFooter( 2 ) ).toBeVisible();
	// INVARIANT — the count is the open site's: another site's page has
	// none, and coming back has cost the first site nothing.
	await ui.sidebarEntry( page, 'other-site' ).click();
	await expect( ui.siteHeading( page, 'other-site' ) ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '' );
	await expect( countOnFooter( 2 ) ).toHaveCount( 0 );
	// INVARIANT — and a line that arrives while another site is the open
	// one has not been seen either: it is in the count when its site is
	// come back to.
	wordpressWrites( 'PHP Notice: written while another site was open\n' );
	// Its server was started and never given an address here, so it is still
	// starting, and its entry in the list says so after its name.
	await ui.sidebarEntry( page, 'logs-site (Server starting…)' ).click();
	await expect( ui.siteHeading( page, 'logs-site' ) ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '3 unseen lines in Debug.log' );
	// INVARIANT — the logs coming back on the tab is the lines being seen.
	await ui.openTray( page, 'Logs' );
	await expect( debugTab() ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( line( 'PHP Notice: written with the tray closed' ) ).toBeVisible();
	await expect( line( 'PHP Notice: written under the terminal' ) ).toBeVisible();
	await expect( line( 'PHP Notice: written while another site was open' ) ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '' );
	await expect( countOnFooter( 3 ) ).toHaveCount( 0 );
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
	// INVARIANT — with the logs open on another tab the tab and the footer
	// say the same number.
	await expect( logsToggle ).toHaveAccessibleDescription( '3 unseen lines in Debug.log' );
	await debugTab( 3 ).click();
	await expect( debugTab() ).toBeVisible();
	await expect( logsToggle ).toHaveAccessibleDescription( '' );

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
	await expect( line( MARKER ) ).toBeVisible();
	await heard( page );
	await expect( line( 'PHP Notice: after the clear' ) ).toHaveCount( 1 );
	await expect( line( 'PHP Notice: written while stopped' ) ).toHaveCount( 1 );
} );

test( 'a debug.log that first appears while the server runs is news from its first line', async ( { session } ) => {
	// The common case: nothing writes the file until WordPress has something
	// to log. Its folder is there and the file is not.
	const site = await makeSite( session );
	const logFile = path.join( site.dir, 'build', 'wp-content', 'debug.log' );
	fs.mkdirSync( path.dirname( logFile ), { recursive: true } );
	const { app, page } = await session.start( site.settings );
	await standInForTheServer( app );

	const logs = await ui.openTray( page, 'Logs' );
	const logsToggle = ui.trayToggle( page, 'Logs' );
	await ui.logTab( page, 'Debug.log' ).click();
	await ui.startDevServerButton( page ).click();
	// The panel says where the file is once the tail has been started, which
	// is when the file's folder is being watched for it.
	await expect( logs.getByText( logFile, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — written while the tray is put away, the file's first lines
	// are counted: they were not there when the server started, and are not
	// what an earlier run left. The file arrives whole, by a rename, so that
	// what the app finds when it looks is the two lines and not a file that
	// has been made and not yet written.
	await logsToggle.click();
	await expect( logs ).toHaveCount( 0 );
	fs.writeFileSync( `${ logFile }.writing`, 'PHP Fatal error: the first thing this run logged\nPHP Notice: and the second\n' );
	fs.renameSync( `${ logFile }.writing`, logFile );
	await expect( logsToggle ).toHaveAccessibleDescription( '2 unseen lines in Debug.log' );
	// INVARIANT — and nothing is said under them about an earlier run: the
	// app's line for that is for what the file held before the server
	// started. The window was told the two lines and no more.
	await heard( page );
	expect( await debugTold( app ) ).toBe( 'PHP Fatal error: the first thing this run logged\nPHP Notice: and the second\n' );
	await expect( logsToggle ).toHaveAccessibleDescription( '2 unseen lines in Debug.log' );
	await ui.openTray( page, 'Logs' );
	await expect( logs.getByText( 'PHP Notice: and the second', { exact: true } ) ).toBeVisible();
	await expect( logs.getByText( MARKER, { exact: true } ) ).toHaveCount( 0 );
	await expect( logsToggle ).toHaveAccessibleDescription( '' );

	// INVARIANT — the file saved over itself, as an editor saves it, is not
	// shown again: its two lines were seen, and only the one the save added
	// is news. The save writes a new file at the old path, by a rename, which
	// is what ends the watch on the old one; the tail has to find its place in
	// the new file rather than start it from the top, or every line the file
	// held would be told a second time and counted as unseen.
	await logsToggle.click();
	await expect( logs ).toHaveCount( 0 );
	fs.writeFileSync( `${ logFile }.writing`, `${ fs.readFileSync( logFile, 'utf8' ) }PHP Notice: added by the save\n` );
	fs.renameSync( `${ logFile }.writing`, logFile );
	await expect( logsToggle ).toHaveAccessibleDescription( '1 unseen line in Debug.log' );
	await heard( page );
	expect( await debugTold( app ) ).toBe( 'PHP Fatal error: the first thing this run logged\nPHP Notice: and the second\nPHP Notice: added by the save\n' );
	// INVARIANT — and the tail is on the new file: what WordPress writes to
	// it next arrives, once.
	fs.appendFileSync( logFile, 'PHP Warning: logged after the save\n' );
	await expect( logsToggle ).toHaveAccessibleDescription( '2 unseen lines in Debug.log' );
	await heard( page );
	expect( await debugTold( app ) ).toBe( 'PHP Fatal error: the first thing this run logged\nPHP Notice: and the second\nPHP Notice: added by the save\nPHP Warning: logged after the save\n' );
	await ui.openTray( page, 'Logs' );
	await expect( logs.getByText( 'PHP Notice: added by the save', { exact: true } ) ).toHaveCount( 1 );
	await expect( logs.getByText( 'PHP Notice: and the second', { exact: true } ) ).toHaveCount( 1 );
	await expect( logs.getByText( 'PHP Warning: logged after the save', { exact: true } ) ).toHaveCount( 1 );
	await expect( logsToggle ).toHaveAccessibleDescription( '' );
} );

test( 'what WordPress logs while the server is starting is news, and not what an earlier run left', async ( { session } ) => {
	const site = await makeSite( session );
	const logFile = path.join( site.dir, 'build', 'wp-content', 'debug.log' );
	fs.mkdirSync( path.dirname( logFile ), { recursive: true } );
	fs.writeFileSync( logFile, 'PHP Notice: left by an earlier run\n' );
	const { app, page } = await session.start( site.settings );
	await standInForTheServer( app );
	await app.evaluate( () => {
		global.__e2eHoldStart = true;
	} );
	const logsToggle = ui.trayToggle( page, 'Logs' );

	// INVARIANT — the file is watched from before the server starts, so a
	// line WordPress logs as it boots is one the contributor has not seen,
	// and the footer counts it. Watched only once the server was up, the
	// line would be taken for the earlier run's and counted as nothing.
	await ui.startDevServerButton( page ).click( { timeout: 30_000 } );
	await expect.poll( () => app.evaluate( () => typeof global.__e2eLetServerStart ), { timeout: 30_000 } ).toBe( 'function' );
	fs.appendFileSync( logFile, 'PHP Deprecated: logged while the server was starting\n' );
	await app.evaluate( () => global.__e2eLetServerStart() );
	await expect( logsToggle ).toHaveAccessibleDescription( '1 unseen line in Debug.log' );
	// INVARIANT — and the earlier run's line, told to the window with the
	// app's line under it, has added nothing to that.
	await expect.poll( () => debugTold( app ) ).toContain( MARKER );
	await heard( page );
	await expect( logsToggle ).toHaveAccessibleDescription( '1 unseen line in Debug.log' );
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
