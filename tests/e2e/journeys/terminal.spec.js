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
	const patchFile = ui.prField( page );

	// CHARACTERISATION — it opens on what it can do, with the scripts this
	// project allows named in the help, and under it the hints are links.
	await expect( screen ).toContainText( 'WordPress npm helper terminal.', { timeout: 30_000 } );
	await expect( screen ).toContainText( 'Run one of: build, build:dev, dev, test, watch, grunt' );
	await expect( buildHint ).toBeVisible();
	await expect( patchFile ).toBeEnabled();

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
	// And the lock alone does not make the button that waits for a build
	// wait: this script is not one.
	await expect( patchFile ).toBeEnabled();
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
	await expect( patchFile ).toBeDisabled();
	await tell( 'npm:run-script:done', { runId: 'e2e-run-2', code: 0 } );
	await expect( screen ).toContainText( 'npm run build exited with code 0' );
	await expect( patchFile ).toBeEnabled();

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
	await expect( patchFile ).toBeDisabled();
	await tell( 'npm:install:log', { installId: 'e2e-install-1', type: 'stdout', data: 'added 1 package\n' } );
	await expect( screen ).toContainText( 'added 1 package' );
	await tell( 'npm:install:done', { installId: 'e2e-install-1', code: 0 } );
	await expect( screen ).toContainText( 'npm install exited with code 0' );
	await expect( patchFile ).toBeEnabled();

	// CHARACTERISATION — its short name runs it too. The third, a bare
	// `install`, is not typed here.
	await enter( 'npm i' );
	await expect.poll( async () => ( await asked() ).installs ).toEqual( [ site.dir, site.dir ] );
	await tell( 'npm:install:done', { installId: 'e2e-install-2', code: 1 } );
	await expect( screen ).toContainText( 'npm install exited with code 1' );
	await heard();
	expect( ( await asked() ).scripts ).toHaveLength( 3 );
} );

// The longest fixed line of the help the terminal prints as it starts: 74 of
// the terminal's 80 columns, so it ends inside the terminal only when a
// character takes one column.
const LONGEST_HELP_LINE = 'The setup checklist runs npm install and npm run build once. Run them here';

/**
 * How far the line's text runs past the end of the terminal row that holds
 * it, in pixels: nothing or less when it fits. Read from where the text is
 * laid out, not from what is painted: the row clips what runs past it, which
 * is how a line drawn too wide loses its second half. xterm draws each row as
 * a `div` as wide as its 80 columns, with the text in `span`s inside it.
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
