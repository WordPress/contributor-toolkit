# AGENTS.md

Instructions for AI coding agents working in this repository. Tool-neutral and canonical —
`CLAUDE.md` points here rather than repeating it.

## Where things are, whatever agent you use

Two files, and neither is specific to one tool despite what their paths suggest:

**The review standard** —
[`.github/instructions/code-review.instructions.md`](.github/instructions/code-review.instructions.md).
The five dimensions, this project's invariants, the procedure to run them, and the reporting
format. Read it directly if your agent has not already.

It sits under `.github/instructions/` because Copilot code review reads that directory natively and
follows no links out of it. Anywhere better-named would have meant maintaining a condensed second
copy for Copilot, which would drift. Every other agent reaches it from here.

**The review as a skill** — a thin `SKILL.md` wrapper over the file above, in two locations because
no single skills directory is read by every agent:

- [`.claude/skills/self-review/`](.claude/skills/self-review/) — Claude Code and Copilot. In Claude
  Code it is `/self-review`.
- [`.agents/skills/self-review/`](.agents/skills/self-review/) — the Agent Skills open-standard path
  that Command Code and others scan.

Both are pointers to the one instructions file, not copies of the standard. If your agent looks
somewhere else again (`.github/skills/`, `.cursor/skills/`, `.codex/skills/`, or its own
convention), add a wrapper there or skip it entirely and follow the instructions file — that is
where all the content lives. The wrapper only adds two things: run the judgement pass in a fresh
context, and report without touching GitHub.

There is deliberately no per-tool copy of the *standard*. A wrapper is a few lines that defer to it;
duplicating the standard itself is the thing to avoid — if you find yourself doing that, fix the
pointer, not the number of copies.

## What this is

An Electron desktop app ("WordPress Contributor Toolkit") that sets up a full WordPress core
(`wordpress-develop`) dev environment with zero prerequisites — no Git, Node, npm, or Docker
required on the host. Everything is bundled and run as JS/WASM inside the Electron process. Built
to fix a Contributor Day problem: newcomers burning the whole session on local setup instead of
contributing. Still labeled "experimental."

## Before opening a pull request

Run the review in `.github/instructions/code-review.instructions.md` against the branch, and fix or
consciously defer every finding. Summarise the outcome in the pull request description — counts,
what was fixed, what was left as a follow-up and why.

Nothing enforces this. There is no automated review on pull requests, by design: it would mean
storing an AI provider credential as a secret in a public repository. This pass is what stands in
its place, so skipping it means a human reviewer is the first reader of the diff.

That file carries the procedure as well as the standard. Follow it rather than improvising a
review.

For the human-facing version of all this — the CI checks each PR runs and the guardrails in prose —
see [`CONTRIBUTING.md`](CONTRIBUTING.md). It points back here; it does not restate the standard.

## Commands

See `package.json` scripts. To run a single test file (not exposed as a script):
`node --test test/azure-sign.test.cjs`.

## Architecture notes (non-obvious)

- **Child processes run on Electron's own Node, not the system Node.** `npm install`,
  `npm run <script>`, and the Playground server are spawned via `process.execPath` +
  `ELECTRON_RUN_AS_NODE=1` — this is the mechanism behind "zero prerequisites." On Windows this
  requires shimming `node`/`npm`/`npx` into `PATH` so child `npm` processes can find a `node` binary
  at all.
- **Git has no system dependency** — all Git ops go through `isomorphic-git`, not a shelled-out
  `git` binary. Patch/diff generation is done by hand in `main.js`, not `git diff`: one status scan
  against the branch point each ticket recorded (#108), nothing staged, and `/dev/null` naming
  whichever side of an addition or a deletion does not exist — the app reads its own patches back
  when a mentor applies one, and that filename is the only thing its parser reads an add or a
  delete from (#85).
- **`electron-store` is the only persistence layer** — no separate DB. It holds the site registry
  and per-site metadata; treat it as the single source of truth for "known sites."
- Long-running child-process output (installs, scripts, server) is streamed to the renderer via
  correlated IDs (`installId`/`runId`), not returned synchronously — expect async event handlers,
  not return values, when tracing that flow.

## Signing & CI

- **Buildkite builds signed Windows, Linux and macOS artifacts for every branch that has an open
  PR.** So a branch is testable on a real machine without building locally — and for a stacked PR,
  the artifact from the topmost branch exercises the whole stack. Force-pushing a branch invalidates
  earlier artifacts: check the build corresponds to the current head commit before testing.
- Windows signing (Azure Trusted Signing via `scripts/azure-sign.cjs`) is skipped automatically when
  its required env vars aren't set — this is intentional for local dev, not a bug.
- macOS signing/notarization uses fastlane + match against Automattic's Developer ID;
  `verify_code_signing` lane must pass before shipping.
