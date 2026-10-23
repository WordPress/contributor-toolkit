---
name: release
description: Cut a release of the WordPress Contributor Toolkit, stable or beta, from the version bump to the published GitHub release and docs deploy. Use when the user asks to release, cut, ship or publish a version, bump the version for a release, or names a version such as 2.0.0 or 2.1.0-beta.1 to release.
---

# Release

Drive a release through `RELEASING.md`, pausing wherever a step is public or needs a person.

## Procedure

**Read [`RELEASING.md`](../../../RELEASING.md) and follow it.** It is the specification for this task, not background reading: every step and every command lives there, including the artifact checks, how to pick the base for the release notes, and the checks after publishing. Do not restate it here; run it. Changes to how releases work go there, not into this wrapper.

The skill takes the version as its argument (`2.0.0`, `2.1.0-beta.1`). If none is given, ask. A version with `-beta.N` is a beta; anything else is stable.

What this skill adds on top:

**Check the starting state first.** Run the checks in section 1, item 1 of `RELEASING.md`, and stop and report if any fails. If a milestone named for the full version exists, report any issues still open in it, without stopping.

**Wait for the person's yes before each of these:**

1. Creating the release branch, after confirming its name.
2. Pushing the branch and opening the bump pull request.
3. Pushing to the branch again, when it has to be updated with trunk before the merge. Then repeat the artifact checks on the new head's build.
4. `gh release create`, after showing the final notes and the exact command.
5. Dispatching the docs workflow, and closing the milestone if the release has one.

The merge is the person's, never this skill's. Wait to be told it is merged.

**The bump pull request is an ordinary pull request.** Fill in `.github/pull_request_template.md` and run the review AGENTS.md requires before opening it.

**The person downloads the artifacts; this skill checks them.** Ask the person to download the three files from the build for the pull request's current head into a directory they name, then run the checks in section 2 of `RELEASING.md`, *Check the signed artifacts*, and report each result.

**Draft the release notes once the pull request is merged.** Write them plainly, save them to a temporary directory outside the repository, and show them in the chat for editing before `gh release create` (item 4 above).

**Run the checks in section 7 of `RELEASING.md`, *Check the result*, before reporting done**, and report each one.

## Notes

- This is the same skill as [`.claude/skills/release/`](../../../.claude/skills/release/), placed here because agents built on the Agent Skills open standard discover skills under `.agents/skills/`. Both are thin wrappers over `RELEASING.md`.
- If a step in `RELEASING.md` turns out wrong or incomplete during a release, say so at the end. That file is meant to accumulate what each release teaches.
