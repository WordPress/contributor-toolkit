/**
 * Spike #364 — the local questions: can we drive the bundled Git, does it agree
 * with a repository isomorphic-git made, and does it give us reflogs and ref
 * locks for free.
 *
 * Throwaway. Run with:  node scripts/spike-364/probe-local.cjs
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { spawnSync } = require( 'node:child_process' );
const git = require( 'isomorphic-git' );

const { resolveGitRoot, gitBinary, gitEnv } = require( './git-env.cjs' );
const ticketBranches = require( '../../src/ticket-branches.js' );

const ROOT = resolveGitRoot();
const BIN = gitBinary( ROOT );
const ENV = gitEnv( ROOT );
const AUTHOR = { name: 'Spike', email: 'spike@example.com' };

const results = [];

function record( id, question, ok, detail ) {
	results.push( { id, question, ok, detail } );
	console.log( `${ ok ? 'PASS' : 'FAIL' }  ${ id }  ${ question }\n      ${ String( detail ).replace( /\n/g, '\n      ' ) }\n` );
}

function run( args, cwd, extraEnv = {} ) {
	const r = spawnSync( BIN, args, {
		cwd,
		env: { ...ENV, ...extraEnv },
		shell: false,
		windowsHide: true,
		encoding: 'utf8',
	} );
	return {
		status: r.status,
		stdout: ( r.stdout || '' ).trim(),
		stderr: ( r.stderr || '' ).trim(),
		error: r.error ? String( r.error.message ) : null,
	};
}

function tmp( prefix ) {
	return fs.mkdtempSync( path.join( os.tmpdir(), prefix ) );
}

/**
 * A checkout shaped like one the app made: branch `trunk`, a `src/` tree, a
 * gitignored substrate, and a ticket branch carrying parked work — the WIP
 * commit `src/ticket-branches.js` reparents onto the branch point. Built
 * entirely through isomorphic-git and the app's own module, never through the
 * binary under test.
 */
async function makeAppShapedRepo() {
	const dir = tmp( 'spike364-iso-' );
	await git.init( { fs, dir, defaultBranch: 'trunk' } );
	fs.mkdirSync( path.join( dir, 'src' ), { recursive: true } );
	fs.writeFileSync( path.join( dir, 'src', 'wp-login.php' ), '<?php\n// login\n' );
	fs.writeFileSync( path.join( dir, '.gitignore' ), 'node_modules/\n' );
	await git.add( { fs, dir, filepath: [ 'src/wp-login.php', '.gitignore' ] } );
	const base = await git.commit( { fs, dir, message: 'trunk', author: AUTHOR } );

	fs.mkdirSync( path.join( dir, 'node_modules', 'react' ), { recursive: true } );
	fs.writeFileSync( path.join( dir, 'node_modules', 'react', 'index.js' ), 'expensive\n' );

	const started = await ticketBranches.startTicketBranch( dir, '12345' );
	fs.writeFileSync( path.join( dir, 'src', 'wp-login.php' ), '<?php\n// login\n// ticket work\n' );
	await ticketBranches.parkCurrentWork( dir, { baseOid: started.baseOid } );

	return { dir, base };
}

async function main() {
	// ---------------------------------------------------------------- Q1: runtime
	const version = run( [ '--version' ], process.cwd() );
	record(
		'Q1.version',
		'the main process can spawn the bundled binary',
		version.status === 0 && /^git version/.test( version.stdout ),
		`${ BIN }\n${ version.stdout || version.stderr || version.error }`
	);

	const bare = spawnSync( BIN, [ '--exec-path' ], { encoding: 'utf8', shell: false } );
	const withEnv = run( [ '--exec-path' ], process.cwd() );
	record(
		'Q1.execpath',
		'GIT_EXEC_PATH has to be set explicitly',
		withEnv.stdout.endsWith( path.join( 'libexec', 'git-core' ) ),
		`without it: ${ ( bare.stdout || '' ).trim() }\nwith it:    ${ withEnv.stdout }`
	);

	const spaced = path.join( tmp( 'spike364 with space-' ), 'repo dir' );
	fs.mkdirSync( spaced, { recursive: true } );
	const inSpaced = run( [ 'init', '-b', 'trunk' ], spaced );
	record(
		'Q1.spaces',
		'a path with a space in it works, no shell involved',
		inSpaced.status === 0,
		`${ spaced }\n${ inSpaced.stdout || inSpaced.stderr }`
	);

	const noSystem = run( [ 'config', '--show-origin', '--get-all', 'include.path' ], spaced );
	record(
		'Q1.isolation',
		'the host\'s system config is not read (GIT_CONFIG_NOSYSTEM)',
		noSystem.status !== 0 || ! noSystem.stdout.includes( '/etc/gitconfig' ),
		noSystem.stdout || '(nothing — no system config reached)'
	);

	// ------------------------------------- Q2: over a repository isomorphic-git made
	const { dir, base } = await makeAppShapedRepo();

	const status = run( [ 'status', '--porcelain=v2', '--branch' ], dir );
	record(
		'Q2.status',
		'real Git reads the app\'s checkout without complaint',
		status.status === 0,
		status.stdout || status.stderr
	);

	const log = run( [ 'log', '--oneline', '--all' ], dir );
	const branches = run( [ 'branch', '-a' ], dir );
	record(
		'Q2.history',
		'the parked WIP commit and the ticket branch are visible to Git',
		log.status === 0 && branches.stdout.includes( '12345' ),
		`${ branches.stdout }\n--\n${ log.stdout }`
	);

	const fsck = run( [ 'fsck', '--no-progress' ], dir );
	record(
		'Q2.fsck',
		'the repository passes git fsck',
		fsck.status === 0,
		fsck.stdout || fsck.stderr || '(clean)'
	);

	// The interesting half: does Git see the same dirtiness the app does?
	const isoStatus = await git.statusMatrix( { fs, dir } );
	const isoDirty = isoStatus.filter( ( [ , h, w, s ] ) => ! ( h === 1 && w === 1 && s === 1 ) );
	const gitDirty = run( [ 'status', '--porcelain' ], dir ).stdout;
	record(
		'Q2.agreement',
		'Git and isomorphic-git agree on what is dirty',
		( gitDirty === '' ) === ( isoDirty.length === 0 ),
		`isomorphic-git: ${ isoDirty.length } entries\ngit: ${ gitDirty || '(clean)' }`
	);

	// ------------------------------------------------ Q5: reflog and ref locking
	const configured = run( [ 'config', '--get', 'core.logallrefupdates' ], dir );
	record(
		'Q5.config',
		'the claim isomorphic-git writes into every repository (#366)',
		configured.stdout === 'true',
		`core.logallrefupdates = ${ configured.stdout || '(unset)' }`
	);

	const before = run( [ 'reflog', '--all' ], dir );
	// To a *different* oid on purpose: a same-value update writes nothing, which
	// is how a first pass at this misread the result as "no reflog".
	const tip = run( [ 'rev-parse', 'ticket/12345' ], dir ).stdout;
	run( [ 'update-ref', 'refs/heads/trunk', tip ], dir );
	const after = run( [ 'reflog', '--all' ], dir );
	record(
		'Q5.reflog',
		'a ref update writes a reflog entry (#366 closes by construction)',
		after.stdout.length > 0 && before.stdout.length === 0,
		`before: ${ before.stdout || '(empty — nothing isomorphic-git did was logged)' }\nafter:  ${ after.stdout || '(still empty)' }`
	);

	const logsDir = path.join( dir, '.git', 'logs' );
	record(
		'Q5.reflog.files',
		'.git/logs exists on disk, where a mentor would look',
		fs.existsSync( logsDir ),
		fs.existsSync( logsDir ) ? fs.readdirSync( logsDir ).join( ', ' ) : '(no .git/logs)'
	);

	// A held lock must make a concurrent ref update fail loudly rather than
	// silently win — the property #355 needs and the in-process mutex cannot give.
	const lock = path.join( dir, '.git', 'refs', 'heads', 'trunk.lock' );
	fs.mkdirSync( path.dirname( lock ), { recursive: true } );
	fs.writeFileSync( lock, '' );
	const blocked = run( [ 'update-ref', 'refs/heads/trunk', base ], dir );
	fs.rmSync( lock, { force: true } );
	record(
		'Q5.locking',
		'a held .lock file blocks a second writer',
		blocked.status !== 0,
		blocked.stderr || blocked.stdout || '(no error — the lock was ignored)'
	);

	// ---------------------------------------------------------------- summary
	const failed = results.filter( ( r ) => ! r.ok );
	console.log( `\n${ results.length - failed.length }/${ results.length } passed` );
	if ( failed.length ) {
		console.log( `failed: ${ failed.map( ( r ) => r.id ).join( ', ' ) }` );
	}
	fs.writeFileSync(
		path.join( os.tmpdir(), 'spike364-local.json' ),
		JSON.stringify( { platform: process.platform, arch: process.arch, root: ROOT, results }, null, 2 )
	);
}

main().catch( ( error ) => {
	console.error( error );
	process.exit( 1 );
} );
