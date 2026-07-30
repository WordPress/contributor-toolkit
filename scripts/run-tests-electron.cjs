// Runs the unit suite on Electron's bundled Node instead of the system Node.
//
// This is not a duplicate of `npm test`. The suite spawns `process.execPath` (see
// test/npm-install.integration.test.cjs), so on the system Node it exercises whatever version
// is in .nvmrc — not the version the app actually ships. The two are set independently and
// have drifted before (#37/#46), so CI runs the suite once per runtime.
//
// ELECTRON_RUN_AS_NODE makes the Electron binary behave as a plain Node process: no window and
// no display required. buildChildEnv (src/npm-runner.js) sets the same variable, so any npm
// the tests spawn stays on the Electron runtime too.

const path = require('node:path');
const { spawn } = require('node:child_process');

const REPO_ROOT = path.join(__dirname, '..');

// The `electron` package's entry point resolves to the absolute path of its binary —
// Electron.app/Contents/MacOS/Electron on macOS, electron.exe on Windows.
function electronBinaryPath() {
  return require('electron');
}

// `--test` takes no path on purpose. Since Node 22 a positional argument is a glob matching test
// *files*, so `test/` matches nothing and Node then tries to load it as the entry module —
// Electron 43 (Node 24) fails with MODULE_NOT_FOUND where Electron 32 (Node 20) was fine. Bare
// `--test` discovers from the cwd on every version, and is exactly what `npm test` runs, so both
// passes always cover the same files.
function runSuite() {
  const child = spawn(electronBinaryPath(), ['--test'], {
    cwd: REPO_ROOT,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    shell: false,
    windowsHide: true,
  });

  child.on('error', (err) => {
    console.error(`[test:electron] could not start Electron: ${err.message}`);
    process.exit(1);
  });

  // A run that was killed, or that exited without a code, must never read as a pass.
  child.on('close', (code, signal) => {
    if (signal) {
      console.error(`[test:electron] test run terminated by signal ${signal}`);
      process.exit(1);
    }
    process.exit(code === null ? 1 : code);
  });
}

if (require.main === module) {
  runSuite();
}

module.exports = { electronBinaryPath };
