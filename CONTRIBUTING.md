# Contributing

Much of the work on this project happens with the support of AI coding agents. The quality bar is
not held by trusting the agent — it is held by a small set of guardrails, some
automated on every pull request, some run by the author before the PR exists. This page is the map
of them.

If you are an agent, start with **[AGENTS.md](AGENTS.md)** — it is the canonical, tool-neutral set
of instructions. This file is the human-facing companion: what the guardrails are and what you are
expected to do before opening a PR.

## Checks that run on every pull request

Three GitHub Actions workflows run on every PR, and also on push to `trunk` so the default branch
carries a status a branch-protection rule can require. Neither needs secrets, and neither is
credential-gated — everything here is safe to run on a public repository.

### Lint — [`.github/workflows/lint.yml`](.github/workflows/lint.yml)

ESLint over the **whole repo**: `eslint . --max-warnings=0`. A single warning fails the check. The
backlog that once made a repo-wide run impractical was cleared (#117), so the check now covers
every file rather than only the ones a PR touched.

It installs with `npm ci --ignore-scripts`, which skips lifecycle scripts — so linting **never
executes the PR's code** (this repo's `postinstall` would otherwise pull the Electron binary, which
the linter does not need). If ESLint flags something mechanical, `npm run lint:fix` handles it;
check what it rewrote before committing, since it too is repo-wide.

### Unit tests — [`.github/workflows/unit-tests.yml`](.github/workflows/unit-tests.yml)

The unit suite runs on the **two platforms the app ships to — macOS and Windows** — and on each
platform it runs **twice**:

- `npm test` — on the system Node pinned in `.nvmrc`.
- `npm run test:electron` — on the Node that Electron bundles.

That second pass is not redundant. Child processes in this app run on Electron's own Node, not the
system Node, and the two versions are set independently and have drifted before (#37/#46). Running
both is how a drift gets caught before it ships. The matrix uses `fail-fast: false`, so a Windows
failure never hides the macOS result — you always see both.

### End-to-end tests — [`.github/workflows/e2e.yml`](.github/workflows/e2e.yml)

Two suites, both launching a real app on macOS and Windows for every pull request that is not a
draft. They answer different questions, so they are separate jobs and separate commands.

- `npm run test:e2e` — **the journeys**. Drives the app built from the source tree through the flows
  a contributor performs by hand: linking a ticket, applying and reverting a patch, moving between
  ticket branches. Each test gets its own throwaway application-data directory and its own Git
  fixture, so nothing it does can reach the sites you actually work on — and the harness refuses to
  start at all if it ever finds the app using a different profile. Nothing here touches the network.
  Seconds to run.
- `npm run test:e2e:packaged` — **the packaged smoke test**. Launches an unsigned
  `electron-builder --dir` build and asks only whether packaging worked: it boots, the whole preload
  bridge is exposed, and the modules that exist only if packaging succeeded do resolve. Build it
  first, or the test will tell you to:

  ```
  npm run build:once && CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack:dir
  ```

  That environment variable is mandatory on macOS — electron-builder signs during `--dir` without
  it — and harmless everywhere else.

Neither downloads a browser. The only thing they launch is the Electron already in the tree, so
there is no `playwright install` step anywhere.

When one fails, the run keeps the trace, and the journeys additionally attach the screen and the
state the app had persisted at the moment it failed — the interesting half of a failure in this app
is usually on disk rather than on screen. Locally, `npx playwright show-trace test-results/<the
failing test>/trace.zip` replays it.

`npm test` does not pick these up and never will: the unit runner only collects `test/`, and these
live in `e2e/`. Keeping them out of `npm test` is deliberate — they need a built renderer and cost
seconds each, and the unit suite has to stay something you run without thinking about it.

## The test suite: five layers, and where a new test belongs

The sections above say what CI runs. This one says what the suite *is*, because "add a test" is not
a single instruction here — there are five places a test can go, and putting one in the wrong place
is how a suite gets slow without getting better.

They are listed cheapest first. That ordering is also the rule: **write a test at the highest layer
that can still see the failure.** What each layer cannot see is the part worth reading — it is what
sends a test one layer down, or up.

**1. Unit** — 63 files. Starts nothing; calls plain functions. Pure logic: parsing a ticket
reference, deriving a status, building a command line. Blind to anything touching disk, a process
or a window.

**2. Integration** — 6 files, 89 tests. Runs the real modules against real Git repositories in a
temporary directory. Proves Git does what the code assumes when it switches a branch, applies a
patch or updates trunk. Blind to everything above the module boundary.

**3. IPC wiring** — one file, 151 tests. Loads the real `src/main.js` with `electron` replaced by
a double, and exercises the ~58 handlers: what each returns, what it rejects, what error it gives.
Blind to the window, and its store is a stand-in rather than the real one.

**4. Journeys** — 8 tests. Starts the whole app, built from the source tree, and drives it. Asks
the only question the other three cannot: can a contributor do their work without losing it. Blind
to anything about packaging.

**5. Packaged smoke** — 4 tests. Starts the built artifact, the `.app` or `.exe` a user downloads,
and asks whether it is whole. Blind to behaviour: it never gets as far as a flow.

Layers 1–3 are `npm test`: 1,027 tests in under three seconds, and nothing leaves the machine — the
one suite that needs a Git remote serves it from a loopback server it starts itself. Layers 4 and 5
are the two `test:e2e` commands. That proportion, a thousand cheap tests to a dozen expensive ones,
is the shape to keep.

### Why layers 4 and 5 are separate, and why both exist

They test **the same source code in two different containers**, and each container has failures the
other cannot have.

Layer 4 runs the code the way `npm start` does: `src/main.js` on disk, `node_modules` beside it.
Layer 5 runs the artifact `electron-builder` produces, where all of `src/` and every production
dependency is compressed into a single `app.asar`, and native modules are pulled back out beside it
because the operating system cannot load a binary from inside an archive. A path that resolves from
a directory may not resolve from inside that archive; a native binary can be selected for the wrong
runtime while `npm ci` and the packaging both exit 0 and the app still starts. Those failures do not
exist in the source tree, because there is nothing packaged to get wrong.

So layer 5 asks only whether the container is intact — it boots, the whole preload bridge is there,
the modules that only resolve if packaging worked do resolve — and **writes no state at all**.

That last part is not minimalism, it is a constraint. The app only honours a redirected
application-data directory in development builds (`!app.isPackaged` in `src/main.js`); the packaged
app always writes to the real site registry of whoever runs it. So a test that drives a *flow* —
linking tickets, creating branches, applying patches — cannot run against the artifact without
writing to somebody's actual sites. Layer 4 exists in the shape it does for that reason as much as
for speed.

**The gap this leaves**, stated plainly: a flow that behaves differently *because* of packaging
would be caught by neither layer. Layer 5 covers it only indirectly — if the container is intact,
the code inside it is the same code. Closing it properly would mean letting the packaged app accept
a redirected data directory under a test-only condition, which is a seam in shipped software and is
not worth opening until a failure of that shape actually escapes.

### Where to put a new test

- **A pure function, a derived string, a decision with branches** → layer 1. If it lives inside
  `src/renderer/index.jsx` today, move it to a `src/renderer/*.cjs` module first: that component
  mounts at module scope and nothing in the suite can load it, so a decision made there is
  untestable by construction.
- **Anything that asks Git a question** → layer 2, against a real repository. There is a local Git
  server fixture in `test/trunk-update-fetch.integration.test.cjs` for the cases that need a remote,
  because `isomorphic-git` has no `file://` transport.
- **A new IPC handler** → layer 3, plus the `contextBridge` entry, which layer 5 checks is actually
  exposed.
- **A flow that spans the interface, the main process, Git and the store at once** → layer 4. Keep
  this layer small on purpose: every test costs an app launch, and any assertion that does not need
  a window belongs one layer down.
- **Something that can only break during packaging** → layer 5.

The failures worth layer 4 are the ones that fall *between* the other layers, where every piece
works and the whole does not. One example, found while writing the first journeys: the integration
tests prove branch switching restores work correctly, and the wiring tests prove the delete handler
returns the checkout to trunk when the deleted branch was the current one — but the interface leaves
the currently linked ticket out of the list it offers delete controls for, so that branch of the
handler cannot be reached by a contributor at all. Three layers passing, one path dead.

## The review standard, and who reads it

There is **one** source of truth for how a change is reviewed:
**[`.github/instructions/code-review.instructions.md`](.github/instructions/code-review.instructions.md)**.
It holds the five review dimensions (architecture, security, performance, cross-platform, tests),
this project's specific invariants, and the procedure to run them. It is deliberately the only copy
— everything else points at it rather than restating it, so nothing can drift.

Two things consume that one file:

### Copilot code review — assign it to a PR

Copilot code review reads `.github/instructions/*.instructions.md` **natively**, selecting files by
their `applyTo` glob (this one is `**`, so it applies to every PR). That is the entire reason the
standard lives at this path and not somewhere better-named — Copilot follows no links, so a pointer
would not have reached it.

Copilot is **assigned manually** as a reviewer on a pull request; it is **not** an automatic bot
that fires on every PR. That is by design: an always-on AI review would mean storing an AI provider
credential as a secret in a public repository, which this project will not do. What exists is the
*capability* — assign Copilot and it reviews against the same standard the author already ran.

### The author's own pass — before you open the PR

The author runs the review against their branch **before** the PR exists — because a finding fixed
now costs one message, and the same finding on the PR costs a full review cycle. This means running
`npm run lint` and `npm test`, then reviewing the five dimensions against the diff.

How you invoke it depends on your agent:

- **Claude Code** ships this as the [`/self-review`](.claude/skills/self-review/) skill. It adds one
  thing worth knowing: it hands the judgement pass to a **fresh subagent**, given only the diff and
  the standard. If the session that wrote the code also grades it, it reviews its own reasoning and
  finds it sound — so the review runs in a context that did not write the change. It reports in the
  chat and touches nothing on GitHub; you decide what is a real finding.
- **Open-standard agents** (Command Code and others that scan `.agents/skills/`) find the same
  review as [`/self-review`](.agents/skills/self-review/), a wrapper mirroring the Claude Code one.
- **Any other agent** — no wrapper sits on the path it reads, so there is no `/self-review` command
  to find. Point it at
  [`code-review.instructions.md`](.github/instructions/code-review.instructions.md) directly, or
  just follow the standard yourself. That file is where all the content lives; the skill is only a
  wrapper over it. If your agent reads a skills directory nobody has wrapped yet, adding a pointer
  there is a few lines — see [AGENTS.md](AGENTS.md).

## What is *not* a PR gate

Worth knowing so you don't wait on them:

- **Buildkite signed builds** produce Windows, Linux, and macOS artifacts for every branch with an
  open PR, so a change is testable on a real machine without a local build. Force-pushing a branch
  invalidates earlier artifacts — check the build matches the current head commit before testing.
- **Download stats** ([`download-stats.yml`](.github/workflows/download-stats.yml)) is a weekly cron
  that records release-asset counts to a `metrics` branch. It is not related to PR quality.

## Before you open a pull request

In an agent-assisted change your agent runs steps 1–3 — it invokes the review, applies or defers the
findings, and drafts the PR summary. Your job is to see that they happen and that the summary is
honest; you own the result even though the agent produced it.

1. **Run the review standard** against your branch —
   [`code-review.instructions.md`](.github/instructions/code-review.instructions.md). In Claude Code
   that is the `/self-review` skill; on any other agent, follow the file directly.
2. **Fix or consciously defer** every finding — a deferral is a decision, not an omission.
3. **Summarise the outcome in the PR description**: what the checks reported, what you fixed, and
   what you left as a follow-up and why.
4. **Write a "How to test this" section** — a starting state, numbered steps naming what to click,
   the expected result of each, and what must *not* have happened. Required on every PR, including
   ones with green tests: this app fails in places the suite cannot reach, and a reviewer should
   never have to guess how to drive the change. The shape is spelled out in
   [AGENTS.md](AGENTS.md#every-pull-request-says-how-to-test-it-by-hand).
5. Optionally **assign Copilot** as a second reader against the same standard.

GitHub fills every new pull request with
[the template](.github/pull_request_template.md); steps 3 and 4 have their place in it already.
It is built so a reviewer gets the change in five minutes — Why, What changes, How to test this,
Risks, Related stay visible and everything deeper goes in a collapsed `<details>` block. Move detail
out of the way rather than dropping it. The same template covers a fix, a feature and a process
change; it flags the few places where the three want different things.

Nothing enforces steps 1–4. Skipping them means a human reviewer is the first person to read the
diff — which is exactly the cost this process exists to avoid.

## The documentation site

The user guide under `docs/` is a VitePress site, deployed to GitHub Pages by
`.github/workflows/docs.yml` on every push to trunk that touches it.

It is a **separate npm package** with its own lockfile, so a root `npm ci` does not install it and
the commands below fail with `vitepress: not found` until you run this once:

```bash
npm ci --prefix docs
```

- `npm run docs:dev` — live-reloading editing server. Pages are served at their `.html` paths
  (`/guide/getting-started.html`); the bare directory URL the banner prints does not resolve in
  dev, only in the built site.
- `npm run docs:build` — what CI runs. It fails on dead links, so run it before pushing.
- `npm run docs:preview` — serves the built site exactly as GitHub Pages will, clean URLs and all.
  This is the one to check a change against before opening a PR.

Its screenshots are captured by `npm run shots` (see `scripts/screenshots/`), not by CI: the harness
launches the app against a seeded, throwaway site registry and photographs each screen at a fixed
size. **A PR that changes what a documented screen looks like re-runs `npm run shots` and commits
the new images** — nothing automated catches a stale screenshot. Shots the fixture registry cannot
reach (a running dev server, a real diff) are listed in the live tier: `npm run shots -- --tier=live`
pauses per shot while you set the real screen up, and those images show real paths, so look at each
one before committing it.
