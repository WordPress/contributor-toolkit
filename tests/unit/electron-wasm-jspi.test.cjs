// Guards the PHP builds the packaged app leaves out.
//
// Every @php-wasm/node-* package carries each PHP version twice: a jspi/ build and an asyncify/
// one, about 30 MB each. The package picks one at runtime with `"Suspending" in WebAssembly` and
// only reaches into asyncify/ when that is false, so build.files in package.json drops every
// asyncify/ folder from the app. That is only safe while the Electron the app ships has JSPI; on
// one without it, the dev server fails to start on a missing asyncify/php_X_Y.js module.
//
// Nothing that runs on a pull request starts the real Playground server, so an Electron bump that
// lost JSPI would pass every other check. This test is what fails instead. If it does, either put
// the asyncify/ folders back in the build or keep Electron where it was.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { electronBinaryPath } = require('../../scripts/run-tests-electron.cjs');

// Asks the Electron binary itself, as the Playground server child runs on it, so both the
// system-Node and the Electron pass of the suite read the runtime that will actually ship.
function bundledWasmHasJspi() {
	const result = spawnSync(electronBinaryPath(), ['-p', '"Suspending" in WebAssembly'], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		encoding: 'utf8',
		shell: false,
		windowsHide: true,
	});
	assert.equal(
		result.status,
		0,
		`could not ask Electron's bundled Node about JSPI (status ${result.status}): ${result.stderr}`
	);
	return result.stdout.trim();
}

test("Electron's bundled Node has JSPI, so PHP never needs the asyncify builds the app leaves out", () => {
	assert.equal(
		bundledWasmHasJspi(),
		'true',
		'Electron no longer exposes WebAssembly.Suspending, so @php-wasm/node will load the asyncify '
			+ 'PHP builds, which build.files in package.json leaves out of the app.'
	);
});
