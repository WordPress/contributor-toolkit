# Testing

Everything about tests in this repository: what to run, what the suite is made of, and where a new
test belongs. [CONTRIBUTING.md](CONTRIBUTING.md) points here rather than repeating any of it.

## What to run

```
npm test                    # the fast suite — 1,027 tests, under three seconds
npm run test:e2e            # the app, driven — 8 tests, seconds
npm run lint                # ESLint over the whole repo
```

`npm test` is the one to run without thinking about it. It touches no network: the single suite
that needs a Git remote starts a loopback server and serves the repository to itself.

Two more, for when you need them:

```
npm run test:electron       # the fast suite again, on the Node that Electron bundles
npm run test:e2e:packaged   # the built artifact — needs a build first, see below
```

To run one file: `node --test test/azure-sign.test.cjs`. To run one journey:
`npx playwright test --project=journeys -g "switching back"`, and add `--headed` to watch it happen.

## The five layers

"Add a test" is not a single instruction here. There are five places a test can go, and putting one
in the wrong place is how a suite gets slow without getting better.

They are listed cheapest first, and that ordering is the rule: **write a test at the highest layer
that can still see the failure.** What each layer is blind to is the part worth reading — it is what
sends a test one layer up, or down.

**1. Unit** — 63 files in `test/`. Starts nothing; calls plain functions. Pure logic: parsing a
ticket reference, deriving a status, building a command line. Blind to anything touching disk, a
process or a window.

**2. Integration** — 6 files, 89 tests, named `*.integration.test.cjs`. Runs the real modules
against real Git repositories in a temporary directory. Proves Git does what the code assumes when
it switches a branch, applies a patch or updates trunk. Blind to everything above the module
boundary.

**3. IPC wiring** — one file, `test/ipc-wiring.test.cjs`, 151 tests. Loads the real `src/main.js`
with `electron` replaced by a double, and exercises the ~58 handlers: what each returns, what it
rejects, what error it gives. Blind to the window, and its store is a stand-in rather than the real
one.

**4. Journeys** — `e2e/journeys/`, 8 tests. Starts the whole app, built from the source tree, and
drives it. Asks the only question the other three cannot: can a contributor do their work without
losing it. Blind to anything about packaging.

**5. Packaged smoke** — `e2e/packaged/`, 4 tests. Starts the built artifact — the `.app` or `.exe`
a user downloads — and asks whether it is whole. Blind to behaviour: it never gets as far as a flow.

Layers 1–3 are `npm test`. Layers 4 and 5 are the two `test:e2e` commands. That proportion, a
thousand cheap tests to a dozen expensive ones, is the shape to keep.

## Where to put a new test

- **A pure function, a derived string, a decision with branches** → layer 1. If it lives inside
  `src/renderer/index.jsx` today, move it to a `src/renderer/*.cjs` module first: that component
  mounts at module scope and nothing in the suite can load it, so a decision made there is
  untestable by construction.
- **Anything that asks Git a question** → layer 2, against a real repository. There is a local Git
  server fixture in `test/trunk-update-fetch.integration.test.cjs` for cases that need a remote,
  because `isomorphic-git` has no `file://` transport.
- **A new IPC handler** → layer 3, plus the `contextBridge` entry in `src/preload.js`, which layer 5
  checks is actually exposed.
- **A flow that spans the interface, the main process, Git and the store at once** → layer 4.
- **Something that can only break during packaging** → layer 5.

Keep layer 4 small on purpose. Every test there costs an app launch, and any assertion that does not
need a window belongs one layer down.

The failures worth layer 4 are the ones that fall *between* the other layers, where every piece works
and the whole does not. One example, found while writing the first journeys: the integration tests
prove branch switching restores work correctly, and the wiring tests prove the delete handler returns
the checkout to trunk when the deleted branch was the current one — but the interface leaves the
currently linked ticket out of the list it offers delete controls for, so that branch of the handler
cannot be reached by a contributor at all. Three layers passing, one path dead.

## The two end-to-end layers, and why they are separate

They run **the same source code in two different containers**, and each container has failures the
other cannot have.

Layer 4 runs the code the way `npm start` does: `src/main.js` on disk, `node_modules` beside it.
Layer 5 runs what `electron-builder` produces, where all of `src/` and every production dependency is
compressed into a single `app.asar`, and native modules are pulled back out beside it because the
operating system cannot load a binary from inside an archive. A path that resolves from a directory
may not resolve from inside that archive; a native binary can be selected for the wrong runtime while
`npm ci` and the packaging both exit 0 and the app still starts. Those failures do not exist in the
source tree, because there is nothing packaged to get wrong.

So layer 5 asks only whether the container is intact, and **writes no state at all**.

That last part is a constraint, not minimalism. The app only honours a redirected application-data
directory in development builds (`!app.isPackaged` in `src/main.js`); the packaged app always writes
to the real site registry of whoever runs it. So a test that drives a flow cannot run against the
artifact without writing to somebody's actual sites.

Layer 4 gets a throwaway application-data directory per test, and the harness reads back the path the
app chose and **refuses to run** if it is not the throwaway one. Nothing a journey does can reach the
sites you work on.

**The gap this leaves**, stated plainly: a flow that behaves differently *because* of packaging is
caught by neither layer. Layer 5 covers it only indirectly — if the container is intact, the code
inside it is the same code. Closing it properly would mean letting the packaged app accept a
redirected data directory under a test-only condition, which is a seam in shipped software and is not
worth opening until a failure of that shape actually escapes.

## Running the packaged smoke test

It needs an artifact, so build one first:

```
npm run build:once && CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
npm run test:e2e:packaged
```

`CSC_IDENTITY_AUTO_DISCOVERY=false` is mandatory on macOS — electron-builder signs during `--dir`
without it — and harmless everywhere else. The test tells you if you forgot the build.

Neither end-to-end command downloads a browser. The only thing they launch is the Electron already in
the tree, so there is no `playwright install` step anywhere.

## Reading a failure

Every end-to-end failure keeps a Playwright trace. Replay it with:

```
npx playwright show-trace test-results/<the failing test>/trace.zip
```

A failing journey also attaches the screen and the state the app had persisted at that moment,
because the interesting half of a failure in this app is usually on disk rather than on screen. In
CI both come back as a workflow artifact.

## What CI runs

Three workflows, on every pull request and on push to `trunk`. None needs a secret.

**[`lint.yml`](.github/workflows/lint.yml)** — `eslint . --max-warnings=0` over the whole repo. It
installs with `npm ci --ignore-scripts`, so linting never executes the pull request's code.

**[`unit-tests.yml`](.github/workflows/unit-tests.yml)** — layers 1–3 on macOS and Windows, and on
each platform **twice**: once on the system Node pinned in `.nvmrc`, once on the Node that Electron
bundles. That second pass is not redundant. Child processes in this app run on Electron's own Node,
and the two versions are set independently and have drifted before (#37/#46).

**[`e2e.yml`](.github/workflows/e2e.yml)** — layers 4 and 5 on macOS and Windows, as two jobs for
every pull request that is not a draft. They are separate because they cost very different amounts:
the journeys take seconds, and packaging takes several minutes per platform.

Every matrix uses `fail-fast: false`, so a Windows failure never hides the macOS result.

## Conventions

- `npm test` collects `test/` only, and never picks up `e2e/`. That is deliberate: end-to-end tests
  need a built renderer and cost seconds each, and the fast suite has to stay something you run
  without thinking.
- End-to-end selectors read the text and roles already on screen. No `data-testid` — the visible copy
  is the contract, and renaming a button is a change worth noticing.
- Journeys mark each assertion as an **invariant** (must hold under any model of how work is stored)
  or a **characterisation** (true because of how the app stores things today). A red invariant is a
  bug; a red characterisation is a prompt to read it and update it deliberately.
- A bugfix's test must fail on the old code. A test written after the fix pins whatever the current
  behaviour is, rather than the correction.

The full review standard, including what counts as a test-shaped finding, is in
[`.github/instructions/code-review.instructions.md`](.github/instructions/code-review.instructions.md).
