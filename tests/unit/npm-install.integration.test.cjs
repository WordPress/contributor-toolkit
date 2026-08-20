// Integration coverage for the engine-strict retry: runs the real install
// runner against a synthetic project that reproduces issue #37's EBADENGINE.
//
// The value of this file is platform-specific. The unit tests in
// npm-runner.test.cjs only check the strings buildChildEnv builds; these run
// real npm, so on Windows they prove that npm's config precedence (env var
// beating the project .npmrc) and npm's error wording are what the detector
// expects — neither of which can be verified by injecting a platform name.
//
// Not covered here: ensureNodeShimDir()'s node/npm shims. Those live in
// main.js, which requires electron and so cannot be imported by node --test.
// The fixture has no lifecycle scripts, so nothing here needs to resolve `node`
// off PATH.

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
} = require('../../src/npm-runner.js');

const FIXTURE = path.join(__dirname, 'fixtures', 'engine-strict');
const INSTALL_RUNNER = path.join(__dirname, '..', '..', 'src', 'install-runner.js');

// Keep npm quiet and offline: the fixture's only dependency is a local folder,
// so an audit or funding lookup would add network flakiness for nothing.
const QUIET_NPM = {
	npm_config_loglevel: 'warn',
	npm_config_audit: 'false',
	npm_config_fund: 'false',
	npm_config_progress: 'false'
};

function copyFixture() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engine-strict-'));
	fs.cpSync(FIXTURE, dir, { recursive: true });
	return dir;
}

// Runs the production install runner the same way main.js spawns it.
function runInstall(dir, { relaxEngines }) {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [INSTALL_RUNNER, dir], {
			cwd: dir,
			env: buildChildEnv({
				// Irrelevant for this fixture (no lifecycle scripts) — see header.
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

test('a real engine-strict install fails with output the detector recognises', { timeout: 120000 }, async (t) => {
	const dir = copyFixture();
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	const { code, output } = await runInstall(dir, { relaxEngines: false });

	assert.notEqual(code, 0, `expected a non-zero exit, got ${code}. Output:\n${output}`);
	// The whole retry hinges on recognising this output, so assert against what
	// npm really printed rather than a copy pasted into the unit tests.
	assert.equal(isEngineMismatch(output), true, `detector missed real npm output:\n${output}`);
	assert.equal(fs.existsSync(path.join(dir, 'node_modules')), false, 'nothing should have been installed');
});

test('the same install succeeds once engine checks are relaxed', { timeout: 120000 }, async (t) => {
	const dir = copyFixture();
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

	const { code, output } = await runInstall(dir, { relaxEngines: true });

	assert.equal(code, 0, `expected a clean exit, got ${code}. Output:\n${output}`);
	assert.equal(
		fs.existsSync(path.join(dir, 'node_modules', 'needs-future-node')),
		true,
		`the dependency should have been installed. Output:\n${output}`
	);
});
