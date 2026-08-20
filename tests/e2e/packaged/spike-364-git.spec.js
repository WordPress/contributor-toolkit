/* eslint-disable -- Spike #364 scaffolding. Thrown away with the branch; not held to the repo's style. */
/**
 * SPIKE #364 — NOT A REAL TEST. Delete with the rest of the spike.
 *
 * It rides in the packaged smoke project because that is the only harness that
 * launches the built artifact on macOS and Windows, and the questions here only
 * have answers there: whether the main process finds the bundled Git once it is
 * behind `app.asar.unpacked`, and whether a shallow clone over HTTPS works from
 * inside the bundle with nothing telling Git where the certificates are.
 *
 * Unlike everything else in this directory it touches the network, on purpose.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect, _electron: electron } = require( '@playwright/test' );

const REPO_ROOT = path.join( __dirname, '..', '..', '..' );
const DIST = path.join( REPO_ROOT, 'dist' );
const CLONE_URL = 'https://github.com/WordPress/wordpress-develop.git';

function findPackagedBinary() {
	if ( process.platform === 'darwin' ) {
		const dir = fs.readdirSync( DIST ).find( ( d ) => d === 'mac' || d.startsWith( 'mac-' ) );
		const appDir = path.join( DIST, dir );
		const app = fs.readdirSync( appDir ).find( ( d ) => d.endsWith( '.app' ) );
		const macOsDir = path.join( appDir, app, 'Contents', 'MacOS' );
		return path.join( macOsDir, fs.readdirSync( macOsDir )[ 0 ] );
	}
	const unpacked = path.join( DIST, 'win-unpacked' );
	return path.join( unpacked, fs.readdirSync( unpacked ).find( ( f ) => f.endsWith( '.exe' ) ) );
}

/**
 * Runs inside the packaged main process, resolving as src/main.js would.
 */
function probeInMain( { app }, cloneUrl ) {
	const nodeRequire = process.mainModule ? process.mainModule.require : require;
	const { createRequire } = nodeRequire( 'module' );
	const nodeFs = nodeRequire( 'fs' );
	const nodePath = nodeRequire( 'path' );
	const nodeOs = nodeRequire( 'os' );
	const { spawnSync } = nodeRequire( 'child_process' );

	const req = createRequire( nodePath.join( app.getAppPath(), 'package.json' ) );
	const steps = [];

	// dugite resolves its own layout, including the app.asar -> app.asar.unpacked
	// rewrite and the Windows `cmd/git.exe` + `mingw64` exec path. Joining those
	// by hand is what a first pass did, and it failed on Windows for that reason
	// alone rather than for anything to do with packaging.
	const dugite = req( 'dugite' );
	const { env, gitLocation } = dugite.setupEnvironment( {
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_TERMINAL_PROMPT: '0',
	} );

	steps.push( {
		id: 'resolve',
		ok: gitLocation.includes( 'app.asar.unpacked' ) && nodeFs.existsSync( gitLocation ),
		detail: `${ gitLocation } (exists: ${ nodeFs.existsSync( gitLocation ) })`,
	} );

	const run = ( args, cwd ) => {
		const r = spawnSync( gitLocation, args, { cwd, env, shell: false, windowsHide: true, encoding: 'utf8' } );
		return {
			status: r.status,
			stdout: ( r.stdout || '' ).trim(),
			stderr: ( r.stderr || '' ).trim(),
			error: r.error ? String( r.error.message ) : null,
		};
	};

	const version = run( [ '--version' ], nodeOs.tmpdir() );
	steps.push( {
		id: 'spawn',
		ok: version.status === 0,
		detail: version.stdout || version.stderr || version.error || '(no output)',
	} );

	// Every helper Git shells out to has to be present and, on Windows, findable
	// through the PATH dugite prepends. A trimmed tree that dropped something
	// load-bearing shows here rather than in the middle of a contributor's clone.
	const helpers = run( [ '--exec-path' ], nodeOs.tmpdir() );
	steps.push( {
		id: 'exec-path',
		ok: helpers.status === 0 && nodeFs.existsSync( helpers.stdout ),
		detail: `${ helpers.stdout } (${ nodeFs.existsSync( helpers.stdout ) ? nodeFs.readdirSync( helpers.stdout ).length + ' entries' : 'missing' })`,
	} );

	if ( version.status !== 0 ) return { appPath: app.getAppPath(), steps };

	// The clone the app performs, shape for shape. Nothing here points Git at a
	// certificate bundle — if it needs one, this is where that shows.
	const target = nodeFs.mkdtempSync( nodePath.join( nodeOs.tmpdir(), 'spike364-clone-' ) );
	const started = Date.now();
	const cloned = run( [ 'clone', '--depth', '1', '--single-branch', '--branch', 'trunk', cloneUrl, target ], nodeOs.tmpdir() );
	const seconds = Math.round( ( Date.now() - started ) / 100 ) / 10;
	steps.push( {
		id: 'clone',
		ok: cloned.status === 0,
		detail: `${ seconds }s — ${ ( cloned.stderr || cloned.stdout || cloned.error || 'ok' ).split( '\n' ).pop() }`,
	} );

	if ( cloned.status === 0 ) {
		steps.push( {
			id: 'clone.shape',
			ok: nodeFs.existsSync( nodePath.join( target, '.git', 'shallow' ) ),
			detail: `HEAD ${ run( [ 'rev-parse', 'HEAD' ], target ).stdout }`,
		} );
		const fetched = run( [ 'fetch', '--depth', '1', 'origin', 'trunk' ], target );
		steps.push( { id: 'fetch', ok: fetched.status === 0, detail: fetched.stderr || 'ok' } );
	}

	// Deleting what Git wrote is its own question on Windows: Git marks loose
	// objects read-only, and `rm -rf` with `force` does not clear that attribute.
	// The app deletes site folders today (`sites:delete`), against repositories
	// isomorphic-git made — which do not have the attribute set. So this is a
	// finding, not teardown noise, and it must not mask the steps above.
	let removal = 'ok';
	try {
		nodeFs.rmSync( target, { recursive: true, force: true } );
	} catch ( error ) {
		removal = String( error && error.message );
	}
	steps.push( { id: 'remove', ok: removal === 'ok', detail: removal } );

	return { appPath: app.getAppPath(), steps };
}

test( 'spike364: the packaged app drives the bundled Git, network and all', async () => {
	test.setTimeout( 300_000 );

	const app = await electron.launch( { executablePath: findPackagedBinary() } );
	let result;
	try {
		await app.firstWindow();
		result = await app.evaluate( probeInMain, CLONE_URL );
	} finally {
		const proc = app.process();
		await Promise.race( [
			app.close().catch( () => {} ),
			new Promise( ( resolve ) => setTimeout( resolve, 5_000 ) ),
		] );
		if ( proc && proc.exitCode === null ) proc.kill();
	}

	for ( const step of result.steps ) {
		console.log( `  ${ step.ok ? 'PASS' : 'FAIL' }  ${ step.id }: ${ step.detail }` );
	}

	expect( result.steps.filter( ( s ) => ! s.ok ), JSON.stringify( result.steps, null, 2 ) ).toEqual( [] );
} );
