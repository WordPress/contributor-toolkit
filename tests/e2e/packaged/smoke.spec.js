/**
 * Smoke test for the packaged app.
 *
 * Runs against an unsigned `electron-builder --dir` build, not the source tree.
 * The failures it exists to catch — asar layout, native module rebuilds, bundled
 * CLI resolution — do not reproduce under `npm start`.
 *
 * Build it first (see TESTING.md):
 *   npm run build:once && CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
 *
 * It writes no state, so it deliberately does not use the session helper the
 * journeys are built on: there is no profile to seed and nothing to read back.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect, _electron: electron } = require( '@playwright/test' );

const REPO_ROOT = path.join( __dirname, '..', '..', '..' );
const DIST = path.join( REPO_ROOT, 'dist' );

/**
 * Every key exposed through `contextBridge` in src/preload.js.
 *
 * This repo has no typecheck, so nothing else catches an `ipcMain.handle` added
 * in src/main.js and never bridged to the renderer. Adding an API means adding it
 * here too — that is the point, the list is meant to be edited deliberately.
 *
 * Do not try to derive it by reading src/preload.js. Two of these keys
 * (`signInToGithub`, `cancelGithubSignIn`) are spread in from an immediately
 * invoked function that closes over a listener, so they exist only once the file
 * has run. Anything that greps for the object's literal keys silently misses
 * them — which is the same class of gap this assertion exists to close, one
 * level up.
 */
const EXPECTED_API_KEYS = [
	'addSite',
	'applyPatch',
	'cancelGithubSignIn',
	'chooseDirectory',
	'choosePatchFile',
	'clearEmails',
	'clearWpDebug',
	'createPatchWindow',
	'deleteBranch',
	'deleteSite',
	'discardChanges',
	'discardToBase',
	'fetchPrDiff',
	'fetchTracAttachment',
	'getEmails',
	'getGithubAccount',
	'getPatch',
	'getProvenance',
	'getSiteStatus',
	'getSites',
	'getSitesWithMeta',
	'hasUnsubmittedWork',
	'isWorktreeDirty',
	'listBranches',
	'listEditors',
	'listTicketPatches',
	'listTracAttachments',
	'markSiteInitialized',
	'markUpdateComplete',
	'npmKill',
	'onNewEmail',
	'onSmtpStarted',
	'openExternal',
	'openInEditor',
	'openPullRequest',
	'platform',
	'playgroundWebAvailable',
	'previewPatch',
	'revealWpDebug',
	'runNpmInstall',
	'runNpmScript',
	'savePatch',
	'setContributionEvent',
	'setSiteLabel',
	'setSiteTicket',
	'setSkipInitWizard',
	'setWporgHandle',
	'setupWordPress',
	'showSiteInFileManager',
	'signInToGithub',
	'signOutOfGithub',
	'startPlaygroundWeb',
	'startServer',
	'startSmtp',
	'startWpDebug',
	'stopPlaygroundWeb',
	'stopServer',
	'stopSmtp',
	'stopWpDebug',
	'subscribeCarriedWork',
	'subscribePullRequestProgress',
	'subscribeSetupProgress',
	'subscribeSetupStatus',
	'subscribeSwitchProgress',
	'switchBranch',
	'updateTrunk',
];

/**
 * Modules the app resolves at runtime that only exist if packaging worked.
 *
 * `fs-ext-extra-prebuilt` is the interesting one. It is a native module that the
 * bundled PHP runtime requires for file locking, it ships prebuilt binaries, and
 * it is listed in `allowScripts` because it still runs an install script to pick
 * one. A binary that is missing or built against the wrong ABI surfaces here and
 * nowhere else: `npm ci` exits 0 and packaging succeeds regardless.
 *
 * Asserted on both platforms, deliberately. An earlier draft of this test
 * excluded Windows on the grounds that the Playground CLI guarded the import
 * with a `win32` check — that guard is gone, the dependency is no longer
 * optional, and the runtime now carries a Windows-specific file-lock path that
 * requires it. Excluding Windows today would skip the one failure this
 * assertion exists to catch, on the platform where it is most likely.
 */
const REQUIRED_MODULES = [ '@wp-playground/cli', 'fs-ext-extra-prebuilt' ];

/**
 * electron-builder names the output directory after the platform *and* arch, so
 * the path differs between a CI runner and a contributor's laptop:
 * macos-latest is arm64 (`dist/mac-arm64`), an Intel Mac is `dist/mac`.
 */
function findPackagedBinary() {
	if ( ! fs.existsSync( DIST ) ) {
		throw new Error( `No ${ DIST } directory. Run \`npm run pack:dir\` first — see TESTING.md.` );
	}

	if ( process.platform === 'darwin' ) {
		const macDirs = fs.readdirSync( DIST ).filter( ( d ) => d === 'mac' || d.startsWith( 'mac-' ) );
		for ( const dir of macDirs ) {
			const appDir = path.join( DIST, dir );
			const app = fs.readdirSync( appDir ).find( ( d ) => d.endsWith( '.app' ) );
			if ( ! app ) continue;
			const macOsDir = path.join( appDir, app, 'Contents', 'MacOS' );
			const [ binary ] = fs.readdirSync( macOsDir );
			if ( binary ) return path.join( macOsDir, binary );
		}
		throw new Error( `No packaged .app under ${ DIST }. Looked in: ${ macDirs.join( ', ' ) || '(nothing)' }` );
	}

	if ( process.platform === 'win32' ) {
		const unpacked = path.join( DIST, 'win-unpacked' );
		if ( ! fs.existsSync( unpacked ) ) {
			throw new Error( `No ${ unpacked }. Run \`npm run pack:dir\` first — see TESTING.md.` );
		}
		const exe = fs.readdirSync( unpacked ).find( ( f ) => f.endsWith( '.exe' ) );
		if ( ! exe ) throw new Error( `No .exe in ${ unpacked }.` );
		return path.join( unpacked, exe );
	}

	throw new Error( `This smoke test only covers macOS and Windows, not ${ process.platform }.` );
}

let electronApp;
let firstWindow;

test.beforeAll( async () => {
	electronApp = await electron.launch( { executablePath: findPackagedBinary() } );
	firstWindow = await electronApp.firstWindow();
} );

test.afterAll( async () => {
	if ( ! electronApp ) return;

	// Grab the handle before closing — `process()` throws once the connection to
	// the app is gone.
	const proc = electronApp.process();

	// `close()` is known to hang on Windows when the app keeps child processes
	// alive, which this one does. Never let teardown wedge the run.
	await Promise.race( [
		electronApp.close().catch( () => {} ),
		new Promise( ( resolve ) => setTimeout( resolve, 5_000 ) ),
	] );

	if ( proc && proc.exitCode === null ) proc.kill();
} );

test( 'the packaged app boots and paints its first window', async () => {
	// Deliberately not asserting "no uncaught renderer errors": index.html installs
	// its own error handlers, and a `pageerror` listener attaches too late to be
	// reliable. A painted window covers the same failure class positively.
	await expect( firstWindow ).toHaveTitle( 'WordPress Contributor Toolkit' );

	// #root is in the static HTML, so its presence proves nothing — its children do.
	await expect( firstWindow.locator( '#root > *' ) ).not.toHaveCount( 0 );
	// `exact` matters: "WordPress Core" is also a substring of button labels and
	// step descriptions further down the page.
	await expect( firstWindow.getByText( 'WordPress Core', { exact: true } ) ).toBeVisible();
} );

test( 'the preload bridge exposes every expected key', async () => {
	const exposed = await firstWindow.evaluate( () =>
		( window.api ? Object.keys( window.api ) : [] ).sort()
	);

	expect( exposed ).toEqual( EXPECTED_API_KEYS );
} );

test( 'the packaged app excludes build-only signing material', async () => {
	const signingFiles = await electronApp.evaluate( ( { app } ) => {
		const nodeRequire = process.mainModule.require;
		const appFs = nodeRequire( 'node:fs' );
		const appPath = nodeRequire( 'node:path' );
		const signingDirectory = appPath.join( app.getAppPath(), '.codesigning' );

		return appFs.existsSync( signingDirectory ) ? appFs.readdirSync( signingDirectory ) : [];
	} );

	expect( signingFiles ).toEqual( [] );
} );

test( 'the packaged payload has no .codesigning directory outside app.asar', () => {
	// The sibling test above reads through Electron's asar-aware fs, so it sees
	// inside app.asar — and only there. This walk runs on plain Node fs, which is
	// not asar-aware, so it checks the rest of the payload for the same directory:
	// the unpacked asar directory, extra resources or files, and framework helpers.
	const binary = findPackagedBinary();
	const packagedRoot = process.platform === 'darwin'
		? path.join( binary, '..', '..', '..' ) // Contents/MacOS/<binary> -> the .app bundle
		: path.dirname( binary ); // win-unpacked/<exe> -> win-unpacked

	const offenders = [];
	const walk = ( dir ) => {
		for ( const entry of fs.readdirSync( dir, { withFileTypes: true } ) ) {
			if ( entry.name === '.codesigning' ) {
				offenders.push( path.join( dir, entry.name ) );
			} else if ( entry.isDirectory() ) {
				walk( path.join( dir, entry.name ) );
			}
		}
	};
	walk( packagedRoot );

	expect( offenders ).toEqual( [] );
} );

for ( const moduleName of REQUIRED_MODULES ) {
	test( `the packaged app can resolve ${ moduleName }`, async () => {
		const resolved = await electronApp.evaluate( ( { app }, name ) => {
			// The `require` in scope here carries no `.resolve` — only a per-module
			// require wrapper does. Build one anchored at the app's own package.json,
			// inside app.asar, so resolution happens exactly where src/main.js would
			// do it.
			//
			// Anchored there rather than at `process.mainModule.filename`, which is
			// what an earlier draft used: Electron does not keep that pointed at the
			// entry script, and partway through a run it reads back as the bare
			// string 'electron'. The test then fails on the *first* module it checks
			// and passes when run alone — a packaging test going red for a reason
			// that has nothing to do with packaging, which is the worst kind.
			const nodeRequire = process.mainModule ? process.mainModule.require : require;
			const { createRequire } = nodeRequire( 'module' );
			const { join } = nodeRequire( 'path' );
			const req = createRequire( join( app.getAppPath(), 'package.json' ) );
			try {
				return { ok: true, path: req.resolve( name ), appPath: app.getAppPath() };
			} catch ( error ) {
				return { ok: false, error: String( error && error.message ), appPath: app.getAppPath() };
			}
		}, moduleName );

		expect( resolved, `${ moduleName } failed to resolve from ${ resolved.appPath }: ${ resolved.error }` )
			.toHaveProperty( 'ok', true );
		expect( resolved.path ).toBeTruthy();
	} );
}
