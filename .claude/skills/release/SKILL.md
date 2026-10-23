---
name: release
description: Cut a release of the WordPress Contributor Toolkit, stable or beta, from the version bump to the published GitHub release and docs deploy. Use when the user asks to release, cut, ship or publish a version, bump the version for a release, or names a version such as 2.0.0 or 2.1.0-beta.1 to release.
---

# Release

Drive a release from the version bump to the closed milestone, pausing wherever a step is public or needs a person.

## Procedure

**Read `RELEASING.md` and follow it.** It is the specification for this task, not background reading: the version format, the three files to change, the i18n download, the artifact checks, the `gh release create` command, the docs dispatch and the milestone. Do not restate it here; run it. Changes to how releases work go there, not into this wrapper.

The skill takes the version as its argument (`2.0.0`, `2.1.0-beta.1`). If none is given, ask. A version with `-beta.N` is a beta; anything else is stable.

What this skill adds on top:

**Check the starting state first.** Stop and report if trunk is behind `origin/trunk`, if `git status --porcelain --untracked-files=no` prints anything, or if `vX.Y.Z` is already a tag. Untracked files do not block a release. Report, without stopping, any open issues left in the `vX.Y.Z` milestone; they are moved in the last step.

**Stop before every public or irreversible action and wait for a yes.** There are five:

1. Creating the release branch. Name it `release/X.Y.Z` and confirm the name.
2. Pushing the branch and opening the bump pull request.
3. Pushing to the branch again, when it has to be updated with trunk before the merge.
4. `gh release create`, after showing the final notes and the exact command.
5. Dispatching the docs workflow and closing the milestone, moving any open issues to the next milestone by version.

The merge is the person's, never this skill's. Wait to be told it is merged.

**The bump pull request is an ordinary pull request.** Fill in `.github/pull_request_template.md` and run the review AGENTS.md requires before opening it. Put the i18n coverage table in the description. Check the diff with `git diff trunk -- . ':!src/languages'`: three lines removed, three added, all version fields.

**The person downloads the artifacts; this skill checks them.** Ask the person to download the three files from the Buildkite build for the pull request's current head commit (`gh pr view N --json headRefOid`) into a directory they name. Then, in that directory:

- Remove the `dist_` prefix from the Windows file and check the three names against `RELEASING.md` step 2.
- Mount the `.dmg` with `hdiutil attach -nobrowse -readonly`, then in the mounted app:
  - `npx @electron/asar list Contents/Resources/app.asar` holds exactly `/node_modules`, `/package.json` and `/src` at its root, with no `.codesigning`.
  - `npx @electron/asar extract-file Contents/Resources/app.asar node_modules/npm/package.json` gives a `version` starting with `11.`.
  - `plutil -extract CFBundleShortVersionString raw Contents/Info.plist` reads `X.Y.Z`.
- Detach the image and report each result. Say that the asar contents were checked on the macOS artifact only.

**Draft the release notes once the pull request is merged.** Get the squash commit with `gh pr view N --json mergeCommit`; it is the release's `--target`. The base is the previous stable tag for a stable release (`git describe --tags --abbrev=0 --exclude '*-beta*' <squash>^`) and the previous tag of any kind for a beta. The commit count is `git rev-list --count <base>..<squash>`. A stable release that follows betas covers everything since the base, the betas' changes included, and says the betas came first. For the shape, read the model `RELEASING.md` names for a stable release, or the last beta's notes for a beta. Write them plainly. Save them to the scratchpad or a temporary directory, not the repository, and show them in the chat for editing.

**Pass full paths to `gh release create`.** The notes file and the three artifacts are outside the repository, so name each by its path. A stable release adds `--latest`; a beta adds `--prerelease`.

**Verify the end state on GitHub before reporting done.**

- `gh release view vX.Y.Z` shows the three assets with the right names and the right prerelease flag.
- `gh api repos/WordPress/contributor-toolkit/releases/latest --jq .tag_name` names this tag for a stable release, and not for a beta.
- `gh api repos/WordPress/contributor-toolkit/git/ref/tags/vX.Y.Z --jq .object.sha` is the squash commit.
- `gh run list --workflow docs.yml -L 1` shows the docs run for the tag.
- The milestone is closed.

## Notes

- This is the same skill as [`.agents/skills/release/`](../../../.agents/skills/release/), for agents that read the Agent Skills open-standard path. Both are thin wrappers over `RELEASING.md`.
- If a step in `RELEASING.md` turns out wrong or incomplete during a release, say so at the end. That file is meant to accumulate what each release teaches.
