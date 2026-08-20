/* eslint-disable -- Spike #364 scaffolding. Thrown away with the branch; not held to the repo's style. */
/**
 * Spike #364 — the questions only the packaged app can answer: does the main
 * process find the binary once it is behind app.asar.unpacked, and does a real
 * shallow clone over HTTPS work from inside the bundle.
 *
 * Throwaway. Build first, then run:
 *   CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
 *   node scripts/spike-364/probe-packaged.cjs
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { _electron: electron } = require( 'playwright-core' );

const REPO_ROOT = path.join( __dirname, '..', '..' );
const DIST = path.join( REPO_ROOT, 'dist' );

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
 * Runs inside the packaged main process. Everything it needs has to be resolved
 * from the app's own package.json, exactly as src/main.js would.
 */
function probeInMain( { app }, cloneUrl ) {
	const nodeRequire = process.mainModule ? process.mainModule.require : require;
	const { createRequire } = nodeRequire( 'module' );
	const nodeFs = nodeRequire( 'fs' );
	const nodePath = nodeRequire( 'path' );
	const nodeOs = nodeRequire( 'os' );
	const { spawnSync } = nodeRequire( 'child_process' );

	const req = createRequire( nodePath.join( app.getAppPath(), 'package.json' ) );
	const out = { appPath: app.getAppPath(), steps: [] };

	let root;
	try {
		const fromDugite = nodePath.join( req.resolve( 'dugite' ), '..', '..', '..', 'git' );
		const unpacked = fromDugite.replace( `app.asar${ nodePath.sep }`, `app.asar.unpacked${ nodePath.sep }` );
		root = nodeFs.existsSync( nodePath.join( unpacked, 'bin' ) ) ? unpacked : fromDugite;
	} catch ( error ) {
		out.steps.push( { id: 'resolve', ok: false, detail: String( error.message ) } );
		return out;
	}
	out.steps.push( {
		id: 'resolve',
		ok: root.includes( 'app.asar.unpacked' ),
		detail: root,
	} );

	const bin = nodePath.join( root, 'bin', process.platform === 'win32' ? 'git.exe' : 'git' );
	const env = {
		...process.env,
		GIT_EXEC_PATH: nodePath.join( root, 'libexec', 'git-core' ),
		GIT_TEMPLATE_DIR: nodePath.join( root, 'share', 'git-core', 'templates' ),
		GIT_CONFIG_NOSYSTEM: '1',
		GIT_TERMINAL_PROMPT: '0',
	};
	const run = ( args, cwd ) => {
		const r = spawnSync( bin, args, { cwd, env, shell: false, windowsHide: true, encoding: 'utf8' } );
		return { status: r.status, stdout: ( r.stdout || '' ).trim(), stderr: ( r.stderr || '' ).trim() };
	};

	const version = run( [ '--version' ], nodeOs.tmpdir() );
	out.steps.push( {
		id: 'spawn',
		ok: version.status === 0,
		detail: version.stdout || version.stderr,
	} );

	// The clone the app actually performs, shape for shape: shallow, one branch.
	// The point is the certificates — nothing here tells Git where to find any.
	const target = nodeFs.mkdtempSync( nodePath.join( nodeOs.tmpdir(), 'spike364-clone-' ) );
	const started = Date.now();
	const cloned = run( [ 'clone', '--depth', '1', '--single-branch', '--branch', 'trunk', cloneUrl, target ], nodeOs.tmpdir() );
	const seconds = Math.round( ( Date.now() - started ) / 100 ) / 10;
	out.steps.push( {
		id: 'clone',
		ok: cloned.status === 0,
		detail: `${ seconds }s — ${ cloned.stderr || cloned.stdout || 'ok' }`,
	} );

	if ( cloned.status === 0 ) {
		const head = run( [ 'rev-parse', 'HEAD' ], target );
		const shallow = nodeFs.existsSync( nodePath.join( target, '.git', 'shallow' ) );
		out.steps.push( {
			id: 'clone.shape',
			ok: head.status === 0 && shallow,
			detail: `HEAD ${ head.stdout }, .git/shallow present: ${ shallow }`,
		} );

		const fetched = run( [ 'fetch', '--depth', '1', 'origin', 'trunk' ], target );
		out.steps.push( {
			id: 'fetch',
			ok: fetched.status === 0,
			detail: fetched.stderr || 'ok',
		} );
	}

	out.cloneDir = target;
	return out;
}

async function main() {
	const app = await electron.launch( { executablePath: findPackagedBinary() } );
	await app.firstWindow();
	const result = await app.evaluate( probeInMain, 'https://github.com/WordPress/wordpress-develop.git' );
	await app.close().catch( () => {} );
	console.log( `appPath: ${ result.appPath }\n` );
	for ( const step of result.steps ) {
		console.log( `${ step.ok ? 'PASS' : 'FAIL' }  ${ step.id }\n      ${ step.detail }\n` );
	}
	if ( result.cloneDir ) fs.rmSync( result.cloneDir, { recursive: true, force: true } );
	process.exit( result.steps.every( ( s ) => s.ok ) ? 0 : 1 );
}

main().catch( ( error ) => {
	console.error( error );
	process.exit( 1 );
} );
