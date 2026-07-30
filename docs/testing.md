# Testing

## Unit tests

```bash
npm test                              # on the system Node
npm run test:electron                 # on Electron's bundled Node
node --test test/azure-sign.test.cjs  # a single file
```

Both passes matter: the suite spawns `process.execPath`, so they exercise two independently
versioned Node runtimes. `.github/workflows/unit-tests.yml` runs both on macOS and Windows.

## Packaged-app smoke test (e2e)

One Playwright test that launches the **packaged** app and checks three things:

1. **It boots** — the first window appears and the renderer paints.
2. **The preload bridge is whole** — every key exposed through `contextBridge` matches a
   checked-in list. This repo has no typecheck, so nothing else catches an
   `ipcMain.handle` added in `src/main.js` and never exposed in `src/preload.js`.
3. **The bundled runtime modules resolve** from inside the packaged app —
   `@wp-playground/cli` and `fs-ext`. `fs-ext` is a native *optional* dependency, so a
   failed rebuild ships an artifact with broken file locking and no error anywhere in the
   install or build logs. This assertion is the only thing that catches it.

None of these reproduce under `npm start` — they are packaging failures, so the test needs
a real package.

### Running it locally

```bash
npm ci                                        # postinstall rebuilds native deps for Electron
npm run build:once                            # bundle the renderer
CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
npm run test:e2e
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` is **mandatory on macOS** — electron-builder signs
during `--dir` otherwise. On Windows it is harmless; signing there already no-ops when the
Azure Trusted Signing env vars are unset.

Re-run `pack:dir` after any change to `src/` — the test reads `dist/`, not the source tree.

Useful while iterating:

```bash
npx playwright test -g "preload bridge"   # one test
npx playwright show-trace test-results/<dir>/trace.zip
```

### When it fails

- **"No dist directory"** — you skipped `npm run pack:dir`.
- **A missing preload key** — you added an IPC handler without exposing it. Add it to
  `src/preload.js` *and* to `EXPECTED_API_KEYS` in `e2e/packaged-smoke.spec.js`. The list is
  meant to be edited deliberately; that is what makes the omission visible in review.
- **`fs-ext` fails to resolve** — the native rebuild did not happen. Check that `npm ci` ran
  its `postinstall` (`electron-builder install-app-deps`).

### In CI

`.github/workflows/e2e.yml` runs exactly the commands above on `macos-latest` and
`windows-latest`, for non-draft pull requests and pushes to `trunk`. It needs no secrets and
packages nothing signed. Playwright reports are uploaded as artifacts on failure.

Signed release artifacts are still produced by Buildkite (`.buildkite/pipeline.yml`), which
this workflow does not touch.
