/**
 * Smoke test for the packaged app.
 *
 * Runs against an unsigned `electron-builder --dir` build, not the source tree.
 * The failures it exists to catch — asar layout, native module rebuilds, bundled
 * CLI resolution — do not reproduce under `npm start`.
 *
 * Build it first (see docs/testing.md):
 *   npm run build:once && CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
 */

const fs = require('fs');
const path = require('path');
const { test, expect, _electron: electron } = require('@playwright/test');

const REPO_ROOT = path.join(__dirname, '..');
const DIST = path.join(REPO_ROOT, 'dist');

/**
 * Every key exposed through `contextBridge` in src/preload.js.
 *
 * This repo has no typecheck, so nothing else catches an `ipcMain.handle` added
 * in src/main.js and never bridged to the renderer. Adding an API means adding it
 * here too — that is the point, the list is meant to be edited deliberately.
 */
const EXPECTED_API_KEYS = [
	'addSite',
	'chooseDirectory',
	'clearEmails',
	'createPatchWindow',
	'deleteSite',
	'forgetSite',
	'getEmails',
	'getPatch',
	'getSiteStatus',
	'getSites',
	'getSitesWithMeta',
	'markSiteInitialized',
	'npmKill',
	'onNewEmail',
	'onSmtpStarted',
	'openExternal',
	'playgroundWebAvailable',
	'runNpmInstall',
	'runNpmScript',
	'savePatch',
	'setSiteLabel',
	'setSkipInitWizard',
	'setupWordPress',
	'startPlaygroundWeb',
	'startServer',
	'startSmtp',
	'startWpDebug',
	'stopPlaygroundWeb',
	'stopServer',
	'stopSmtp',
	'stopWpDebug',
	'subscribeSetupProgress',
	'subscribeSetupStatus',
];

/**
 * Modules the app resolves at runtime that only exist if packaging worked.
 *
 * `fs-ext` is the interesting one: it is an *optional* native dependency of
 * @php-wasm/node, so a failed rebuild against Electron's ABI produces an artifact
 * with broken file locking and no error anywhere in the install or build logs.
 */
const REQUIRED_MODULES = ['@wp-playground/cli', 'fs-ext'];

/**
 * electron-builder names the output directory after the platform *and* arch, so
 * the path differs between a CI runner and a contributor's laptop:
 * macos-latest is arm64 (`dist/mac-arm64`), an Intel Mac is `dist/mac`.
 */
function findPackagedBinary() {
	if (!fs.existsSync(DIST)) {
		throw new Error(`No ${DIST} directory. Run \`npm run pack:dir\` first — see docs/testing.md.`);
	}

	if (process.platform === 'darwin') {
		const macDirs = fs.readdirSync(DIST).filter((d) => d === 'mac' || d.startsWith('mac-'));
		for (const dir of macDirs) {
			const appDir = path.join(DIST, dir);
			const app = fs.readdirSync(appDir).find((d) => d.endsWith('.app'));
			if (!app) continue;
			const macOsDir = path.join(appDir, app, 'Contents', 'MacOS');
			const [binary] = fs.readdirSync(macOsDir);
			if (binary) return path.join(macOsDir, binary);
		}
		throw new Error(`No packaged .app under ${DIST}. Looked in: ${macDirs.join(', ') || '(nothing)'}`);
	}

	if (process.platform === 'win32') {
		const unpacked = path.join(DIST, 'win-unpacked');
		if (!fs.existsSync(unpacked)) {
			throw new Error(`No ${unpacked}. Run \`npm run pack:dir\` first — see docs/testing.md.`);
		}
		const exe = fs.readdirSync(unpacked).find((f) => f.endsWith('.exe'));
		if (!exe) throw new Error(`No .exe in ${unpacked}.`);
		return path.join(unpacked, exe);
	}

	throw new Error(`This smoke test only covers macOS and Windows, not ${process.platform}.`);
}

let electronApp;
let firstWindow;

test.beforeAll(async () => {
	electronApp = await electron.launch({ executablePath: findPackagedBinary() });
	firstWindow = await electronApp.firstWindow();
});

test.afterAll(async () => {
	if (!electronApp) return;

	// Grab the handle before closing — `process()` throws once the connection to
	// the app is gone.
	const proc = electronApp.process();

	// `close()` is known to hang on Windows when the app keeps child processes
	// alive, which this one does. Never let teardown wedge the run.
	await Promise.race([
		electronApp.close().catch(() => {}),
		new Promise((resolve) => setTimeout(resolve, 5_000)),
	]);

	if (proc && proc.exitCode === null) {
		proc.kill();
	}
});

test('the packaged app boots and paints its first window', async () => {
	// Deliberately not asserting "no uncaught renderer errors": index.html installs
	// its own error handlers, and a `pageerror` listener attaches too late to be
	// reliable. A painted window covers the same failure class positively.
	await expect(firstWindow).toHaveTitle('WordPress Contributor Toolkit');

	// #root is in the static HTML, so its presence proves nothing — its children do.
	await expect(firstWindow.locator('#root > *')).not.toHaveCount(0);
	// `exact` matters: "WordPress Core" is also a substring of button labels and
	// step descriptions further down the page.
	await expect(firstWindow.getByText('WordPress Core', { exact: true })).toBeVisible();
});

test('the preload bridge exposes every expected key', async () => {
	const exposed = await firstWindow.evaluate(() =>
		(window.api ? Object.keys(window.api) : []).sort()
	);

	expect(exposed).toEqual(EXPECTED_API_KEYS);
});

for (const moduleName of REQUIRED_MODULES) {
	test(`the packaged app can resolve ${moduleName}`, async () => {
		// Known failure, tracked in #71: fs-ext compiles from source, the compile
		// fails on Windows, and npm drops the optional dependency without a word.
		// Every Windows artifact we ship today has no file locking.
		//
		// `test.fail` is not a skip — it fails the suite if this ever *passes*
		// unexpectedly, so the assertion turns itself back on the moment #71 is
		// fixed and nobody has to remember to come back here.
		test.fail(
			process.platform === 'win32' && moduleName === 'fs-ext',
			'fs-ext is missing from Windows packages — see #71'
		);

		const resolved = await electronApp.evaluate(({ app }, name) => {
			// Neither the `require` in scope here nor `process.mainModule.require`
			// carries a `.resolve` — only a per-module require wrapper does. Build
			// one anchored at the app's own entry point so resolution happens
			// exactly where src/main.js would do it, inside app.asar.
			const createRequire = process.mainModule.require('module').createRequire;
			const req = createRequire(process.mainModule.filename);
			try {
				return { ok: true, path: req.resolve(name), appPath: app.getAppPath() };
			} catch (error) {
				return { ok: false, error: String(error && error.message), appPath: app.getAppPath() };
			}
		}, moduleName);

		expect(resolved, `${moduleName} failed to resolve from ${resolved.appPath}: ${resolved.error}`)
			.toHaveProperty('ok', true);
		expect(resolved.path).toBeTruthy();
	});
}
