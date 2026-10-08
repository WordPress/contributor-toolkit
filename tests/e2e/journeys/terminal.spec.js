/**
 * The site's terminal: the one place a contributor runs npm install and the
 * site's npm scripts once the setup checklist has run them the first time
 * (#554).
 *
 * It is not a shell. It takes a handful of commands, runs one at a time, and
 * says so when asked for anything else, so what matters is that it runs what
 * was typed and nothing that was not: a script the project does not allow is
 * refused by name, keys pressed while a command runs go nowhere, Ctrl+C stops
 * the command that is running and only that, and a command offered by the
 * hints under it is put at the prompt and left for the contributor to run.
 *
 * Nothing is run. The three handlers that start an install, start a script
 * and stop one are answered by stubs that keep what they were asked, and the
 * test says what a running script would say, on the channels it says it on,
 * as TESTING.md describes. What that leaves out: a real run writes its output
 * to the app's log as well, and ends by itself, with the code the process
 * gave; here a command runs until the test says it has ended, with a code
 * the test chose, including after Ctrl+C. A real install also records in the
 * store whether it failed, before it says it is done; here that is not
 * recorded. A real command, started and stopped, is in `pr-checkout.spec.js`.
 *
 * The screen is read from the terminal's own rows, which is the markup of the
 * library that draws it: nothing with a role holds what a terminal shows. The
 * rows are the dozen lines in view, which can include what earlier steps
 * printed, so every sentence looked for is one that is printed for the first
 * time at its step.
 *
 * The second journey is about a site that was not on screen when the app
 * opened. Every site's view is in the document from launch and only
 * the selected one is shown, so a terminal that lays its text out before its
 * site is on screen does it against a box with no size. It drew every letter
 * a whole cell apart and cut each line in half, and stayed that way once the
 * site was opened. Nothing below the window can see that: it is a matter of
 * what was measured, and when.
 *
 * That it is one terminal from start to finish is pinned in two ways, and
 * not for every moment. A terminal made anew opens on its banner with
 * everything before it gone. One remade as the lock is taken or released has
 * lost the line the next step looks for. One remade while a build ends, when
 * the site's status is read again and the view is drawn again, would be
 * written to as if nothing had happened, so that step looks for the banner,
 * which left the screen many lines before. A terminal remade on any other
 * drawing of the view is not caught here.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

test( 'the terminal runs the commands it knows one at a time, refuses the rest by name, and leaves a suggested command at the prompt for the contributor to run', async ( { session } ) => {
	// The fixture is a site that has been built, which is when the hints under
	// the terminal are shown.
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// The terminal is in the tray, which is closed when the window opens.
	await ui.openTray( page, 'Terminal' );
	await app.evaluate( ( { ipcMain } ) => {
		const asked = { scripts: [], installs: [], kills: [] };
		global.__e2eTerminal = asked;
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', ( event, dir, name, args ) => {
			asked.scripts.push( { dir, name, args } );
			return { runId: `e2e-run-${ asked.scripts.length }` };
		} );
		ipcMain.removeHandler( 'npm:install' );
		ipcMain.handle( 'npm:install', ( event, dir ) => {
			asked.installs.push( dir );
			return { installId: `e2e-install-${ asked.installs.length }` };
		} );
		ipcMain.removeHandler( 'npm:kill' );
		ipcMain.handle( 'npm:kill', ( event, params ) => {
			asked.kills.push( params );
			return { ok: true };
		} );
	} );
	const asked = () => app.evaluate( () => global.__e2eTerminal );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	const heard = () => page.evaluate( () => window.api.getSitesWithMeta() );

	const terminal = ui.terminalInput( page );
	const screen = page.locator( '.xterm-rows' );
	const type = async ( text ) => terminal.pressSequentially( text, { delay: 10 } );
	const enter = async ( text ) => {
		await type( text );
		await terminal.press( 'Enter' );
	};
	const buildHint = ui.terminalHint( page, 'npm run build' );
	// A control elsewhere on the site's view that waits for a build, an
	// install or a trunk update to end, and not for the terminal's lock: it is
	// how the test sees that the rest of the view was told one is running.
	// The field a pull request is asked for in is one, and is on the page
	// whichever of the apply card's tabs is open.
	const prField = ui.prField( page );

	// INVARIANT — the terminal is in the tray (#558), which is a part of the
	// window a screen reader can go to, named for what it holds and headed by
	// the same word. The footer's button for it is pressed while it shows.
	await expect( buildHint ).toBeVisible( { timeout: 30_000 } );
	const region = ui.tray( page, 'Terminal' );
	await expect( region.getByRole( 'heading', { level: 2, name: 'Terminal', exact: true } ) ).toBeVisible();
	await expect( ui.trayToggle( page, 'Terminal' ) ).toHaveAttribute( 'aria-pressed', 'true' );

	// INVARIANT — it is painted with the design system's colours and not
	// with colours of its own: the weak surface the log panes have, with the
	// text's own colour on it. Read where the terminal paints them, since it
	// is told them as values and not by a stylesheet, and held to what the
	// tokens are on this page.
	const tokenColour = ( token ) => ui.tokenColour( page, token );
	const surface = await tokenColour( 'var(--wpds-color-background-surface-neutral-weak)' );
	const text = await tokenColour( 'var(--wpds-color-foreground-content-neutral)' );
	expect( await region.locator( '.xterm-viewport' ).evaluate( ( viewport ) => ( {
		surface: window.getComputedStyle( viewport ).backgroundColor,
		text: window.getComputedStyle( viewport.parentElement.querySelector( '.xterm-rows' ) ).color,
	} ) ) ).toEqual( { surface, text } );
	expect( surface ).not.toBe( text );

	// INVARIANT — a command named under the terminal is in the terminal's
	// type, as it is when it cannot be pressed and is only named.
	const monospace = await page.evaluate( ( expression ) => {
		const probe = document.createElement( 'span' );
		probe.style.fontFamily = expression;
		document.body.appendChild( probe );
		const family = window.getComputedStyle( probe ).fontFamily;
		probe.remove();
		return family;
	}, 'var(--wpds-typography-font-family-mono)' );
	expect( await buildHint.evaluate( ( link ) => window.getComputedStyle( link ).fontFamily ) ).toBe( monospace );

	// CHARACTERISATION — it opens on what it can do, with the scripts this
	// project allows named in the help, and under it the hints are links.
	await expect( screen ).toContainText( 'WordPress npm helper terminal.', { timeout: 30_000 } );
	await expect( screen ).toContainText( 'Run one of: build, build:dev, dev, test, watch, grunt' );
	await expect( buildHint ).toBeVisible();
	await expect( prField ).toBeEnabled();

	// INVARIANT — what it does not know it refuses by name, and it runs
	// nothing. CHARACTERISATION — the scripts it names are Core's today.
	await enter( 'ls -la' );
	await expect( screen ).toContainText( 'Unsupported command: ls -la' );
	await enter( 'npm run deploy' );
	await expect( screen ).toContainText( 'Unsupported script "deploy". Allowed scripts: build, build:dev, dev, test, watch, grunt' );
	await heard();
	expect( ( await asked() ).scripts ).toEqual( [] );

	// INVARIANT — a character taken back is not part of the command, and a
	// script the project allows is run in this site's directory.
	// CHARACTERISATION — with no arguments of its own.
	await type( 'npm run testx' );
	await terminal.press( 'Backspace' );
	await terminal.press( 'Enter' );
	await expect( screen ).toContainText( 'Running npm run test…' );
	await expect.poll( async () => ( await asked() ).scripts ).toEqual( [ { dir: site.dir, name: 'test', args: [] } ] );

	// INVARIANT — while it runs, what the script prints is shown, the hints
	// stop being links, and keys pressed go nowhere: no second command is
	// started. The script is not the build, which takes the hints away by
	// another route, so it is the terminal's own lock that does it here; they
	// were links a moment ago, above.
	await tell( 'npm:run-script:log', { runId: 'e2e-run-1', type: 'stdout', data: 'running 42 tests\n' } );
	await expect( screen ).toContainText( 'running 42 tests' );
	await expect( buildHint ).toHaveCount( 0 );

	// INVARIANT — what a script prints in red is red, in bold as in plain:
	// the design system's colour for an error, which can be told from the
	// text around it. The terminal's own habit is to draw bold text in a
	// brighter colour, which on this surface would be all but black.
	await tell( 'npm:run-script:log', { runId: 'e2e-run-1', type: 'stdout', data: '\u001b[1;31mFAILED-IN-BOLD\u001b[0m \u001b[31mfailed-in-plain\u001b[0m\n' } );
	const red = await tokenColour( 'var(--wpds-color-foreground-content-error-weak)' );
	// Asked until it is so: the terminal draws a row again as more is
	// printed, and a word read off a row that has just been replaced has no
	// colour at all.
	const painted = ( words ) => screen.getByText( words, { exact: true } ).evaluate( ( span ) => ( {
		text: window.getComputedStyle( span ).color,
		behind: window.getComputedStyle( span ).backgroundColor,
	} ) );
	await expect.poll( async () => ( await painted( 'FAILED-IN-BOLD' ) ).text ).toBe( red );
	await expect.poll( async () => ( await painted( 'failed-in-plain' ) ).text ).toBe( red );
	expect( red ).not.toBe( text );

	// INVARIANT — and what it prints on a background of its own can be read:
	// text on the terminal's "black", which is the text's own colour here,
	// is not left the colour of what is behind it.
	await tell( 'npm:run-script:log', { runId: 'e2e-run-1', type: 'stdout', data: '\u001b[40mON-BLACK\u001b[0m\n' } );
	// One look at a time, for the reason above: both colours are read
	// together, off the same row.
	await expect.poll( async () => {
		const onBlack = await painted( 'ON-BLACK' );
		return onBlack.behind === text && onBlack.text !== '' && onBlack.text !== onBlack.behind;
	} ).toBe( true );
	// And the lock alone does not make the button that waits for a build
	// wait: this script is not one.
	await expect( prField ).toBeEnabled();
	await enter( 'npm run watch' );
	await heard();
	expect( ( await asked() ).scripts ).toHaveLength( 1 );
	await expect( screen ).not.toContainText( 'npm run watch' );

	// INVARIANT — Ctrl+C asks for that command to be stopped, by the run it
	// was given, and the command ending gives the prompt and the hints back.
	await terminal.press( 'Control+c' );
	await expect.poll( async () => ( await asked() ).kills ).toEqual( [ { runId: 'e2e-run-1', directoryPath: site.dir } ] );
	await tell( 'npm:run-script:done', { runId: 'e2e-run-1', code: 1 } );
	await expect( screen ).toContainText( 'npm run test exited with code 1' );
	await expect( buildHint ).toBeVisible();

	// INVARIANT — with nothing running, Ctrl+C stops nothing.
	await terminal.press( 'Control+c' );
	await heard();
	expect( ( await asked() ).kills ).toHaveLength( 1 );

	// INVARIANT — a command from the hints is put at the prompt, which is the
	// last thing on the screen, and not run: running it is the contributor's
	// Enter.
	await buildHint.click();
	await expect( screen ).toHaveText( /\$ npm run build\s*$/ );
	await heard();
	expect( ( await asked() ).scripts ).toHaveLength( 1 );
	await terminal.press( 'Enter' );
	await expect.poll( async () => ( await asked() ).scripts ).toHaveLength( 2 );
	expect( ( await asked() ).scripts[ 1 ].name ).toBe( 'build' );

	// INVARIANT — a build that is running is known to the rest of the site's
	// view, which will not put a patch on a tree that is being built, and so
	// is its ending.
	await expect( prField ).toBeDisabled();
	await tell( 'npm:run-script:done', { runId: 'e2e-run-2', code: 0 } );
	await expect( screen ).toContainText( 'npm run build exited with code 0' );
	await expect( prField ).toBeEnabled();

	// INVARIANT — it is still the terminal it was. A build that ends has the
	// site's status read again and the view drawn again before this line is
	// printed; a terminal made anew on the way would have opened on its
	// banner, which this one showed at the start and scrolled away long ago.
	await expect( screen ).not.toContainText( 'WordPress npm helper terminal.' );

	// INVARIANT — the up arrow steps back through what was run: twice from an
	// empty prompt is the command before the last.
	await enter( 'help' );
	await terminal.press( 'ArrowUp' );
	await terminal.press( 'ArrowUp' );
	await terminal.press( 'Enter' );
	await expect.poll( async () => ( await asked() ).scripts ).toHaveLength( 3 );
	expect( ( await asked() ).scripts[ 2 ].name ).toBe( 'build' );
	await tell( 'npm:run-script:done', { runId: 'e2e-run-3', code: 0 } );
	await expect( buildHint ).toBeVisible();

	// INVARIANT — npm install runs the install in this site's directory,
	// shows what it prints and says how it ended, and it starts no script.
	await enter( 'npm install' );
	await expect( screen ).toContainText( 'Running npm install…' );
	await expect.poll( async () => ( await asked() ).installs ).toEqual( [ site.dir ] );
	// INVARIANT — and so is an install that is running.
	await expect( prField ).toBeDisabled();
	await tell( 'npm:install:log', { installId: 'e2e-install-1', type: 'stdout', data: 'added 1 package\n' } );
	await expect( screen ).toContainText( 'added 1 package' );
	await tell( 'npm:install:done', { installId: 'e2e-install-1', code: 0 } );
	await expect( screen ).toContainText( 'npm install exited with code 0' );
	await expect( prField ).toBeEnabled();

	// CHARACTERISATION — its short name runs it too. The third, a bare
	// `install`, is not typed here.
	await enter( 'npm i' );
	await expect.poll( async () => ( await asked() ).installs ).toEqual( [ site.dir, site.dir ] );
	await tell( 'npm:install:done', { installId: 'e2e-install-2', code: 1 } );
	await expect( screen ).toContainText( 'npm install exited with code 1' );
	await heard();
	expect( ( await asked() ).scripts ).toHaveLength( 3 );
} );

// The longest fixed line of the help the terminal prints as it starts: 71
// columns, which the terminal has in the tray of any window these journeys
// run in, so it ends inside the terminal only when a character takes one
// column.
const LONGEST_HELP_LINE = 'Run them here whenever you change files or add a dependency afterwards.';

/**
 * How far the line's text runs past the end of the terminal row that holds
 * it, in pixels: nothing or less when it fits. Read from where the text is
 * laid out, not from what is painted: the row clips what runs past it, which
 * is how a line drawn too wide loses its second half. xterm draws each row as
 * a `div` as wide as its columns, with the text in `span`s inside it.
 *
 * @param {Object} page
 * @return {Promise<number>} The overflow of the visible terminal's row.
 */
async function helpLineOverflow( page ) {
	const row = page.locator( '.xterm-rows > div' ).filter( { hasText: LONGEST_HELP_LINE } ).filter( { visible: true } );
	await expect( row ).toBeVisible();
	return row.evaluate( ( element ) => {
		const text = document.createRange();
		text.selectNodeContents( element );
		return Math.round( text.getBoundingClientRect().right - element.getBoundingClientRect().right );
	} );
}

test( 'the terminal of a site that was not on screen at launch fits its text in its own width, like the one that was', async ( { session } ) => {
	const first = await makeSite( session, { label: 'open-at-launch' } );
	const second = await makeSite( session, { label: 'opened-later' } );
	// The app opens on the newest site, so the older one starts out hidden.
	second.settings.siteMeta[ second.dir ].createdAt = new Date( Date.now() - 7 * 24 * 60 * 60 * 1000 ).toISOString();
	const { page } = await session.start( {
		sites: [ first.dir, second.dir ],
		siteMeta: { ...first.settings.siteMeta, ...second.settings.siteMeta },
		preferences: {},
	} );
	// The tray is closed when the window opens, so both terminals are made out
	// of sight; the first is drawn when the tray is opened, the second when
	// its site is.
	await ui.openTray( page, 'Terminal' );

	// INVARIANT — the site the app opens on draws a character to a column.
	await expect( ui.siteHeading( page, 'open-at-launch' ) ).toBeVisible( { timeout: 30_000 } );
	expect( await helpLineOverflow( page ) ).toBeLessThanOrEqual( 0 );

	// INVARIANT — and so does a site opened afterwards, whose terminal was
	// made while its view was hidden.
	await ui.sidebarEntry( page, 'opened-later' ).click();
	await expect( ui.siteHeading( page, 'opened-later' ) ).toBeVisible();
	expect( await helpLineOverflow( page ) ).toBeLessThanOrEqual( 0 );

	// CHARACTERISATION — going back, the first site's terminal reads as it
	// did. Nothing was written to it while it was hidden, so this is the rows
	// it had already drawn, not ones drawn while hidden.
	await ui.sidebarEntry( page, 'open-at-launch' ).click();
	await expect( ui.siteHeading( page, 'open-at-launch' ) ).toBeVisible();
	expect( await helpLineOverflow( page ) ).toBeLessThanOrEqual( 0 );
} );

// Core's PHP unit tests, typed or started from the ticket card. The handler
// that starts them is a stub, as the script handlers are above: a real run
// installs PHPUnit with Composer first, which takes minutes and the network.
// That run, and the tests passing on the bundled PHP, are the PR's manual
// steps. What is pinned here is the wiring: what reaches main, and that the
// button is the terminal's command and not a second way of running it.
test( 'phpunit runs the arguments it is given, and the ticket card runs the linked ticket\'s tests through the terminal', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await ui.openTray( page, 'Terminal' );
	await app.evaluate( ( { ipcMain } ) => {
		const asked = { runs: [], kills: [] };
		global.__e2ePhpUnit = asked;
		ipcMain.removeHandler( 'phpunit:run' );
		ipcMain.handle( 'phpunit:run', ( event, dir, args ) => {
			asked.runs.push( { dir, args } );
			return { ok: true, runId: `e2e-php-${ asked.runs.length }` };
		} );
		ipcMain.removeHandler( 'npm:kill' );
		ipcMain.handle( 'npm:kill', ( event, params ) => {
			asked.kills.push( params );
			return { ok: true };
		} );
	} );
	const asked = () => app.evaluate( () => global.__e2ePhpUnit );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	const terminal = ui.terminalInput( page );
	const screen = page.locator( '.xterm-rows' );
	const enter = async ( text ) => {
		await terminal.pressSequentially( text, { delay: 10 } );
		await terminal.press( 'Enter' );
	};

	// CHARACTERISATION — the help names the command on a core site.
	await enter( 'help' );
	await expect( screen ).toContainText( 'Run WordPress PHP unit tests, for example phpunit --group 12345' );

	// INVARIANT — what follows `phpunit` reaches main as it was typed, for
	// this site, and nothing else is asked for.
	await enter( 'phpunit --filter Tests_Formatting_wpAutop' );
	await expect( screen ).toContainText( 'Running phpunit --filter Tests_Formatting_wpAutop…' );
	expect( ( await asked() ).runs ).toEqual( [ { dir: site.dir, args: [ '--filter', 'Tests_Formatting_wpAutop' ] } ] );

	// INVARIANT — its output and its end are the terminal's, as a script's are.
	await tell( 'npm:run-script:log', { runId: 'e2e-php-1', type: 'stdout', data: 'OK (25 tests, 34 assertions)\n' } );
	await expect( screen ).toContainText( 'OK (25 tests, 34 assertions)' );
	await tell( 'npm:run-script:done', { runId: 'e2e-php-1', code: 0 } );
	await expect( screen ).toContainText( 'phpunit --filter Tests_Formatting_wpAutop exited with code 0' );

	// INVARIANT — with a ticket linked, the card's button runs the tests
	// tagged with it, as the terminal command, in the terminal.
	await ui.linkTicket( page, '60001' );
	const runTests = page.getByRole( 'button', { name: 'Run this ticket\'s tests', exact: true } );
	await runTests.click();
	await expect( screen ).toContainText( 'Running phpunit --group 60001…' );
	expect( ( await asked() ).runs[ 1 ] ).toEqual( { dir: site.dir, args: [ '--group', '60001' ] } );

	// INVARIANT — while it runs, the button says why it cannot start another,
	// and Ctrl+C in the terminal stops this one.
	await expect( runTests ).toHaveAttribute( 'aria-disabled', 'true' );
	await terminal.press( 'Control+C' );
	await expect.poll( async () => ( await asked() ).kills.length ).toBe( 1 );
	await tell( 'npm:run-script:done', { runId: 'e2e-php-2', code: 130 } );
	await expect( screen ).toContainText( 'phpunit --group 60001 exited with code 130' );
	await expect( runTests ).not.toHaveAttribute( 'aria-disabled', 'true' );
} );

test( 'a Gutenberg site has no phpunit command and no ticket test button', async ( { session } ) => {
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { page } = await session.start( site.settings );
	await ui.openTray( page, 'Terminal' );
	const terminal = ui.terminalInput( page );
	const screen = page.locator( '.xterm-rows' );

	// INVARIANT — its PHP tests need wp-env, so the command is refused by name.
	await terminal.pressSequentially( 'phpunit --group 1', { delay: 10 } );
	await terminal.press( 'Enter' );
	await expect( screen ).toContainText( 'Unsupported command: phpunit --group 1' );
	await expect( page.getByRole( 'button', { name: 'Run this ticket\'s tests', exact: true } ) ).toHaveCount( 0 );
} );
