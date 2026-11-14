---
name: wordpress-contributor-toolkit
description: Set up and drive a WordPress Core or Gutenberg development site through the WordPress Contributor Toolkit desktop app. Use when asked to spin up a local WordPress environment for a Trac ticket or GitHub issue, test or apply a patch or pull request, start a dev site, or read a site's debug log or outgoing mail, and the person has the WordPress Contributor Toolkit installed.
---

# WordPress Contributor Toolkit

The WordPress Contributor Toolkit is a desktop app that makes a `wordpress-develop` or Gutenberg checkout with its own Git, Node, npm and PHP server. It writes a command, `toolkit`, that you run in a terminal to work with those sites. Use it instead of cloning, installing or starting servers yourself: the app has already done that work, and its checkout is the one the person sees.

## Before you start

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:56d80231580a56174c45cc4ac32300e049605269e2142e71da5eaa788ceeea3b -->

1. **Get the command's path from the person.** Ask them to open the app, go to **Settings → Tools**, press **Copy command** and paste it to you. It is a full path in quotes, for example `"/Users/you/Library/Application Support/WordPress Contributor Toolkit/bin/toolkit"`, or `...\bin\toolkit.cmd` on Windows. Keep the quotes: the path has a space in it. Below, `toolkit` stands for that quoted path. In PowerShell, put the call operator `&` before the quoted path and the arguments after it: `& "<copied executable path>" sites --json`. Use that invocation wherever `toolkit` appears below.

2. **Check what you may do.** Run `toolkit sites --json`. If it works, you can read. Commands that change a site answer `tools-not-allowed` until the person turns on **Let tools on this computer change my sites** in that same tab. That switch is the person's consent: ask them to turn it on, and never change the app's settings file yourself.

<!-- /coderabbit-ai-generated:v1 -->

## Rules

- Always pass `--json` and read `ok`, `code` and `error`. A non-zero exit status means it failed.
- Every command waits until what it started has ended. Creating a site, updating trunk and building take minutes: give them a long timeout (up to 90 minutes for `create`) and do not run them twice.
- Name a site by its path, or leave the site out when your working directory is inside it.
- Edit files in the site's folder directly. Do everything else through `toolkit`.
- **Do not run `git` commands that change the checkout** (no `checkout`, `switch`, `rebase`, `merge`, `stash`, `reset`, `commit`). The app keeps each ticket's work on its own branch and tracks it. A rebase or merge left half-finished from a terminal puts the site in a state the app refuses to touch. `git status`, `git diff` and `git log` are fine.
- **Do not run `npm` yourself**, and never `npm run watch`: on WordPress Core it runs a full production build first. Use `toolkit run build`. On a Core site `toolkit server start` also starts the build watch, so edits compile as you save. On a Gutenberg site that is already built it does not: run `toolkit run build` after every edit.
- Never try to delete a site, discard the person's changes, attach a patch to Trac or open a pull request. The command cannot, and the person does those in the app.
- When a command answers `dirty-trunk`, `dirty` or says the app is asking a question in its window, stop and tell the person: the answer is theirs.

## Commands

Reading (always allowed):

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:dd2ceb877776244c66b7c5b842bf3895053f95fc27e1a2a61fc696eeae14baf3 -->

| Command | Answer |
| --- | --- |
| `toolkit sites --json` | `sites[]` with `path`, `label`, `project` (`core` or `gutenberg`), `workItem` (`{provider, id}` or null), `branch`, `pullRequest`, `initialized`, `server` (`{running, url}`) |
| `toolkit log [site] [--lines N] --json` | `lines[]`, the end of the site's WordPress `debug.log`; `exists` is false until WordPress logs something |
| `toolkit mail [site] --json` | `emails[]`, newest first, each with `sentAt`, `from`, `to`, `subject`, `text`, `textTruncated`; `total`. When `textTruncated` is true, report that the email text is truncated; do not present it as complete |

<!-- /coderabbit-ai-generated:v1 -->

Changing a site (needs the switch):

| Command | What it does |
| --- | --- |
| `toolkit create "<name>" [--project core\|gutenberg] [--folder <path>] --json` | Creates a site, installs and builds it. Answers `site`, its path. |
| `toolkit ticket link <number-or-url> [site] [--carry] --json` | Links a Trac ticket (Core) or GitHub issue (Gutenberg) and switches to its branch. |
| `toolkit ticket unlink [site] --json` | Back to trunk. The ticket's work stays on its branch. |
| `toolkit patch apply [site] --json` | Applies the latest patch or pull request on the linked ticket. |
| `toolkit pr checkout <number> [site] --json` | Checks out a pull request. |
| `toolkit pr leave [site] --json` | Leaves the pull request. |
| `toolkit update [site] --json` | Updates to the latest trunk, installs and builds as needed. |
| `toolkit install [site] --json` | `npm install`. |
| `toolkit run <script> [site] --json` | An npm script: `build`, `build:dev`, `test`, `grunt` on Core; `build`, `test:unit`, `lint`, `lint:js` on Gutenberg. Answers `output`, the end of what it printed. |
| `toolkit server start [site] --json` | Starts the dev server. Answers `url`. |
| `toolkit server stop [site] --json` | Stops it. |

## Recipes

**"Spin up a local environment to test Trac ticket #65930"**

```
toolkit sites --json
toolkit create "Ticket 65930" --json
toolkit ticket link 65930 "<site path from create>" --json
toolkit patch apply "<site path>" --json
toolkit server start "<site path>" --json
```

Reuse an existing Core site from `sites` if the person would rather not wait for a new one: skip `create`, and run `toolkit update` first if they want the latest trunk. Tell the person the `url` from `server start`. The login is `admin` / `password`.

If `patch apply` answers `no-latest-patch`, the ticket has no patch or the app cannot tell which is newest: say so, and ask which one they want. If it answers `apply-failed`, the patch does not apply to today's trunk: report the error text, do not try to force it.

**Testing a change**

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:02c511c1d7ef208e1dfab094d67f89a9d7c84c93b5a1636b074855ba2251d8d9 -->

First change into the site directory using the path returned by `create` above, or the chosen site's `path` from `toolkit sites --json`: `cd "<site path>"`. Run the following commands from that directory.

Edit files under the site's `src/` (Core) or `packages/` (Gutenberg). On a Core site with the server running, the build watch recompiles as you save. On a Gutenberg site, or with the server stopped, run `toolkit run build` after editing. Then:

<!-- /coderabbit-ai-generated:v1 -->

- `toolkit log --lines 50 --json` to see PHP notices, warnings and errors.
- `toolkit mail --json` to read mail WordPress sent, such as a password reset.
- `toolkit run test --json` (Core) or `toolkit run test:unit --json` (Gutenberg) for the tests the app can run. Gutenberg's PHP and end-to-end suites need Docker and are not available.

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:3048ed1ef00365a911cc3873f94962505cc5adbe8a45318441694f4ff50f0bcd -->

**A GitHub pull request by number**

Choose the intended site from `toolkit sites --json` and use its `path` below.

```
cd "<site path from sites>"
toolkit pr checkout 9000 --json
toolkit server start --json
```

<!-- /coderabbit-ai-generated:v1 -->

## Refusal codes

| Code | Do this |
| --- | --- |
| `tools-not-allowed` | Ask the person to turn on the switch in Settings → Tools. |
| `unknown-site`, `ambiguous-site` | Run `toolkit sites --json` and use a `path`. |
| `busy` | Something is running on the site. Wait and try again; do not start a second one. |
| `dirty-trunk` | Edits on trunk would be left behind. Ask the person; with their agreement `ticket link ... --carry` brings them into a new ticket. |
| `dirty` | An update would reset edits. The app is asking the person in its window. |
| `not-built` | The site's setup has not finished. Run `toolkit install` then `toolkit run build`. |
| `no-latest-patch`, `trac-failed`, `patches-failed` | Tell the person; they may need to choose a patch or answer a Trac check in the app. |
| `no-ticket`, `already-applied` | `patch apply` needs a linked ticket and no patch applied already. Link the ticket first; a patch that is applied is reverted by the person, in the app. |
| `is-pull-request` | That number is a pull request, not an issue. Use `pr checkout`. |
| `legacy-site`, `merge-in-progress` | The app does not change this checkout. Tell the person; the site's page says what to do. Do not try to fix it with Git. |
| `site-not-open`, `window-not-ready`, `window-closed` | The app's window was not there. Try once more, then tell the person. |
| `script-failed`, `setup-failed`, `update-failed`, `apply-failed`, `server-failed` | The step failed. Read `error` and `output`, and `toolkit log`. Report it; do not retry blindly. |
| `timed-out` | The app is still working. Check `toolkit sites --json` before doing anything else. |
