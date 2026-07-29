// Integration coverage for issue #54: a build script that shells out to a
// second `npm install` (the way wordpress-develop's Gruntfile does through
// install-changed) hits EBADENGINE, because the script runner's environment has
// strict engine checks.
//
// This has to be an integration test. The thing under test is whether
// npm_config_engine_strict survives *two* levels of npm — the outer `npm run`
// re-exports its own resolved config into the script's environment before the
// grandchild install reads it. No unit test over buildChildEnv's output strings
// can show that; only real npm can.
//
// Companion to npm-install.integration.test.cjs, which covers the same env var
// one level down, on the plain install path.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const {
	isEngineMismatch,
	buildChildEnv,
	RELAXED_ENGINES_ENV
} = require('../src/npm-runner.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'nested-install');
const SCRIPT_RUNNER = path.join(__dirname, '..', 'src', 'script-runner.js');

// Keep npm quiet and offline: the fixture's only dependency is a local folder,
// so an audit or funding lookup would add network flakiness for nothing.
const QUIET_NPM = {
	npm_config_loglevel: 'warn',
	npm_config_audit: 'false',
	npm_config_fund: 'false',
	npm_config_progress: 'false'
};

function copyFixture() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nested-install-'));
	fs.cpSync(FIXTURE, dir, { recursive: true });
	// The build script ships as .js.txt because `node --test` runs every .js
	// under test/ and would otherwise execute the fixture as a test file.
	fs.renameSync(path.join(dir, 'run-build.js.txt'), path.join(dir, 'run-build.js'));
	return dir;
}

// Runs the production script runner the same way main.js spawns it.
function runScript(dir, { relaxEngines }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [SCRIPT_RUNNER, dir, 'build'], {
			cwd: dir,
			env: buildChildEnv({
				// The fixture's build script resolves `npm` off the real PATH, which
				// buildChildEnv preserves; the shim dir it prepends is only needed
				// inside Electron. See npm-install.integration.test.cjs's header.
				shimDir: path.join(dir, 'unused-shim'),
				extraEnv: { ...QUIET_NPM, ...(relaxEngines ? RELAXED_ENGINES_ENV : {}) }
			}),
			shell: false,
			windowsHide: true
		});
		let output = '';
		child.stdout.on('data', (d) => { output += d.toString(); });
		child.stderr.on('data', (d) => { output += d.toString(); });
		child.on('close', (code) => resolve({ code, output }));
	});
}

const installedDep = (dir) => fs.existsSync(path.join(dir, 'node_modules', 'needs-future-node'));

test('a nested install inside a script hits EBADENGINE when engines are strict', { timeout: 120000 }, async (t) => {
	const dir = copyFixture();
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	const { output } = await runScript(dir, { relaxEngines: false });

	// #54's symptom is noise, not failure: the Gruntfile swallows the error, so
	// the build still reaches its end. Assert on what the log shows instead.
	assert.match(output, /BUILD OK/, `the build should still have finished. Output:\n${output}`);
	assert.equal(isEngineMismatch(output), true, `expected a real EBADENGINE block:\n${output}`);
	assert.equal(installedDep(dir), false, 'the nested install should have installed nothing');
});

test('the nested install succeeds once the script runs with engines relaxed', { timeout: 120000 }, async (t) => {
	const dir = copyFixture();
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	const { code, output } = await runScript(dir, { relaxEngines: true });

	assert.equal(code, 0, `expected a clean exit, got ${code}. Output:\n${output}`);
	assert.match(output, /BUILD OK/, `the build should have finished. Output:\n${output}`);
	assert.equal(installedDep(dir), true, `the nested install should have succeeded. Output:\n${output}`);
	// The whole point: no stack trace from the swallowed execSync failure.
	assert.doesNotMatch(output, /Command failed: npm install/, `the nested install still failed:\n${output}`);
});
