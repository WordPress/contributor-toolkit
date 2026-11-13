/**
 * The `toolkit` command (#764): a tool outside the window asking the app that
 * is open what sites it has.
 *
 * The unit suite proves each half: the socket and its refusals, the command's
 * arguments and output, the list main.js answers with. What it cannot see is
 * the whole of it on a real machine: that the app, started the way it starts,
 * listens where the command it wrote looks; that the command runs on
 * Electron's own Node, with no Node of the host's, from a process the app did
 * not start; and that the pipe on Windows and the socket file elsewhere both
 * carry it. So the command is run here the way a terminal runs it, as the file
 * in the profile directory, and only its output is read.
 *
 * What this leaves out: a server that is running, since a journey starts none
 * (dev-server.spec.js says why), so `server` is only ever read as stopped; and
 * a packaged app, where the command names a CLI inside `app.asar` and a signed
 * Helper binary.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { spawnSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

// Runs the command the app wrote, as a shell would. A `.cmd` cannot be
// spawned directly, so on Windows it goes through cmd.exe, which is also what
// a terminal there does with it.
const WINDOWS = process.platform === 'win32';
const shimOf = ( session ) => path.join( session.userDataDir, 'bin', WINDOWS ? 'toolkit.cmd' : 'toolkit' );

function toolkit( session, ...args ) {
	const shim = shimOf( session );
	const result = WINDOWS
		? spawnSync( 'cmd.exe', [ '/d', '/s', '/c', `""${ shim }" ${ args.join( ' ' ) }"` ], { encoding: 'utf8', windowsVerbatimArguments: true, windowsHide: true } )
		: spawnSync( shim, args, { encoding: 'utf8' } );
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

test( 'the toolkit command lists the open app\'s sites, and says so when the app is closed', async ( { session } ) => {
	const site = await makeSite( session, { label: 'listed-site' } );
	const { page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'listed-site' ) ).toBeVisible( { timeout: 30_000 } );

	// CHARACTERISATION — the command is a file in the profile directory,
	// written once the app is listening, which the window does not wait for.
	await expect.poll( () => fs.existsSync( shimOf( session ) ), { timeout: 15_000 } ).toBe( true );

	// INVARIANT — asked for JSON, the command prints the site the app has,
	// where it is and what is checked out there, and nothing else on stdout.
	const listing = toolkit( session, 'sites', '--json' );
	expect( listing.stderr ).toBe( '' );
	expect( listing.status ).toBe( 0 );
	expect( JSON.parse( listing.stdout ) ).toEqual( {
		ok: true,
		sites: [ {
			path: site.dir,
			label: 'listed-site',
			project: 'core',
			workItem: null,
			branch: 'trunk',
			pullRequest: null,
			initialized: true,
			server: { running: false, url: null },
		} ],
	} );

	// INVARIANT — without the flag the same answer is sentences a person reads.
	const text = toolkit( session, 'sites' );
	expect( text.status ).toBe( 0 );
	expect( text.stdout ).toContain( 'listed-site (WordPress Core)' );
	expect( text.stdout ).toContain( `Path:    ${ site.dir }` );
	expect( text.stdout ).toContain( 'Work:    none (branch trunk)' );
	expect( text.stdout ).toContain( 'Server:  stopped' );

	// INVARIANT — asking changed nothing: the site is still the one on screen.
	await expect( ui.siteHeading( page, 'listed-site' ) ).toBeVisible();

	// INVARIANT — with the app closed the command fails, and says why in words
	// a tool can pass on, with a code it can branch on.
	await session.close();
	const closed = toolkit( session, 'sites', '--json' );
	expect( closed.status ).toBe( 1 );
	expect( JSON.parse( closed.stdout ) ).toMatchObject( { ok: false, code: 'not-running' } );
} );
