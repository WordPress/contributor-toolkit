## WordPress Contributor Toolkit (Electron)

The [WordPress Core Dev Environment Toolkit](https://github.com/WordPress/experimental-wp-dev-env) is a desktop electron application (available for macOS, Windows, and Linux) that sets up a full WordPress core development environment with zero prerequisites.

You install it, choose a directory for `wordpress-develop`, click a button, and you have:

- A cloned `wordpress-develop` repository
- A running WordPress dev server
- The ability to make code changes and generate a patch

No Git, no Node.js, no npm, no Docker needed. Everything is bundled inside the application as JS/WASM, powered by [WordPress Playground](https://wordpress.github.io/wordpress-playground/).

### Why

One of the most common complaints from Contributor Day facilitators is this: participants spend the entire session trying to set up their local environment and never get to actually contribute.

Before writing a single line of code, a first-time WordPress core contributor typically needs to install Git, Node.js, npm, Docker, configure everything correctly, and troubleshoot whatever breaks along the way. At in-person events, this alone can take hours — sometimes the full day.

The **WordPress Core Dev Environment Toolkit** aims to eliminate this friction entirely.

## What does it do?

Once installed, the app lets you:

- Clone `wordpress-develop` into a directory of your choice
- Run `npm install`, `npm run build`, and `npm run dev` automatically
- Start a WordPress dev server using Playground’s CLI
- Make changes to core files directly
- Generate a patch from your changes, ready to attach to a Trac ticket

The entire toolchain — npm, Node, Git — runs as JavaScript/WASM bundled with the app. There’s no terminal work required for the basic contributor workflow.

Here’s the full setup flow — from a fresh install to a running WordPress development environment:

[![](./docs/setup-start.png)](https://www.youtube.com/watch?v=e00PAh8WNOI)

[_Watch Video_](https://www.youtube.com/watch?v=e00PAh8WNOI)

Once your environment is running, generating a patch to submit to Trac takes just a few clicks:

[![](./docs/create-patch.png)](https://youtu.be/yodwdm7Z9vo?si=2Wk7Wuc6lTuaSeSf)

[_Watch Video_](https://youtu.be/yodwdm7Z9vo?si=2Wk7Wuc6lTuaSeSf)

## Getting started

### Just using the app

1. Download the latest packaged build for your platform from the [Releases page](https://github.com/WordPress/experimental-wp-dev-env/releases/latest). Pick the file that matches your OS:
    - **macOS:** `mac-release-*.dmg`
    - **Windows:** `windows-release-*.exe`
    - **Linux:** `linux-release-*.AppImage`
2. Open the app
3. **macOS only:** The app is signed and notarized by Automattic. macOS should open it without issues. If Gatekeeper still blocks the app (this can happen when the file was downloaded via a browser), try either of these:
    - Right-click the `.app` file and choose **Open**, then confirm in the dialog that appears.
    - Or remove the quarantine attribute from the `.app` bundle itself:
      ```
      xattr -d com.apple.quarantine "WordPress Contributor Toolkit.app"
      ```
      > **Note:** Use `-d`, **not** `-dr`. The app is code-signed; using the recursive flag (`-r`) tries to strip attributes from files inside the sealed bundle, which macOS will reject with permission errors. Removing the attribute from the top-level bundle is sufficient.
4. Click "Create WordPress Core site" and choose a destination folder for your site.
5. Click "Install dependencies"
6. Click "Run command > npm run build"
7. Click "Start dev server"
8. A browser window should open automatically. If not, you can manually open it by clicking "Launch site".
9.  Make changes in the code
10. Click "Generate patch" to create a diff of your changes.

### Build from source

Requirements: a recent Node.js to build the Electron app itself (runtime for the app is bundled).

```bash
npm install
npm run build:once   # bundle renderer
npm start            # run Electron + renderer in watch mode

# Package installers (no publishing):
npm run dist         # all configured targets
npm run dist:win     # Windows (x64 by default)
npm run dist:win:arm64
```

Output goes to `dist/` (e.g., Windows installer `.exe`).

### App icon

This app uses the official WordPress “W mark” as its icon.

- Source SVG: `build/wordpress-wmark.svg`
- Packaged icons: `build/icon.icns` (macOS), `build/icon.png` (Linux), `build/icon.ico` (Windows)

Electron Builder picks these up via `build` configuration in `package.json`.

## Technical notes

### How does it work?

* Git operations are handled by the `isomorphic-git` npm package. It is a pure JS implementation of Git that works in the browser and Node.js.
* Node scripts and npm commands are run using the Node.js runtime bundled with the Electron app. A small shim directory is injected into the PATH so subprocesses can find `node`, `npm`, and `npx` without requiring a system install.
* WordPress server is run using the `@wp-playground/cli` npm package from [WordPress Playground](https://w.org/playground/).
* Patches are generated using the `diff` npm package.

### Why Electron?

* WordPress core relies on Node.js, npm, and webpack for its build system. Electron is an easy way to install Node.js on all major platforms.
* It's a single, self-contained file. It's easy to distribute and install – it can be distributed on a USB sticks if everything else fails.

### Is SQLite enough for WordPress?

SQLite should suffice for most new contributors. The SQLite support is miles ahead of where it used to be (e.g. most plugins and core unit tests work, query monitor works, we track failures and missing features and, thanks to the query parser, we can improve things fairly easily).

For cases when MySQL is required, local Playground can work with MySQL. The only missing part is shipping the MySQL server with the app.

### Ideas and future work

- Integrate Playground's XDebug.
- Explore bundling MySQL server with the app.
- Built‑in SMTP catcher for local email testing.
- Migrate to the PHP Git client in https://github.com/wordpress/php-toolkit.
- Potentially integrate with Studio to benefit from PHP version selector, wp-cli integration and other Studio features.
- An ergonomic way of managing the git repository from the UI (commit, conflicts, pushes etc.) Or would it make sense to just endorse another git client?
- Integrate with Trac and GitHub to apply and submit patches directly. Related: [grunt-patch-wordpress](https://github.com/WordPress/grunt-patch-wordpress)

### License

GPLv2.


