# Releasing

How to cut a release of the WordPress Contributor Toolkit. Run every command from the repository root unless a step says otherwise.

Versions are `X.Y.Z` for a stable release and `X.Y.Z-beta.N` for a beta. Tags add a `v`: `v1.2.0`, `v1.2.0-beta.2`. Any other suffix, such as `-rc.1`, is not covered here: stop and decide how to release it before using these steps. In the commands below, `X.Y.Z` stands for the full version, `-beta.N` included.

Versions follow [Semantic Versioning](https://semver.org/). The app has no public API, so the three numbers are about what a person who already uses it notices. A **major** release changes something they have to deal with: a site or setting from an earlier version that no longer works the way it did, a flow they have to learn again, or a platform that is no longer supported. A **minor** release adds something without any of that, such as a new feature or a new kind of site. A **patch** release only fixes what an earlier release shipped.

## 1. Open the version-bump pull request

`electron-builder` names the artifacts after the version in `package.json`, so the version moves before anything is built.

1. Branch `release/X.Y.Z` from an up-to-date trunk. Check first that trunk matches `origin`, that nothing tracked has changed (untracked files are fine), and that the tag does not exist yet. The two `rev-parse` lines print the same commit, and the last two commands print nothing:

   ```bash
   git fetch origin trunk --tags
   git rev-parse trunk origin/trunk
   git status --porcelain --untracked-files=no
   git ls-remote --tags origin refs/tags/vX.Y.Z
   ```
2. Change the version in three places: `"version"` in `package.json`, and the two root `"version"` fields at the top of `package-lock.json` (the top-level one and `packages[""]`). No dependency version changes.
3. Check the two files agree:

   ```bash
   node -e "console.log(require('./package.json').version)"
   python3 -c "import json;d=json.load(open('package-lock.json'));print(d['version'], d['packages']['']['version'])"
   ```

4. Run `npm run i18n:download` and commit `src/languages/`. It writes a catalog for every locale at least 80% translated on translate.wordpress.org, removes every other catalog in `src/languages/` (an untracked one included), and prints a coverage table. Right-to-left locales are held back even at 80%, and the output lists them after the table under `Not shipped:`. When no locale reaches 80% and there is no catalog to remove, it prints `No locales downloaded.` instead of a table. If it exits with an error, nothing in `src/languages/` changed; run it again. Skipping this step ships the previous release's translations, or none, and nothing fails. See [Translatable strings](CONTRIBUTING.md#translatable-strings) in `CONTRIBUTING.md`.
5. Run `npm run lint` and `npm test`.
6. Open the pull request, titled `Bump version to X.Y.Z`, and paste the coverage table into its description, or the script's message if it printed no table. [#533](https://github.com/WordPress/contributor-toolkit/pull/533) is a good model. Outside `src/languages/`, the diff must be the three version lines, plus any change to `build.electronLanguages` in `package.json`, and nothing else:

   ```bash
   git diff trunk -- . ':!src/languages'
   ```

   `npm run i18n:download` rewrites `build.electronLanguages` whenever the Chromium locales the catalogs need change, and prints the resulting list as `Chromium locales kept`. Name the locales it added or removed in the pull request description.

## 2. Check the signed artifacts

Buildkite builds signed Windows, macOS and Linux artifacts for the pull request's branch. Before merging, open the build for the pull request's **current head commit** (`gh pr view <number> --json headRefOid --jq .headRefOid`), download the three files into one directory, and check them. Buildkite reports nothing back to the pull request (`.buildkite/pipeline.yml` asks for a commit status per platform, but none reached the 2.0.0 bump pull request), so the commit can only be read on the build's page in Buildkite: compare it with `headRefOid` there, by eye.

- The files are named `wordpress-contributor-toolkit-X.Y.Z-win-x64.exe`, `wordpress-contributor-toolkit-X.Y.Z-mac-arm64.dmg` and `wordpress-contributor-toolkit-X.Y.Z-linux-x86_64.AppImage`. The Windows file may download as `dist_wordpress-contributor-toolkit-X.Y.Z-win-x64.exe`, because the Windows build uploads it from `dist\`. Rename it to remove the `dist_` prefix, so its name matches the other two.
- The macOS app is signed with Automattic's Developer ID, notarized, and has its ticket stapled.
- The Windows installer carries an Authenticode signature from Automattic Inc.
- The app's `app.asar` root holds exactly `node_modules`, `package.json` and `src`, with npm 11 under `node_modules/npm` and no `.codesigning` directory.
- On macOS, `CFBundleShortVersionString` in the app's `Info.plist` reads `X.Y.Z`.

All but the name and Windows checks run on the macOS artifact, on a Mac, from the repository root (so `@electron/asar` resolves from `node_modules`). Replace `<dir>` with the directory holding the downloads:

```bash
mnt="$(mktemp -d)"
hdiutil attach -nobrowse -readonly -mountpoint "$mnt" "<dir>/wordpress-contributor-toolkit-X.Y.Z-mac-arm64.dmg"
app="$mnt/WordPress Contributor Toolkit.app"
codesign --verify --deep --strict "$app" && echo signed
spctl -a -vv -t exec "$app"
xcrun stapler validate "$app"
npx asar list "$app/Contents/Resources/app.asar" | grep -E '^/[^/]+$'
node -p "JSON.parse(require('@electron/asar').extractFile(process.argv[1], 'node_modules/npm/package.json')).version" "$app/Contents/Resources/app.asar"
plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist"
hdiutil detach "$mnt" && rmdir "$mnt"
```

`codesign` prints `signed`. `spctl` prints `accepted`, `source=Notarized Developer ID` and an `origin` naming `Automattic, Inc.`. `stapler` prints `The validate action worked!`. The `asar list` command prints `/node_modules`, `/package.json` and `/src`, and nothing else. The `node` command prints a version starting with `11.`. `plutil` prints `X.Y.Z`.

Read the npm version with `extractFile` as above, in memory. `npx asar extract-file` writes the file into the current directory, which from the repository root replaces its own `package.json`.

The Windows signature can be checked on Windows, with `Get-AuthenticodeSignature <dir>\wordpress-contributor-toolkit-X.Y.Z-win-x64.exe` in PowerShell (`Status` is `Valid` and the signer names Automattic Inc.), or on a Mac with `openssl`, which reads the certificates out of the installer's signature:

```bash
node -e 'const fs=require("fs");const b=fs.readFileSync(process.argv[1]);const o=b.readUInt32LE(0x3c)+24;const d=o+(b.readUInt16LE(o)===0x20b?112:96)+32;const at=b.readUInt32LE(d),n=b.readUInt32LE(d+4);if(!n)throw new Error("not signed");process.stdout.write(b.subarray(at+8,at+n))' "<dir>/wordpress-contributor-toolkit-X.Y.Z-win-x64.exe" | openssl pkcs7 -inform DER -print_certs -noout | grep subject
```

It prints a `subject` line naming `O=Automattic Inc.`, and fails with `not signed` when the installer has no signature.

## 3. Merge

Check that the head you checked already contains trunk. The second command prints `up to date`; if it prints nothing, update the branch with trunk, wait for the new head's build, and download and check the artifacts again from it:

```bash
git fetch origin trunk "pull/<number>/head"
git merge-base --is-ancestor origin/trunk <head commit you checked> && echo up to date
```

The files from the build you checked last are what the release ships.

Then squash-merge, with the head you checked as a guard, so the merge is refused if anything was pushed after the check:

```bash
gh pr merge <number> --squash --match-head-commit <head commit you checked>
```

The merged commit has the same content as that build, and it is the one you tag. Find it with:

```bash
gh pr view <number> --json mergeCommit --jq .mergeCommit.oid
```

Check that it matches the build: after `git fetch origin trunk`, `git diff --stat <head commit you checked> <merged commit>` prints nothing. If it prints anything, trunk moved before the merge, and the artifacts are not the merged code. Do not tag yet: the release needs artifacts built from the merged commit. Buildkite builds every push to trunk, so open its trunk build for the merged commit, download its three files and repeat section 2 on them, comparing the build's commit with the merged commit instead of `headRefOid`. Tag only once they pass.

## 4. Publish the GitHub release

Write the notes first. They open with what changed for a contributor, grouped by theme, with the pull request number on each line, and end with a **Downloads** section naming the file for each platform. The [v1.2.0 notes](https://github.com/WordPress/contributor-toolkit/releases/tag/v1.2.0) are a good model for a stable release, and the previous beta's notes for a beta.

They cover everything since the previous stable release for a stable release, the betas' changes included, and since the previous tag of any kind for a beta. Find the base tag, and the commit count since it that the opening paragraph gives (it includes the bump commit):

```bash
git fetch origin trunk --tags
git describe --tags --abbrev=0 --exclude '*-*' <bump commit SHA>^   # stable; drop --exclude for a beta
git rev-list --count <base tag>..<bump commit SHA>
```

Then create the tag and the release together, on the bump commit. Every file is named by its path, so the command can run from anywhere:

```bash
gh release create vX.Y.Z \
  --target <bump commit SHA on trunk> \
  --title vX.Y.Z \
  --notes-file <path>/notes.md \
  <dir>/wordpress-contributor-toolkit-X.Y.Z-win-x64.exe \
  <dir>/wordpress-contributor-toolkit-X.Y.Z-mac-arm64.dmg \
  <dir>/wordpress-contributor-toolkit-X.Y.Z-linux-x86_64.AppImage
```

- **A beta** adds `--prerelease`, so `releases/latest` stays on the last stable release.
- **A stable release** adds `--latest`, so it takes `releases/latest`.

## 5. Deploy the docs

Skip this step for a beta. The docs site tracks the latest release, not trunk, and a beta does not take `releases/latest`, so its docs would describe UI the Download button's build does not have.

For a stable release, publish the docs for the new tag:

```bash
gh workflow run docs.yml --ref trunk -f ref=vX.Y.Z
```

The dispatch has to be on trunk; the `ref` input is the tag. A dispatch on any other branch finishes green without deploying, so check that the run's **deploy to Pages** job succeeded. A new run takes a few seconds to appear, so check that the run listed was created after the dispatch, not the previous release's:

```bash
gh run list --workflow docs.yml --event workflow_dispatch --branch trunk -L 1 --json databaseId,createdAt
gh run watch <run id> --exit-status
gh run view <run id> --json jobs --jq '.jobs[] | select(.name=="deploy to Pages") | .conclusion'
```

The last command prints `success`.

See [the documentation site](CONTRIBUTING.md#the-documentation-site) in `CONTRIBUTING.md`.

## 6. Close the milestone

If the release has a milestone named `vX.Y.Z`, close it and move anything still open in it to the next one. A beta often has none; close the beta's own milestone if it has one, and leave the stable release's milestone open until the stable release ships.

```bash
gh issue list --milestone vX.Y.Z --state open
gh pr list --search 'milestone:vX.Y.Z' --state open
gh api 'repos/WordPress/contributor-toolkit/milestones?state=open' --jq '.[] | "\(.number) \(.title)"'
gh api -X PATCH repos/WordPress/contributor-toolkit/milestones/<number> -f state=closed
```

The first two list the issues and pull requests still open, the third finds the milestone's number, and the fourth closes it.

## 7. Check the result

- `gh release view vX.Y.Z` lists the three files under the names from step 2, and shows the release as a pre-release only for a beta.
- `gh api repos/WordPress/contributor-toolkit/releases/latest --jq .tag_name` prints `vX.Y.Z` for a stable release, and the previous stable tag for a beta.
- `git ls-remote origin refs/tags/vX.Y.Z` points at the bump commit.
- For a stable release, the docs run from step 5 finished with its deploy job.
- The Download button on [the docs site](https://wordpress.github.io/contributor-toolkit/) reads `vX.Y.Z` for a stable release, and the previous stable tag for a beta. Open the site in a new tab or a private window: the button keeps the release it read in the tab's session storage (`docs/.vitepress/theme/DownloadButton.vue`), so a tab opened before the release goes on showing the old one, reloads included.
- The milestone, if the release has one, is closed.
