# Releasing

How to cut a release of the WordPress Contributor Toolkit. Run every command from the repository root unless a step says otherwise.

Versions are `X.Y.Z` for a stable release and `X.Y.Z-beta.N` for a beta. Tags add a `v`: `v1.2.0`, `v1.2.0-beta.2`.

## 1. Open the version-bump pull request

`electron-builder` names the artifacts after the version in `package.json`, so the version moves before anything is built.

1. Branch from an up-to-date trunk.
2. Change the version in three places: `"version"` in `package.json`, and the two root `"version"` fields at the top of `package-lock.json` (the top-level one and `packages[""]`). No dependency version changes.
3. Check the two files agree:

   ```bash
   node -e "console.log(require('./package.json').version)"
   python3 -c "import json;d=json.load(open('package-lock.json'));print(d['version'], d['packages']['']['version'])"
   ```

4. Run `npm run i18n:download` and commit `src/languages/`. It writes a catalog for every locale at least 80% translated on translate.wordpress.org, removes every other catalog in `src/languages/` (an untracked one included), and prints a coverage table. Right-to-left locales are held back even at 80%, and the output lists them after the table under `Not shipped:`. When no locale reaches 80% and there is no catalog to remove, it prints `No locales downloaded.` instead of a table. If it exits with an error, nothing in `src/languages/` changed; run it again. Skipping this step ships the previous release's translations, or none, and nothing fails. See [Translatable strings](CONTRIBUTING.md#translatable-strings) in `CONTRIBUTING.md`.
5. Run `npm run lint` and `npm test`.
6. Open the pull request, titled `Bump version to X.Y.Z`, and paste the coverage table into its description, or the script's message if it printed no table. [#533](https://github.com/WordPress/contributor-toolkit/pull/533) is a good model. `git diff trunk` must show exactly three changed lines outside `src/languages/`.

## 2. Check the signed artifacts

Buildkite builds signed Windows, macOS and Linux artifacts for the pull request's branch. Before merging, open the build for the pull request's **current head commit** and check:

- The files are named `wordpress-contributor-toolkit-X.Y.Z-win-x64.exe`, `wordpress-contributor-toolkit-X.Y.Z-mac-arm64.dmg` and `wordpress-contributor-toolkit-X.Y.Z-linux-x86_64.AppImage`.
- The app's `app.asar` root holds exactly `node_modules`, `package.json` and `src`, with npm 11 under `node_modules/npm` and no `.codesigning` directory.
- On macOS, `CFBundleShortVersionString` in the app's `Info.plist` reads `X.Y.Z`.

## 3. Merge

Update the branch with trunk first if it has fallen behind, and check the artifacts again on the new head. Download the three files from the build you checked last. They are what the release ships.

Then squash-merge. The merged commit has the same content as that build, and it is the one you tag.

## 4. Publish the GitHub release

Create the tag and the release together, on the bump commit:

```bash
gh release create vX.Y.Z \
  --target <bump commit SHA on trunk> \
  --title vX.Y.Z \
  --notes-file notes.md \
  wordpress-contributor-toolkit-X.Y.Z-win-x64.exe \
  wordpress-contributor-toolkit-X.Y.Z-mac-arm64.dmg \
  wordpress-contributor-toolkit-X.Y.Z-linux-x86_64.AppImage
```

- **A beta** adds `--prerelease`, so `releases/latest` stays on the last stable release.
- **A stable release** takes `releases/latest`.

The notes open with what changed for a contributor, grouped by theme, with the pull request number on each line, and end with a **Downloads** section naming the file for each platform. The [v1.2.0 notes](https://github.com/WordPress/contributor-toolkit/releases/tag/v1.2.0) are a good model.

## 5. Deploy the docs

The docs site tracks the latest release, not trunk, so publish it for the new tag:

```bash
gh workflow run docs.yml --ref trunk -f ref=vX.Y.Z
```

The dispatch has to be on trunk; the `ref` input is the tag. See [the documentation site](CONTRIBUTING.md#the-documentation-site) in `CONTRIBUTING.md`.

## 6. Close the milestone

If the release has a milestone, close it and move anything still open in it to the next one. A beta often has none: leave the stable release's milestone open until the stable release ships.
