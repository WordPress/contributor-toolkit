# Troubleshooting

## macOS blocks the app from opening

The app is signed and notarized by Automattic, so macOS should open it without issues. If Gatekeeper still blocks it (this can happen when the file was downloaded via a browser), try either of these:

- Right-click the `.app` file and choose **Open**, then confirm in the dialog that appears.
- Or remove the quarantine attribute from the `.app` bundle itself:

  ```sh
  xattr -d com.apple.quarantine "WordPress Contributor Toolkit.app"
  ```

  ::: warning Use `-d`, not `-dr`
  The app is code-signed. The recursive flag (`-r`) tries to strip attributes from files inside the sealed bundle, which macOS rejects with permission errors. Removing the attribute from the top-level bundle is sufficient.
  :::

## "Update incomplete" after a trunk update

If a [trunk update](./trunk-updates) fetches new code but the install or build step fails, the site shows a red **Update incomplete** notice: the code is new but the built assets are old, and the site may not run correctly until install and build succeed. Click **Retry install & build** in the notice. If it fails again, the reason is in the [Terminal](./terminal) output — a network drop during `npm install` is the most common cause.

![The Update incomplete notice with its Retry install and build button](/screenshots/update-incomplete.png)

## "A previous switch … did not finish"

A work-item switch whose file swap died part-way leaves the checkout half of one ticket or issue and half of the other, so the app refuses further switching actions rather than committing the mixture: **A previous switch from … to … did not finish. Retry it before making other changes.**

The refusal covers switching too, so the way out is **Unlink** on the **Trac ticket** or **GitHub issue** panel — the one action it still allows. That puts the site back on trunk, and you can link the work item you wanted from there. Nothing is lost: the changes on the item you were leaving were committed to its branch before any file moved. See [Working on several work items](./ticket-branches).

The usual cause is a file held open by an editor or an antivirus scanner during the swap. Closing whatever had the checkout open before retrying makes a repeat less likely.

## A patch file will not apply

An apply is all-or-nothing: if any part fails, the checkout is unchanged. The panel names how many changes failed and which files they are in.

For a patch file or Trac attachment, expand the failing files in the panel: each region gives a line from your checkout to search for and says whether the surrounding code changed or the change appears to be present already. See [Applying patches and PRs](./applying-patches#when-a-patch-will-not-apply).

## "I cannot submit: PR #NNNN is checked out"

The app blocks submission from a PR checkout so the PR author's commits cannot be presented as your own work. Use **Revert this PR** in the highlighted context at the top of the Trac ticket or GitHub issue card. Your edits on the PR are parked on its local `pr/NNNN` branch and return if you check it out again.

## Work seems to have vanished after changing work items or updating trunk

Linked work belongs to its ticket or issue branch, not to the whole site. If the files look clean after you click **Unlink** or switch items, return to the original one under **Your tickets on this site** or **Your issues on this site**. Its edits and applied work return with it.

A trunk update also leaves work-item branches on the trunk snapshot where they started. When you run one while a ticket or issue is linked, the app parks that branch, updates trunk, and checks the same branch back out. If its work is missing after the update rather than merely hidden on another item, stop editing and report a problem with the app; an update must not discard it. See [Updating while you are on a work item](./trunk-updates#updating-while-you-are-on-a-work-item).

## The dev server won't start

Starting the server can legitimately take a while — booting WASM PHP on a slow machine can take tens of seconds. The app waits up to 120 seconds; after that it gives up and reports the failure instead of hanging.

If the start fails:

1. Open the **Server** tab under **Logs** — the server's own output usually names the problem.
2. If the server exited before reporting a URL, the error message includes its exit code.
3. Make sure the site has actually been [built](./setup-wizard); a site whose build was interrupted shows the **Update incomplete** notice described above.
4. Stop and start the server once more — a previous instance that did not shut down cleanly can hold on to resources until it is killed.

## Where the logs live

Two different logs, two different problems:

- **The site's PHP log** — the **debug.log** tab in the site view. PHP notices, warnings, and fatals from WordPress and your code. See [Logs and debugging](./logs-and-debugging).
- **The app's own log** — menu **Help → Open App Log**, or **Help → Show Logs Folder** to reveal the directory. Server starts, installs, git operations, and app errors. When reporting a bug in the app, attach this file.

## Reporting a problem

The **Share feedback** button at the top of the sidebar opens a short form. Responses go into a shared form the team reviews regularly, and submissions are anonymous unless you add your email. For bugs, the [GitHub issue tracker](https://github.com/WordPress/contributor-toolkit/issues) works too — include the app log and, for site problems, the debug.log contents (the **Copy** button under the pane exists for exactly this).
