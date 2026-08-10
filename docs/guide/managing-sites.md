# Managing sites

Everything about a site's identity and lifecycle lives in its header: the name, a few status
badges, the path, and the **More** menu (☰) at the top right.

![The site header with the More menu open](/screenshots/site-menu.png)

## The site header

- **Rename** — click the pencil icon next to the site title to give the site a different display
  name. This changes the label in the app only; the directory on disk keeps its name.
- **Status badge** — **INITIALIZED** once the repository is cloned; **UNINITIALIZED** before
  that.
- **Created date** — when the site was created.
- **Trunk age** — how old the site's snapshot of `wordpress-develop` trunk is. When the snapshot
  gets stale, an amber dot appears next to the label; hover it to see the age in days. See
  [Staying up to date with trunk](./trunk-updates).
- **Path** — the site's directory, with a copy button next to it. The **Open directory in** menu
  underneath opens it in your file manager or an editor; see [Editors](./editors).

## The More menu

The ☰ menu at the top right of the site view contains:

- **Copy path** — puts the site's directory path on the clipboard.
- **Show in Finder** (macOS) / **Show in Explorer** (Windows) — reveals the directory in
  your file manager.
- **Update to latest trunk** — fetches the latest `wordpress-develop` trunk and rebuilds. Also
  reachable from the staleness notice; on an already-fresh site it just prints "Already up to
  date." See [Staying up to date with trunk](./trunk-updates).
- **Forget this site** — removes the site from the app's list. The directory and everything in
  it stay on disk; you can add the folder back later.
- **Delete this site** — removes the site from the list **and deletes its directory from disk**.
  This cannot be undone. The app will only ever delete a directory it has on record as a site —
  never an arbitrary path.

Both **Forget** and **Delete** ask for confirmation first. If you are unsure which you want:
forget is reversible, delete is not.

## Updating with uncommitted changes

If you start **Update to latest trunk** while the site has local edits, the app does not silently
throw them away. A dialog titled **Update to latest trunk?** lists every changed file and offers
two choices:

- **Save them as a patch first (as a local file)** — writes a `.diff` to your machine, then
  updates. Nothing is sent to Trac.
- **Discard them** — your changes are lost; this cannot be undone.

Confirm with **Save patch & update** or **Discard & update**, or **Cancel** to keep everything as
it is. If you meant to keep the changes as a contribution instead, see
[Submitting your changes](./submitting-changes).
