# Contributing

Much of the work on this project happens with the support of AI coding agents. The quality bar is
not held by trusting the agent — it is held by a small set of guardrails, some
automated on every pull request, some run by the author before the PR exists. This page is the map
of them.

If you are an agent, start with **[AGENTS.md](AGENTS.md)** — it is the canonical, tool-neutral set
of instructions. This file is the human-facing companion: what the guardrails are and what you are
expected to do before opening a PR.

## Checks that run on every pull request

Two GitHub Actions workflows run on every PR, and also on push to `trunk` so the default branch
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
4. Optionally **assign Copilot** as a second reader against the same standard.

Nothing enforces steps 1–3. Skipping them means a human reviewer is the first person to read the
diff — which is exactly the cost this process exists to avoid.
