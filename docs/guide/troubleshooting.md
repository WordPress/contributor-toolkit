# Troubleshooting

## macOS blocks the app from opening

The app is signed and notarized, but Gatekeeper can still block a freshly downloaded copy.
Right-click the app and choose **Open**, or remove the quarantine attribute — the exact steps,
including the `xattr` command and its one pitfall, are in
[Getting started](./getting-started#if-macos-blocks-the-app).

## "Update incomplete" after a trunk update

If a [trunk update](./trunk-updates) fetches new code but the install or build step fails, the
site shows a red **Update incomplete** notice: the code is new but the built assets are old, and
the site may not run correctly until install and build succeed. Click **Retry install & build**
in the notice. If it fails again, the reason is in the [Terminal](./terminal) output — a network
drop during `npm install` is the most common cause.

## The dev server won't start

Starting the server can legitimately take a while — booting WASM PHP on a slow machine can take
tens of seconds. The app waits up to 120 seconds; after that it gives up and reports the failure
instead of hanging.

If the start fails:

1. Open the **Server** tab under **Logs** — the server's own output usually names the problem.
2. If the server exited before reporting a URL, the error message includes its exit code.
3. Make sure the site has actually been [built](./setup-wizard); a site whose build was
   interrupted shows the **Update incomplete** notice described above.
4. Stop and start the server once more — a previous instance that did not shut down cleanly can
   hold on to resources until it is killed.

## Where the logs live

Two different logs, two different problems:

- **The site's PHP log** — the **debug.log** tab in the site view. PHP notices, warnings, and
  fatals from WordPress and your code. See [Logs and debugging](./logs-and-debugging).
- **The app's own log** — menu **Help → Open App Log**, or **Help → Show Logs Folder** to reveal
  the directory. Server starts, installs, git operations, and app errors. When reporting a bug in
  the app, attach this file.

## Reporting a problem

The **Share feedback** button at the top of the sidebar opens a short form. Responses go into a
shared form the team reviews regularly, and submissions are anonymous unless you add your email.
For bugs, the [GitHub issue tracker](https://github.com/WordPress/contributor-toolkit/issues)
works too — include the app log and, for site problems, the debug.log contents (the **Copy**
button under the pane exists for exactly this).
