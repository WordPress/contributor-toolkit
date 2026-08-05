---
name: self-review
description: Review the current branch against this repo's architecture, security, performance, cross-platform and test-coverage rules before opening a PR. Use when the user asks to self-review, review my changes, check my branch before a PR, or says they are about to open a PR. Applies the same rules as the CI AI-review workflow.
---

# Self-review

Run the repo's automated review standard against the working branch, **before** the PR exists.

CI runs the same rules on every non-draft PR (`.github/workflows/ai-review.yml`). Running them
here first is the point: a finding fixed now costs one message, the same finding on the PR costs a
review cycle. The producer is responsible for handing over a reviewable change — not the reviewer
for reconstructing the context.

## Procedure

**1. Read the rules.** `.github/ai-review-rules.md` — the same file CI reads. It defines the five
dimensions, the repo invariants, and the reporting bar. It is the specification for this task.

**2. Establish the diff.**

```bash
git fetch origin trunk
git diff --stat origin/trunk...HEAD
git diff origin/trunk...HEAD
```

Include uncommitted work if there is any (`git status --short`, `git diff`) — the author is about
to commit it, so it is in scope.

**3. Run the deterministic layer first**, so the mechanical findings never reach the judgement
pass:

```bash
git diff --name-only --diff-filter=ACMR origin/trunk...HEAD -- '*.js' '*.jsx' '*.cjs' '*.mjs' \
  > /tmp/self-review-changed.txt
if [ -s /tmp/self-review-changed.txt ]; then
  xargs npx eslint --max-warnings=0 --no-warn-ignored < /tmp/self-review-changed.txt
else
  echo "No JavaScript changed — nothing to lint."
fi
npm test
```

The emptiness check is not optional. `xargs` runs its command once even on empty input, which
would turn a docs-only or workflow-only branch into a bare repo-wide `eslint` and fail on the
~85 pre-existing findings that have nothing to do with the branch. `lint.yml` guards the same
way in CI.

Report both results plainly. If ESLint fails, offer to re-run the same file list with `--fix`
rather than `npm run lint:fix` — that script is `eslint . --fix` across the whole repo and would
rewrite untouched files into the contributor's diff:

```bash
xargs npx eslint --fix < /tmp/self-review-changed.txt
```

Do not hand-fix what the fixer handles.

**4. Review the five dimensions** — architecture, security, performance, cross-platform, tests — against
the rules file. Read the surrounding files, not just the diff: the rules require verifying a
finding before asserting it, and a diff rarely shows that a helper already handles the case.

**5. Report in the chat.** No GitHub comments, no files written — this runs before the PR exists.
Same shape as CI:

- Counts first: `2 [fix here] · 1 [follow-up]`
- Each finding: dimension, severity (🔴/🟡/🔵), scope, `file:line`, and what actually goes wrong
- Style and process notes last, grouped and brief
- If there is nothing, one line saying so

**6. Offer, do not apply.** Ask before changing anything. The author decides what is a real
finding — that judgement is the whole reason the review happens before the PR rather than after.

## Notes

- Complements the built-in `/code-review` and `/security-review`. What this adds is the
  repo-specific knowledge: Electron's bundled Node, `isomorphic-git`, `electron-store`,
  loopback binding, the Windows spawn shims.
- If a finding reveals a rule the file does not yet cover, say so. `.github/ai-review-rules.md` is
  meant to accumulate what the team learns.
