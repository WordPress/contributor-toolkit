# Managing sites

A site's page has its name and project tag in the header at the top, and its facts in the **Details** column on the right. Everything you do to the site as a whole is in the **Site actions** menu (⋮), at the right end of the header.

![A site's page with the Site actions menu open: Rename…, Copy path, Show in Finder, Update to latest trunk, Open in and Delete site](/screenshots/site-menu.png)

## The details

The **Details** column lists:

- **Setup**: **Initialized** once the site's dependencies are installed, and **Uninitialized** before that.
- **Created**: when the site was created.
- **Trunk as of**: the date of the site's copy of trunk. When it gets old, a coloured dot appears next to the site in the sidebar. See [Staying up to date with trunk](./trunk-updates).
- **Local path**: the site's folder, with a **Copy** button.
- **Checkout**: the project and the PHP version the server runs.
- **Debugging**: which debug settings are on. See [Settings](./settings).
Under them are the **Server** and **Build watch** sections; see [Running the site](./running-the-site). Last comes **Changed files**: the files your work and any applied patch or pull request change. See [Editors](./editors#changed-files).

## The Site actions menu

Open it with the ⋮ button at the right end of the header. It contains:

- **Rename…**: gives the site a different display name. This changes the name in the app only; the folder on disk keeps its name.
- **Copy path**: puts the site's folder path on the clipboard.
- **Show in Finder** (macOS) / **Show in Explorer** (Windows) / **Show in file manager** (Linux): shows the folder in your file manager.
- **Update to latest trunk**: fetches the latest trunk of the site's repository and rebuilds. Also reachable from the notice on an old site; on a site that is already current it prints "Already up to date." See [Staying up to date with trunk](./trunk-updates).
- **Open in**: opens the site's folder in an editor. See [Editors](./editors).
- **Delete site**: removes the site from the list **and deletes its folder from disk**. This cannot be undone. The app only deletes a folder it has on record as a site, never another path. It takes every ticket's or issue's work in the site with it; to throw away one work item and keep the rest, use its **Delete this … work** action instead. See [Deleting a work item's changes](./ticket-branches#deleting-a-work-item-s-changes).

**Delete site** asks for confirmation first.

## The menu on a site in the sidebar

Right-click a site in the sidebar to open the same **Site actions** menu for that site. You can also select the site with the keyboard and press Shift+F10 or the Menu key. The menu acts on the site you right-clicked, and the site that is open stays open. For example, **Copy path** copies the path of the site you right-clicked.

Press Escape or click outside the menu to close it.

## Updating with uncommitted changes

If you start **Update to latest trunk** while the site has edits loose in the working tree, the app does not silently throw them away. A dialog titled **Update to latest trunk?** lists every changed file and offers two choices:

- **Save them as a patch first (as a local file)** — writes a `.diff` to your machine, then updates. Nothing is sent anywhere.
- **Discard them** — your changes are lost; this cannot be undone.

Confirm with **Save patch & update** or **Discard & update**, or **Cancel** to keep everything as it is. If you meant to keep the changes as a contribution instead, see [Submitting your changes](./submitting-changes).

Work that is already parked on a ticket or issue branch is never what this dialog is offering to discard — the update carries it across untouched. See [Updating while you are on a work item](./trunk-updates#updating-while-you-are-on-a-work-item).

## Sites created by an earlier version

A site created before the app shipped its own Git shows a red banner at the top of its card: "This site was created by an earlier version of the app." The app now clones sites with the Git it bundles, and the shallow clones the old engine made cannot be written safely by it, so linking tickets, applying patches, discarding changes and updating trunk are refused on that site. Reading still works: the ticket panel and the patch export show what is there. The way out is the banner's **Create site** button: export your work as a patch, create a new site, apply the patch there, then delete the old site with **Delete site** in its **Site actions** menu.

The export covers the ticket that is currently linked. Work parked on another ticket's branch in that site cannot be reached without switching to it, and switching is one of the refused actions, so it stays in the old site's repository. A Git client can still read it there (`git log ticket/<number>`) if you need it back.
