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

## "A previous switch … did not finish"

A ticket switch whose file swap died part-way leaves the checkout half of one ticket and half of
the other, so the app refuses further ticket actions rather than committing the mixture:
**A previous switch from … to … did not finish. Retry it before making other changes.**

The refusal covers switching too, so the way out is **Unlink** on the **Trac ticket** panel — the
one action it still allows. That puts the site back on trunk, and you can link the ticket you
wanted from there. Nothing is lost: the work on the ticket you were leaving was committed to its
branch before any file moved. See [Working on several tickets](./ticket-branches).

The usual cause is a file held open by an editor or an antivirus scanner during the swap. Closing
whatever had the checkout open before retrying makes a repeat less likely.

## A patch or pull request will not apply

An apply is all-or-nothing: if any part fails, the checkout is unchanged. The panel names how many
changes failed and which files they are in.

For a pull request, check whether the notice names work already on your ticket:

- If it does, save a patch of your work and try the pull request on a clean ticket. The app knows
  that both sets of work touch the file, but it cannot prove which exact lines caused the failure.
  Ask the pull request's author for an update only if it still fails on the clean ticket.
- If it does not, the pull request was written against an older trunk. Open it and let its author
  know that it needs a rebase or trunk merged in.

For a patch file or Trac attachment, there is no author the app can send you to. Expand the failing
files in the panel: each region gives a line from your checkout to search for and says whether the
surrounding code changed or the change appears to be present already. See
[Applying patches and PRs](./applying-patches#when-a-patch-will-not-apply).

## Work seems to have vanished after changing tickets or updating trunk

Ticket work belongs to its ticket branch, not to the whole site. If the files look clean after you
click **Unlink** or switch tickets, return to the original ticket under **Your tickets on this
site**. Its edits and its applied patch return with it.

A trunk update also leaves ticket branches on the trunk snapshot where they started. When you run
one while a ticket is linked, the app parks the ticket, updates trunk, and checks the same ticket
back out. If its work is missing after the update rather than merely hidden on another ticket, stop
editing and report a problem with the app; an update must not discard it. See
[Keeping a site up to date with trunk](./trunk-updates#updating-while-you-are-on-a-ticket).

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
