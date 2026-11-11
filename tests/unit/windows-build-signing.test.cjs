const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BUILD_SCRIPT = path.join(__dirname, '..', '..', '.buildkite', 'commands', 'build_windows.ps1');
const PWSH = spawnSync('pwsh', ['-NoProfile', '-Command', 'exit 0']).status === 0 ? 'pwsh' : undefined;

// Runs the real Buildkite script in a scratch project whose signing setup, dependency install,
// build and signtool are stubs that record each call to `calls.log`.
function runBuild(t, { branch, sign, npmExitCode = 0 }) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-windows-build-'));
	t.after(() => fs.rmSync(root, { recursive: true, force: true }));

	const log = path.join(root, 'calls.log');
	const bin = path.join(root, 'bin');
	const commands = path.join(root, '.buildkite', 'commands');
	fs.mkdirSync(bin);
	fs.mkdirSync(commands, { recursive: true });

	// PowerShell on Windows only resolves commands with a PATHEXT extension, so stubs there are batch files.
	const isWindows = process.platform === 'win32';
	const stub = (name, call, exitCode = 0, extra = '') => {
		const file = path.join(bin, isWindows ? `${name}.cmd` : name);
		const body = isWindows
			? `@echo ${call}>>"${log}"\r\n${extra && `@${extra.windows}\r\n`}@exit /b ${exitCode}\r\n`
			: `#!/bin/sh\necho "${call}" >> '${log}'\n${extra && `${extra.posix}\n`}exit ${exitCode}\n`;
		fs.writeFileSync(file, body);
		fs.chmodSync(file, 0o755);
		return file;
	};
	fs.writeFileSync(path.join(commands, 'setup_windows_code_signing.ps1'), `Add-Content -Path '${log}' -Value 'setup'\n`);
	stub('bash', 'install');
	stub('npm', 'build', npmExitCode, { posix: 'mkdir -p dist && touch dist/app.exe', windows: 'mkdir dist 2>nul & type nul > dist\\app.exe' });
	const signtool = stub('signtool', 'verify');

	const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, BUILDKITE_BRANCH: branch, SIGNTOOL_PATH: signtool };
	delete env.SIGN_WINDOWS_BUILD;
	if (sign !== undefined) env.SIGN_WINDOWS_BUILD = sign;

	const result = spawnSync(PWSH, ['-NoProfile', '-File', BUILD_SCRIPT], { cwd: root, env, encoding: 'utf8' });
	const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split(/\s+/) : [];
	return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

for (const branch of ['trunk', 'release/1.2.0']) {
	test(`an unsigned ${branch} build fails before building`, { skip: !PWSH && 'needs pwsh' }, (t) => {
		const { status, output, calls } = runBuild(t, { branch });

		assert.equal(status, 1, output);
		assert.deepEqual(calls, []);
	});

	test(`a signed ${branch} build sets up signing and verifies the installer`, { skip: !PWSH && 'needs pwsh' }, (t) => {
		const { status, output, calls } = runBuild(t, { branch, sign: '1' });

		assert.equal(status, 0, output);
		assert.deepEqual(calls, ['setup', 'install', 'build', 'verify']);
	});
}

test('a feature branch builds unsigned without touching signing', { skip: !PWSH && 'needs pwsh' }, (t) => {
	const { status, output, calls } = runBuild(t, { branch: 'fix/123-something' });

	assert.equal(status, 0, output);
	assert.deepEqual(calls, ['install', 'build']);
});

test('a feature branch signs when SIGN_WINDOWS_BUILD is requested', { skip: !PWSH && 'needs pwsh' }, (t) => {
	const { status, output, calls } = runBuild(t, { branch: 'fix/123-something', sign: 'true' });

	assert.equal(status, 0, output);
	assert.deepEqual(calls, ['setup', 'install', 'build', 'verify']);
});

test('a failing Windows build fails the step', { skip: !PWSH && 'needs pwsh' }, (t) => {
	const { status, output, calls } = runBuild(t, { branch: 'fix/123-something', npmExitCode: 3 });

	assert.equal(status, 3, output);
	assert.deepEqual(calls, ['install', 'build']);
});
