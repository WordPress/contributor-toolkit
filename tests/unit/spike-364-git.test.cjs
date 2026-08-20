/* eslint-disable -- Spike #364 scaffolding. Thrown away with the branch; not held to the repo's style. */
/**
 * SPIKE #364 — NOT A REAL TEST. Delete with the rest of the spike.
 *
 * It lives here only because `node --test` already runs on macOS and Windows
 * for every pull request, and the questions it asks — can the main process
 * drive a bundled Git, does that Git agree with a checkout isomorphic-git
 * made, does it write reflogs and take ref locks — have different answers on
 * Windows, where nobody on this spike has a machine.
 *
 * Offline. Nothing here reaches the network.
 */

const test = require( 'node:test' );
const assert = require( 'node:assert' );
const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { spawnSync } = require( 'node:child_process' );
const git = require( 'isomorphic-git' );

const { resolveGitRoot, gitBinary, gitEnv } = require( '../../scripts/spike-364/git-env.cjs' );
const ticketBranches = require( '../../src/ticket-branches.js' );

const ROOT = resolveGitRoot();
const BIN = gitBinary( ROOT );
const ENV = gitEnv( ROOT );
const AUTHOR = { name: 'Spike', email: 'spike@example.com' };

function run( args, cwd ) {
	const r = spawnSync( BIN, args, { cwd, env: ENV, shell: false, windowsHide: true, encoding: 'utf8' } );
	return { status: r.status, stdout: ( r.stdout || '' ).trim(), stderr: ( r.stderr || '' ).trim() };
}

function tmp( t, prefix ) {
	const dir = fs.mkdtempSync( path.join( os.tmpdir(), prefix ) );
	t.after( () => fs.rmSync( dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 } ) );
	return dir;
}

/**
 * A checkout shaped like one the app made, built only through isomorphic-git.
 */
async function appShapedRepo( t ) {
	const dir = tmp( t, 'spike364-iso-' );
	await git.init( { fs, dir, defaultBranch: 'trunk' } );
	fs.mkdirSync( path.join( dir, 'src' ), { recursive: true } );
	fs.writeFileSync( path.join( dir, 'src', 'wp-login.php' ), '<?php\n// login\n' );
	fs.writeFileSync( path.join( dir, '.gitignore' ), 'node_modules/\n' );
	await git.add( { fs, dir, filepath: [ 'src/wp-login.php', '.gitignore' ] } );
	await git.commit( { fs, dir, message: 'trunk', author: AUTHOR } );

	fs.mkdirSync( path.join( dir, 'node_modules', 'react' ), { recursive: true } );
	fs.writeFileSync( path.join( dir, 'node_modules', 'react', 'index.js' ), 'expensive\n' );

	const started = await ticketBranches.startTicketBranch( dir, '12345' );
	fs.writeFileSync( path.join( dir, 'src', 'wp-login.php' ), '<?php\n// login\n// ticket work\n' );
	await ticketBranches.parkCurrentWork( dir, { baseOid: started.baseOid } );

	// Two switches, so the working tree is one isomorphic-git *checked out*
	// rather than one a test wrote by hand. On Windows that is the difference
	// that matters: the app synthesises `core.autocrlf = true` on read and never
	// writes it, so what lands on disk is not what the config describes.
	await ticketBranches.switchToBranch( dir, 'trunk' );
	await ticketBranches.switchToBranch( dir, 'ticket/12345' );

	return dir;
}

test( 'spike364: the bundled binary runs', () => {
	const r = run( [ '--version' ], os.tmpdir() );
	assert.strictEqual( r.status, 0, `${ BIN }: ${ r.stderr }` );
	assert.match( r.stdout, /^git version/ );
	console.log( `  platform=${ process.platform } arch=${ process.arch } ${ r.stdout }` );
} );

test( 'spike364: GIT_EXEC_PATH has to be set explicitly', () => {
	const bare = spawnSync( BIN, [ '--exec-path' ], { encoding: 'utf8', shell: false } );
	const withEnv = run( [ '--exec-path' ], os.tmpdir() );
	console.log( `  without: ${ ( bare.stdout || '' ).trim() }\n  with:    ${ withEnv.stdout }` );
	assert.ok( withEnv.stdout.length > 0 );
} );

test( 'spike364: a path with a space in it works', ( t ) => {
	const dir = path.join( tmp( t, 'spike364 with space-' ), 'repo dir' );
	fs.mkdirSync( dir, { recursive: true } );
	const r = run( [ 'init', '-b', 'trunk' ], dir );
	assert.strictEqual( r.status, 0, r.stderr );
} );

test( 'spike364: real Git reads a checkout isomorphic-git made', async ( t ) => {
	const dir = await appShapedRepo( t );

	const status = run( [ 'status', '--porcelain' ], dir );
	assert.strictEqual( status.status, 0, status.stderr );

	const fsck = run( [ 'fsck', '--no-progress' ], dir );
	assert.strictEqual( fsck.status, 0, fsck.stderr );

	const branches = run( [ 'branch', '-a' ], dir );
	assert.match( branches.stdout, /12345/ );

	// The one that would bite on Windows: the app fakes `core.autocrlf` on read
	// and never writes it, so a real Git can see every file as modified.
	console.log( `  git status --porcelain: ${ status.stdout || '(clean)' }` );
	assert.strictEqual( status.stdout, '', 'real Git sees the tree as dirty' );
} );

test( 'spike364: reflogs are written, and #366 closes by construction', async ( t ) => {
	const dir = await appShapedRepo( t );

	const claim = run( [ 'config', '--get', 'core.logallrefupdates' ], dir );
	assert.strictEqual( claim.stdout, 'true', 'isomorphic-git no longer writes the claim' );

	const before = run( [ 'reflog', '--all' ], dir );
	assert.strictEqual( before.stdout, '', 'something was already logged' );

	const tip = run( [ 'rev-parse', 'ticket/12345' ], dir ).stdout;
	const updated = run( [ 'update-ref', 'refs/heads/trunk', tip ], dir );
	assert.strictEqual( updated.status, 0, updated.stderr );

	const after = run( [ 'reflog', '--all' ], dir );
	assert.notStrictEqual( after.stdout, '', 'no reflog entry was written' );
	assert.ok( fs.existsSync( path.join( dir, '.git', 'logs' ) ) );
} );

test( 'spike364: a held .lock blocks a second writer', async ( t ) => {
	const dir = await appShapedRepo( t );
	const tip = run( [ 'rev-parse', 'ticket/12345' ], dir ).stdout;

	const lock = path.join( dir, '.git', 'refs', 'heads', 'trunk.lock' );
	fs.mkdirSync( path.dirname( lock ), { recursive: true } );
	fs.writeFileSync( lock, '' );
	const blocked = run( [ 'update-ref', 'refs/heads/trunk', tip ], dir );
	fs.rmSync( lock, { force: true } );

	assert.notStrictEqual( blocked.status, 0, 'the lock was ignored' );
	assert.match( blocked.stderr, /cannot lock ref/ );
} );
