# Getting started

The WordPress Contributor Toolkit is a desktop application for macOS (Apple Silicon), Windows, and Linux that sets up a full WordPress core development environment with zero prerequisites.

You install it, choose a directory for `wordpress-develop`, click a button, and you have:

- A cloned `wordpress-develop` repository
- A running WordPress dev server
- The ability to make code changes and turn them into a patch or pull request

No Git, no Node.js, no npm, no Docker needed. Everything is bundled inside the application as JavaScript/WASM, powered by [WordPress Playground](https://wordpress.github.io/wordpress-playground/).

## Install the app

<DownloadButton />

Download the latest build for your platform with the button above, then open the app.

### If macOS blocks the app

The app is signed and notarized by Automattic, so macOS should open it without issues. If Gatekeeper still blocks it (this can happen when the file was downloaded via a browser), try either of these:

- Right-click the `.app` file and choose **Open**, then confirm in the dialog that appears.
- Or remove the quarantine attribute from the `.app` bundle itself:

  ```sh
  xattr -d com.apple.quarantine "WordPress Contributor Toolkit.app"
  ```

  ::: warning Use `-d`, not `-dr`
  The app is code-signed. The recursive flag (`-r`) tries to strip attributes from files inside the sealed bundle, which macOS rejects with permission errors. Removing the attribute from the top-level bundle is sufficient.
  :::

## Your first contribution, in ten steps

1. Click **Create WordPress Core site** and choose a destination folder for your site.
2. Wait while the app downloads `wordpress-develop`.
3. Click **Install npm dependencies**.
4. Click **Run full build**.
5. Click **Start dev server**.
6. A browser window opens automatically. If not, open it by clicking the site URL.
7. Make changes to the code — [open the site in your editor](./editors) straight from the app.
8. Click **Review & submit changes** to see a diff of everything you changed.
9. Pick where the patch goes: [a pull request](./submit-github-pr), [a Trac ticket](./submit-trac), or [a file for your mentor](./submit-mentor).
10. That's it — you've contributed to WordPress core.

![A site ready for work: Start dev server, Review & submit changes, the Trac ticket panel and the patch panel](/screenshots/site-view.png)

The rest of this guide walks through each of these screens in detail, starting with [creating a site](./creating-a-site).

::: tip A second ticket does not need a second site
Every ticket you link gets its own branch inside the site and keeps its own work, so moving between two of them takes seconds instead of another clone and another install. See [Working on several tickets](./ticket-branches).
:::

::: tip You never need a new site to get newer code
**Update to latest trunk**, in the ☰ menu at the top right of any site, is available at any time on any site, however old: it fetches the latest trunk, reinstalls dependencies if they changed, and rebuilds. See [Staying up to date with trunk](./trunk-updates).
:::

## How it works under the hood

- Git operations are handled by `isomorphic-git`, a pure JavaScript implementation of Git.
- Node scripts and npm commands run on the Node.js runtime bundled with the Electron app. A small shim directory is injected into the `PATH` so subprocesses find `node`, `npm`, and `npx` without a system install.
- The WordPress server runs on `@wp-playground/cli` from [WordPress Playground](https://wordpress.github.io/wordpress-playground/), backed by SQLite.
- Patches are generated with the `diff` npm package.
