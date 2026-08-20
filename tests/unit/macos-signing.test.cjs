const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SETUP_SCRIPT = path.join(__dirname, '..', '..', '.buildkite', 'commands', 'setup_macos_code_signing.sh');
const DUMMY_KEY = '-----BEGIN PRIVATE KEY-----\na dummy key with spaces and $shell syntax\n-----END PRIVATE KEY-----';

// The real Buildkite command sources this script, so exercise it in the same shape. Fastlane is
// stubbed because this test is only responsible for where the notarization key is materialized,
// its permissions, and whether the sourced shell cleans it up.
const SOURCE_HARNESS = String.raw`
set -eu
install_gems() { :; }
bundle() { :; }
source "$SETUP_SCRIPT"

case "$APPLE_API_KEY" in
	"$PROJECT_ROOT"/*)
		echo "notarization key was written inside the project: $APPLE_API_KEY" >&2
		exit 1
		;;
esac

test -f "$APPLE_API_KEY"
test "$(cat "$APPLE_API_KEY")" = "$APP_STORE_CONNECT_API_KEY_KEY"
test "$(stat -f '%Lp' "$APPLE_API_KEY")" = "600"
printf '%s\n' "$APPLE_API_KEY"
`;

test('macOS signing keeps its temporary notarization key outside the project and removes it on exit', { skip: process.platform !== 'darwin' }, (t) => {
	const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-signing-project-'));
	t.after(() => fs.rmSync(projectRoot, { recursive: true, force: true }));

	const result = spawnSync('/bin/bash', ['-c', SOURCE_HARNESS], {
		cwd: projectRoot,
		encoding: 'utf8',
		env: {
			...process.env,
			APP_STORE_CONNECT_API_KEY_KEY: DUMMY_KEY,
			APP_STORE_CONNECT_API_KEY_KEY_ID: 'dummy-key-id',
			APP_STORE_CONNECT_API_KEY_ISSUER_ID: 'dummy-issuer-id',
			PROJECT_ROOT: projectRoot,
			SETUP_SCRIPT,
		},
	});

	assert.equal(result.status, 0, `signing setup failed:\n${result.stdout}${result.stderr}`);
	const keyPath = result.stdout.trim().split('\n').at(-1);
	assert.ok(path.isAbsolute(keyPath), `expected an absolute key path, received ${keyPath}`);
	assert.equal(fs.existsSync(keyPath), false, 'the key file survived the Buildkite shell');
	assert.equal(fs.existsSync(path.dirname(keyPath)), false, 'the key temporary directory survived the Buildkite shell');
});
