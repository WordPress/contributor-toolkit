const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const SETUP_SCRIPT = path.join(__dirname, '..', '..', '.buildkite', 'commands', 'setup_macos_code_signing.sh');
const DUMMY_KEY = '-----BEGIN PRIVATE KEY-----\na dummy key with spaces and $shell syntax\n-----END PRIVATE KEY-----';

// The real Buildkite command sources this script, so exercise it in the same shape. Fastlane is
// stubbed because these tests are responsible only for materializing and cleaning up the key.
const SOURCE_HARNESS = String.raw`
set -eu
install_gems() { :; }
bundle() { :; }
source "$SETUP_SCRIPT"

# Compare real paths: the regression this guards against exported a *relative* in-project path,
# and macOS temp directories reach here both as /var/... and its /private/var/... target.
key_dir="$(cd "$(dirname "$APPLE_API_KEY")" && pwd -P)"
project_dir="$(cd "$PROJECT_ROOT" && pwd -P)"
case "$key_dir" in
	"$project_dir"|"$project_dir"/*)
		echo "notarization key was written inside the project: $APPLE_API_KEY" >&2
		exit 1
		;;
esac

# Independent of what APPLE_API_KEY claims: no signing material may exist in the project itself.
test ! -e "$PROJECT_ROOT/.codesigning"

test -f "$APPLE_API_KEY"
test "$(cat "$APPLE_API_KEY")" = "$APP_STORE_CONNECT_API_KEY_KEY"
test "$(stat -f '%Lp' "$APPLE_API_KEY")" = "600"
printf '%s\n' "$APPLE_API_KEY"
`;

const FAILED_MKTEMP_HARNESS = String.raw`
install_gems() { :; }
bundle() { :; }
mktemp() {
	printf '%s\n' "$MKTEMP_FALLBACK"
	return 1
}
source "$SETUP_SCRIPT"
status=$?
exit "$status"
`;

const FAILED_KEY_WRITE_HARNESS = String.raw`
install_gems() { :; }
bundle() { :; }
printenv() { return 1; }
source "$SETUP_SCRIPT"
status=$?
exit "$status"
`;

const TERM_HARNESS = String.raw`
set -e
install_gems() { :; }
bundle() { :; }
source "$SETUP_SCRIPT"
printf 'READY:%s\n' "$APPLE_API_KEY"
read -r _
echo "signing shell survived TERM" >&2
exit 1
`;

function signingEnv(overrides = {}) {
	return {
		...process.env,
		APP_STORE_CONNECT_API_KEY_KEY: DUMMY_KEY,
		APP_STORE_CONNECT_API_KEY_KEY_ID: 'dummy-key-id',
		APP_STORE_CONNECT_API_KEY_ISSUER_ID: 'dummy-issuer-id',
		SETUP_SCRIPT,
		...overrides,
	};
}

test('macOS signing keeps its temporary notarization key outside the project and removes it on exit', { skip: process.platform !== 'darwin' }, (t) => {
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-signing-project-'));
	t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

	const result = spawnSync('/bin/bash', ['-c', SOURCE_HARNESS], {
		cwd: projectRoot,
		encoding: 'utf8',
		env: signingEnv({
			PROJECT_ROOT: projectRoot,
		}),
	});

	assert.equal(result.status, 0, `signing setup failed:\n${result.stdout}${result.stderr}`);
	const keyPath = result.stdout.trim().split('\n').at(-1);
	assert.ok(path.isAbsolute(keyPath), `expected an absolute key path, received ${keyPath}`);
	assert.equal(fs.existsSync(keyPath), false, 'the key file survived the Buildkite shell');
	assert.equal(fs.existsSync(path.dirname(keyPath)), false, 'the key temporary directory survived the Buildkite shell');
});

test('sourced macOS signing returns failure when its temporary directory cannot be created', { skip: process.platform !== 'darwin' }, (t) => {
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-signing-mktemp-'));
	const fallbackDirectory = path.join(projectRoot, 'mktemp-fallback');
	fs.mkdirSync(fallbackDirectory);
	t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

	const result = spawnSync('/bin/bash', ['-c', FAILED_MKTEMP_HARNESS], {
		cwd: projectRoot,
		encoding: 'utf8',
		env: signingEnv({ MKTEMP_FALLBACK: fallbackDirectory }),
	});

	assert.equal(result.status, 1, `signing setup did not return the mktemp failure:\n${result.stdout}${result.stderr}`);
	assert.equal(fs.existsSync(fallbackDirectory), true, 'signing claimed and removed a directory that mktemp did not create');
	assert.equal(fs.existsSync(path.join(fallbackDirectory, 'apple_api_key')), false, 'signing continued after mktemp failed');
});

test('sourced macOS signing returns failure and cleans up when writing the key fails', { skip: process.platform !== 'darwin' }, (t) => {
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-signing-key-write-project-'));
	const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-signing-key-write-temp-'));
	t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));
	t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));

	const result = spawnSync('/bin/bash', ['-c', FAILED_KEY_WRITE_HARNESS], {
		cwd: projectRoot,
		encoding: 'utf8',
		env: signingEnv({ TMPDIR: temporaryRoot }),
	});

	assert.equal(result.status, 1, `signing setup did not return the key-write failure:\n${result.stdout}${result.stderr}`);
	assert.deepEqual(fs.readdirSync(temporaryRoot), [], 'temporary signing material survived the failed shell');
});

test('macOS signing removes its temporary key when Buildkite terminates the shell', { skip: process.platform !== 'darwin' }, async (t) => {
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-signing-term-'));
	const child = spawn('/bin/bash', ['-c', TERM_HARNESS], {
		cwd: projectRoot,
		env: signingEnv(),
		stdio: ['pipe', 'pipe', 'pipe'],
	});
	t.after(() => {
		if (child.exitCode === null && child.signalCode === null) {
			child.kill('SIGKILL');
		}
		fs.rmSync(projectRoot, { recursive: true, force: true });
	});

	let stdout = '';
	let stderr = '';
	let keyPath;
	let keyExistedBeforeTermination = false;
	let terminationSent = false;
	child.stdout.on('data', (chunk) => {
		stdout += chunk;
		const match = stdout.match(/READY:(.+)/);
		if (!terminationSent && match) {
			terminationSent = true;
			keyPath = match[1].trim();
			keyExistedBeforeTermination = fs.existsSync(keyPath);
			child.kill('SIGTERM');
		}
	});
	child.stderr.on('data', (chunk) => {
		stderr += chunk;
	});

	const outcome = await new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill('SIGKILL');
			reject(new Error(`signing shell did not terminate after SIGTERM:\n${stdout}${stderr}`));
		}, 5_000);
		child.once('error', (error) => {
			clearTimeout(timeout);
			reject(error);
		});
		child.once('close', (code, signal) => {
			clearTimeout(timeout);
			resolve({ code, signal });
		});
	});

	assert.equal(terminationSent, true, `signing shell never materialized the key:\n${stdout}${stderr}`);
	assert.equal(keyExistedBeforeTermination, true, `temporary key did not exist before SIGTERM: ${keyPath}`);
	assert.deepEqual(outcome, { code: null, signal: 'SIGTERM' }, `signing shell did not preserve the TERM result:\n${stdout}${stderr}`);
	assert.equal(fs.existsSync(keyPath), false, 'the key file survived SIGTERM');
	assert.equal(fs.existsSync(path.dirname(keyPath)), false, 'the key temporary directory survived SIGTERM');
});
