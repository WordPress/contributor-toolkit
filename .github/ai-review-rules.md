# Automated review rules

What an automated reviewer should look for in this repo. Read by two callers:

- `.github/workflows/ai-review.yml` — runs on every non-draft PR
- `.claude/skills/self-review/SKILL.md` — the `/self-review` skill, run by the author before opening a PR

One file so both say the same thing. Editing it changes both.

## Scope

Review **judgement**, not style. ESLint (`eslint.config.mjs`, `npm run lint`) already covers
formatting, unused variables, JSDoc, React hooks and the rest of the mechanical layer. Repeating
those here buries the findings that matter. When style and process nits share space with
substantive findings, authors learn to skim past them — and the substantive findings go with
them.

Four dimensions, in priority order: **architecture · security · performance · cross-platform**.

## What this app is

An Electron app that sets up a `wordpress-develop` environment with **zero prerequisites** — no
Git, Node, npm or Docker on the host. Everything runs as JS/WASM inside the Electron process. Its
users are Contributor Day newcomers on macOS and Windows, often on locked-down machines.

That premise is what most of the rules below protect. A change that quietly reintroduces a host
dependency defeats the entire point of the project.

---

## 1. Architecture

Invariants. Breaking one is a `[fix here]` finding even when the code works on the author's
machine.

**Child processes run on Electron's bundled Node, never the host's.** Spawns go through
`process.execPath` with `ELECTRON_RUN_AS_NODE=1` in the environment (see `runNpmWithEngineRetry`
and the `playground:start` handler in `src/main.js`, and `buildChildEnv`). A bare `spawn('node')`
or `spawn('npm')` assumes a host toolchain that is not there. On Windows child `npm` processes
find a `node` at all only because of the `PATH` shim built by `ensureNodeShimDir` — new spawns
must inherit that environment rather than build their own.

**Git never shells out.** All Git operations go through `isomorphic-git`. Patch and diff
generation is hand-rolled in `src/main.js` (stage untracked files, diff working tree against
`origin/trunk`) precisely because there is no `git` binary to call. Any `spawn('git')` or
`exec('git ...')` is a regression.

**`electron-store` is the only persistence layer.** No database, no sidecar JSON. It holds the
site registry and per-site metadata and is the single source of truth for "known sites". A second
store, a cache file, or state parked in a module-level variable that outlives a handler is
architectural drift — flag it.

**Long-running output streams; it is not returned.** Installs, scripts and the Playground server
push output to the renderer through correlated IDs (`installId`, `runId`, `sitePath`) over
dedicated channels. See the handler pairs in `src/preload.js`. A new long-running operation that
resolves its `invoke()` with accumulated output instead of streaming will look fine on a fast
machine and hang the UI on a slow one.

**The renderer↔main boundary is fixed.** New surface means a `contextBridge` entry in
`src/preload.js` plus an `ipcMain.handle` in `src/main.js`. `contextIsolation: true` and
`nodeIntegration: false` are set on every `BrowserWindow` — the main window and both patch
windows — and are not negotiable. Flag any window created without them, and any attempt to widen
the bridge by exposing `ipcRenderer` itself rather than named functions.

Also worth flagging: a new runtime dependency that needs native compilation or a host binary,
since it breaks the zero-prerequisite promise on user machines.

## 2. Security

The threat model is not a hostile user — it is a contributor's laptop on a conference or café
network, running a WordPress with `admin`/`admin`.

**Validate what crosses IPC.** Every `ipcMain.handle` argument comes from the renderer and is
untrusted input. Paths get used for file operations, URLs get opened.

> Known open case, useful as a calibration example: the `url:open` handler in `src/main.js` passes
> its argument straight to `shell.openExternal()` with no scheme check, so `file://` and
> `javascript:` get through. If a PR touches this handler and the review does not mention it, the
> review is not working.

**Servers stay on loopback.** `src/bind-loopback.js` patches `net.Server.prototype.listen` so
Playground's servers bind to `127.0.0.1` instead of every interface. Any new listener that is
created before that patch is applied, or that passes an explicit non-loopback host, exposes the
contributor's site to the local network. This is what the file exists to prevent — read its
header comment before deciding a change is safe.

**Never `shell: true`.** Existing spawns pass `shell: false` deliberately. A shell turns any
path containing a space or a quote into a command-injection vector, and contributor directory
names are user-chosen. The Windows `.cmd` shim path in `src/win-spawn-patch.js` is the one
audited exception; new code should not add another.

**No secrets in the repo, and none in logs.** Pay particular attention to
`scripts/azure-sign.cjs` and `fastlane/`. Signing credentials arrive as environment variables and
must not be echoed into child-process output, which is streamed to the renderer and written to
disk by `electron-log`.

**Untrusted archives and downloads.** Anything unzipped or fetched into a user directory should
be checked for path traversal (`../` in archive entries) before extraction.

## 3. Performance

**The main process must not block.** It runs the UI. Synchronous filesystem calls, large
`JSON.parse`, or hashing on a path that a handler can reach will freeze the whole window. `fs`
sync calls during startup or inside an `ipcMain.handle` deserve a flag; the same call in a
one-shot build script does not.

**Log output is unbounded by nature.** `npm install` on `wordpress-develop` produces a lot of it.
Watch for per-chunk work that is quadratic, and for buffers that accumulate the full output with
no ceiling — see `src/log-lines.js` for how line splitting is done today.

**Work should not scale with the site registry.** Anything that walks every known site, or stats
every directory, on each render or each IPC call will degrade as a contributor accumulates sites.

Flag performance only where there is a plausible path to a user noticing it. Speculative
micro-optimisation is noise.

## 4. Cross-platform

macOS and Windows are the primary targets; Linux artifacts are published too. CI runs the unit
suite on macOS and Windows, but plenty gets past it.

**Paths.** Compose with `path.join` / `path.resolve`, never string concatenation with `/`. Do not
compare paths case-sensitively — Windows and default macOS filesystems are case-insensitive. Do
not assume a path has no spaces; contributors pick their own directories.

**Killing processes is platform-split.** POSIX relies on the child being a process-group leader
(`detached: true`) so the whole tree can be signalled; Windows uses `taskkill /T`. Both live in
`src/kill-tree.js`. A new spawn that does not set `detached` correctly, or that is terminated with
a bare `child.kill()`, will leave orphaned processes on one platform or the other.

**Windows specifics.** Executables need their extension (`.cmd`, `.bat`, `.exe`) resolved;
`windowsHide: true` keeps console windows from flashing; `EPERM` and `EINVAL` have
Windows-specific causes. `src/win-spawn-patch.js` documents the traps that have already bitten —
consult it rather than re-deriving them.

**Line endings** matter when generating patches, which are destined for Trac.

**Electron's Node version is a real constraint.** It is set independently of `.nvmrc` and the two
have drifted before (issues #37 / #46), which is why the suite runs twice. A change that depends
on a newer Node API needs to hold on whichever of the two is older.

---

## How to report

**Every finding carries a dimension, a severity and a scope.**

- Scope is `[fix here]` or `[follow-up]`. Use `[follow-up]` for cross-cutting refactors and
  anything the PR did not introduce. This gives the author a defensible "noted, separate PR"
  rather than a finding that looks ignored.
- Severity: 🔴 high, 🟡 medium, 🔵 low.

**Structure**: inline comments on the exact lines for `[fix here]` findings, plus one summary
comment carrying the counts. Style and process observations go in a collapsed `<details>` block at
the bottom of the summary, never in the body, and never as inline comments.

**On re-runs, reconcile — do not re-review from scratch.** Read the previous summary comment
first and mark each earlier finding resolved, still open, or obsolete. Re-asserting a fixed
finding is the fastest way to get the whole review ignored.

**Say when there is nothing.** "No findings across the four dimensions" in one line is a good
review. Do not pad. Do not restate what the PR does — the author knows.

**Verify before claiming.** Read the surrounding file before asserting an invariant is broken;
the diff alone often does not show that a helper already handles the case. A confident wrong
finding costs more than a missed one.

**Never approve, request changes, or merge.** Post comments only. The human decides.
