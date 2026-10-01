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
 * to the app's log as well, and ends by itself; here a command runs until the
 * test says it has ended. A real command, started and stopped, is in
 * `pr-checkout.spec.js`.
 *
 * The screen is read from the terminal's own rows, which is the markup of the
 * library that draws it: nothing with a role holds what a terminal shows. It
 * holds the last dozen lines and no more, so each claim is about what was
 * just printed.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

test( 'the terminal runs the commands it knows one at a time, refuses the rest by name, and leaves a suggested command at the prompt for the contributor to run', async ( { session } ) => {
	const site = await makeSite( session );
	// A site that has been built, which is when the hints under the terminal
	// are shown.
	fs.mkdirSync( path.join( site.dir, 'build', 'wp-includes', 'js', 'dist' ), { recursive: true } );
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
	const terminalCard = ui.card( page, 'Terminal' );
	const buildHint = terminalCard.getByRole( 'button', { name: 'npm run build', exact: true } );

	// CHARACTERISATION — it opens on what it can do, with the scripts this
	// project allows named in the help.
	await expect( screen ).toContainText( 'WordPress npm helper terminal.', { timeout: 30_000 } );
	await expect( screen ).toContainText( 'Run one of: build, build:dev, dev, test, watch, grunt' );

	// INVARIANT — what it does not know it refuses by name, and it runs
	// nothing.
	await enter( 'ls -la' );
	await expect( screen ).toContainText( 'Unsupported command: ls -la' );
	await enter( 'npm run deploy' );
	await expect( screen ).toContainText( 'Unsupported script "deploy". Allowed scripts: build, build:dev, dev, test, watch, grunt' );
	expect( ( await asked() ).scripts ).toEqual( [] );

	// INVARIANT — a character taken back is not part of the command, and a
	// script the project allows is run in this site's directory.
	await type( 'npm run testx' );
	await terminal.press( 'Backspace' );
	await terminal.press( 'Enter' );
	await expect( screen ).toContainText( 'Running npm run test…' );
	await expect.poll( async () => ( await asked() ).scripts ).toEqual( [ { dir: site.dir, name: 'test', args: [] } ] );

	// INVARIANT — while it runs, what the script prints is shown, the hints
	// stop being links, and keys pressed go nowhere: no second command is
	// started. The script is not the build, which takes the hints away by
	// another route, so it is the terminal's own lock that does it here.
	await tell( 'npm:run-script:log', { runId: 'e2e-run-1', data: 'running 42 tests\n' } );
	await expect( screen ).toContainText( 'running 42 tests' );
	await expect( buildHint ).toHaveCount( 0 );
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
	await tell( 'npm:run-script:done', { runId: 'e2e-run-2', code: 0 } );
	await expect( screen ).toContainText( 'npm run build exited with code 0' );

	// INVARIANT — the up arrow brings the last command back to the prompt.
	await enter( 'help' );
	await terminal.press( 'ArrowUp' );
	await terminal.press( 'ArrowUp' );
	await terminal.press( 'Enter' );
	await expect.poll( async () => ( await asked() ).scripts ).toHaveLength( 3 );
	expect( ( await asked() ).scripts[ 2 ].name ).toBe( 'build' );
	await tell( 'npm:run-script:done', { runId: 'e2e-run-3', code: 0 } );
	await expect( buildHint ).toBeVisible();

	// INVARIANT — npm install runs the install, under either of its names,
	// and says how it ended.
	await enter( 'npm i' );
	await expect( screen ).toContainText( 'Running npm install…' );
	await expect.poll( async () => ( await asked() ).installs ).toEqual( [ site.dir ] );
	await tell( 'npm:install:log', { installId: 'e2e-install-1', data: 'added 1 package\n' } );
	await expect( screen ).toContainText( 'added 1 package' );
	await tell( 'npm:install:done', { installId: 'e2e-install-1', code: 0 } );
	await expect( screen ).toContainText( 'npm install exited with code 0' );
	expect( ( await asked() ).scripts ).toHaveLength( 3 );
} );
