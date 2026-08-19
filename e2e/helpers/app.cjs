'use strict';

// The engine the journey specs are built on: launch the app from source against a
// profile that is thrown away afterwards, drive it, and read back the state it
// actually persisted.
//
// Three things this exists to guarantee, none of which a spec should have to
// remember:
//
//   1. The app never touches the contributor's real site registry. Every launch
//      goes through TOOLKIT_USER_DATA_DIR — the `!app.isPackaged` hook in
//      src/main.js:137 — and `start()` refuses to launch without one.
//   2. Teardown always terminates. `close()` is known to hang on Windows in
//      Electron apps that keep child processes alive, which this one does.
//   3. A failure leaves evidence. The trace is Playwright's; the screenshot and
//      the persisted settings.json are attached here, because the interesting
//      half of a failure in this app is what ended up on disk.
//
// The packaged smoke test does not use this: it launches a different binary and
// deliberately writes no state at all.

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test: base, _electron: electron } = require( '@playwright/test' );

const REPO_ROOT = path.join( __dirname, '..', '..' );

// DPR 1 and a fixed locale and timezone: selectors read the text the app renders,
// and some of that text is dates. Without these, a retina laptop and a CI runner
// disagree about what is on screen.
const ELECTRON_SWITCHES = [ '--force-device-scale-factor=1', '--lang=en-GB' ];

/**
 * Whether two paths name the same directory.
 *
 * Not `path.resolve(a) === path.resolve(b)`, which is wrong on both platforms this
 * app ships to and would fail the launch guard for a reason that has nothing to do
 * with what it is guarding:
 *
 *   - macOS hands back `/var/folders/...` from `os.tmpdir()` and `/private/var/...`
 *     from the app, because the first is a symlink to the second.
 *   - Windows hands back a short `RUNNER~1`-style path in some environments and the
 *     long one in others, and its filesystem is case-insensitive besides.
 *
 * `realpath` settles the first two; lowercasing settles the third, and only off
 * POSIX, where two names differing in case really are two directories.
 *
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function samePath( a, b ) {
	const real = ( p ) => {
		try {
			return fs.realpathSync.native( p );
		} catch {
			return path.resolve( p );
		}
	};
	const normalise = ( p ) => ( process.platform === 'linux' ? real( p ) : real( p ).toLowerCase() );
	return normalise( a ) === normalise( b );
}

const EMPTY_SETTINGS = Object.freeze( { sites: [], siteMeta: {}, preferences: {} } );

/**
 * Where to record each journey, so a person can watch what the test did:
 * `E2E_VIDEO=/tmp/e2e-video npm run test:e2e`. Unset, nothing is recorded and
 * the launch is exactly what it would otherwise be.
 */
const VIDEO_DIR = process.env.E2E_VIDEO || '';

/**
 * A session of the app under test: one throwaway profile, one app at a time.
 *
 * Split into `new Session()` and `start()` on purpose. A spec usually has to build
 * its Git fixture *before* the app opens — the site list in settings.json has to
 * name directories that already exist — and it needs to know the profile path to
 * write that settings.json. So the directory exists from construction; the app
 * starts when the spec says so.
 */
class Session {
	constructor() {
		this.userDataDir = fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-profile-' ) );
		this.app = null;
		this.page = null;
		this.scratch = [];
		this.videos = [];
	}

	/**
	 * Registers a directory to delete once the app has stopped.
	 *
	 * Deleting it any earlier is a Windows problem waiting to happen: a test's
	 * fake site is open in a process that is still running, and Windows refuses
	 * to remove a directory something holds a handle on — so the cleanup fails
	 * with EPERM rather than the test failing on its own merits. Teardown here
	 * runs after `close()`.
	 *
	 * @param {string} dir
	 * @return {string} The same path, so this can wrap a mkdtemp call.
	 */
	track( dir ) {
		this.scratch.push( dir );
		return dir;
	}

	/**
	 * Seeds settings.json and launches the app.
	 *
	 * @param {Object} settings Initial electron-store contents. Defaults to a
	 *                          first-launch app with no sites.
	 * @return {Promise<{app: Object, page: Object}>} The Electron app and its first window.
	 */
	async start( settings = EMPTY_SETTINGS ) {
		if ( this.app ) throw new Error( 'This session already has an app running; call restart() instead.' );
		this.writeSettings( settings );
		return this.#launch();
	}

	/**
	 * Closes the app and opens it again against the same profile, untouched.
	 *
	 * This is the only way to prove the app *persisted* something rather than
	 * merely holding it in memory, which is what a change to the storage layer
	 * can break without any test noticing.
	 *
	 * @return {Promise<{app: Object, page: Object}>} The relaunched app and its first window.
	 */
	async restart() {
		await this.close();
		return this.#launch();
	}

	async #launch() {
		this.app = await electron.launch( {
			// From plain Node, require('electron') resolves to the binary's path —
			// the same trick scripts/run-tests-electron.cjs and the screenshot
			// harness use.
			executablePath: require( 'electron' ),
			args: [ ...ELECTRON_SWITCHES, REPO_ROOT ],
			// Watching a run is only ever a question of recording it. `_electron.launch`
			// takes `recordVideo` but not `slowMo`, and Playwright drops launch options it
			// does not recognise without a word — so a `slowMo` added here would leave the
			// tests passing at full speed and look like it had worked.
			...( VIDEO_DIR ? { recordVideo: { dir: VIDEO_DIR } } : {} ),
			env: {
				...process.env,
				TZ: 'UTC',
				// Last, and not overridable by the ambient environment: a
				// TOOLKIT_USER_DATA_DIR exported in the shell must never be able to
				// point a test at a profile somebody cares about.
				TOOLKIT_USER_DATA_DIR: this.userDataDir,
			},
		} );
		this.page = await this.app.firstWindow();
		if ( VIDEO_DIR ) {
			const video = this.page.video();
			if ( video ) this.videos.push( video );
		}

		// Belt and braces over the env var above. If the redirect hook ever stops
		// firing — it is guarded by `!app.isPackaged` — every journey would start
		// editing the contributor's real site registry, silently and permanently.
		const inUse = await this.app.evaluate( ( { app } ) => app.getPath( 'userData' ) );
		if ( ! samePath( inUse, this.userDataDir ) ) {
			await this.close();
			throw new Error(
				`The app is using ${ inUse } as its profile, not the throwaway ${ this.userDataDir }. ` +
				'Refusing to run a test that would write to a real site registry.'
			);
		}

		return { app: this.app, page: this.page };
	}

	/**
	 * Replaces the persisted settings wholesale. Only meaningful before a launch.
	 *
	 * @param {Object} settings
	 */
	writeSettings( settings ) {
		fs.writeFileSync(
			path.join( this.userDataDir, 'settings.json' ),
			JSON.stringify( settings, null, '\t' )
		);
	}

	/**
	 * Reads back what the app persisted.
	 *
	 * electron-store writes on a debounce, so call this after the app has closed
	 * when the assertion is about persistence; mid-run it answers with whatever
	 * has been flushed so far.
	 *
	 * @return {Object} The parsed settings.json, or an empty object if there is none.
	 */
	readSettings() {
		const file = path.join( this.userDataDir, 'settings.json' );
		if ( ! fs.existsSync( file ) ) return {};
		return JSON.parse( fs.readFileSync( file, 'utf8' ) );
	}

	/**
	 * Makes the next "choose a file" dialog answer with these paths, without a human.
	 *
	 * Stubbed at invoke time in the main process rather than built into the app:
	 * main.js calls `dialog.showOpenDialog` when the handler runs, so replacing the
	 * method afterwards is enough and nothing test-shaped ships in the app.
	 *
	 * @param {string[]} filePaths
	 */
	async answerFileDialog( filePaths ) {
		await this.app.evaluate( ( { dialog }, paths ) => {
			dialog.showOpenDialog = async () => ( { canceled: false, filePaths: paths } );
			dialog.showOpenDialogSync = () => paths;
		}, filePaths );
	}

	/**
	 * Answers yes to every `window.confirm` the app raises, for the life of this
	 * window. Returns the number of prompts answered so far, so a test can assert
	 * that a destructive action did ask before doing anything.
	 *
	 * Replaces `window.confirm` in the page rather than handling Playwright's
	 * `dialog` event. Electron implements the JavaScript dialogs natively and
	 * blocks the renderer on them, so the `dialog` event a browser would emit
	 * does not arrive — a test relying on it clicks "Delete this ticket's work",
	 * watches nothing happen, and fails on an assertion that had nothing to do
	 * with the bug. (Confirmed the hard way; the listener is kept alongside for
	 * anything that does surface as a real dialog.)
	 *
	 * @return {Promise<() => Promise<number>>} Reads back how many confirmations
	 *                                          have been answered.
	 */
	async acceptConfirms() {
		this.page.on( 'dialog', ( dialog ) => dialog.accept() );
		await this.page.evaluate( () => {
			window.__e2eConfirmCount = 0;
			window.confirm = () => {
				window.__e2eConfirmCount += 1;
				return true;
			};
		} );
		return () => this.page.evaluate( () => window.__e2eConfirmCount );
	}

	async close() {
		if ( ! this.app ) return;
		const app = this.app;
		this.app = null;
		this.page = null;

		// Grab the handle before closing — `process()` throws once the connection
		// to the app is gone.
		const proc = app.process();
		await Promise.race( [
			app.close().catch( () => {} ),
			new Promise( ( resolve ) => setTimeout( resolve, 5_000 ) ),
		] );
		if ( proc && proc.exitCode === null ) proc.kill();
	}

	/**
	 * Saves each recording under a name that says which test it came from, and
	 * clears away everything else the recorder left behind.
	 *
	 * Playwright names a recording after the page that produced it — an opaque
	 * hash — and writes one for every window the run opened, most of which are
	 * empty or a fraction of a second long. A directory of twenty files called
	 * `page@24b3324…webm`, three of which are worth opening, is not something to
	 * hand a contributor and call a feature.
	 *
	 * Call after `close()`: the recording is only finished once the app is gone.
	 *
	 * @param {string} name Slug for the test, used as the file name.
	 * @return {Promise<string[]>} The paths written.
	 */
	async saveVideos( name ) {
		if ( ! VIDEO_DIR || ! this.videos.length ) return [];

		const written = [];
		for ( const [ i, video ] of this.videos.entries() ) {
			// One per launch: a journey that closes and reopens the app to prove
			// something persisted has two, and both are worth keeping.
			const suffix = this.videos.length > 1 ? `-${ i + 1 }` : '';
			const file = path.join( VIDEO_DIR, `${ name }${ suffix }.webm` );
			try {
				await video.saveAs( file );
				written.push( file );
			} catch {
				// A window that closed before a single frame was captured has
				// nothing to save. Not worth failing a passing test over.
			}
		}
		this.videos = [];

		// Whatever the recorder wrote under its own names is now duplicated under
		// the names above, or was empty to begin with.
		for ( const left of fs.readdirSync( VIDEO_DIR ) ) {
			if ( left.startsWith( 'page@' ) && left.endsWith( '.webm' ) ) {
				fs.rmSync( path.join( VIDEO_DIR, left ), { force: true } );
			}
		}
		return written;
	}

	dispose() {
		for ( const dir of this.scratch.splice( 0 ) ) {
			fs.rmSync( dir, { recursive: true, force: true } );
		}
		fs.rmSync( this.userDataDir, { recursive: true, force: true } );
	}
}

/**
 * `test` with a `session` fixture. Import this instead of @playwright/test in a journey.
 */
const test = base.extend( {
	session: async ( {}, use, testInfo ) => {
		const session = new Session();
		await use( session );

		if ( testInfo.status !== testInfo.expectedStatus && session.page ) {
			// Attached before the app closes, because closing it is also how a
			// hung app gets killed — and then there is nothing left to photograph.
			await testInfo.attach( 'screen', {
				body: await session.page.screenshot().catch( () => Buffer.alloc( 0 ) ),
				contentType: 'image/png',
			} );
			await testInfo.attach( 'settings.json', {
				body: JSON.stringify( session.readSettings(), null, '\t' ),
				contentType: 'application/json',
			} );
		}

		await session.close();
		await session.saveVideos( testInfo.title.replace( /[^a-z0-9]+/gi, '-' ).toLowerCase() );
		session.dispose();
	},
} );

const { expect } = base;

module.exports = { test, expect, Session, EMPTY_SETTINGS, REPO_ROOT };
