# Applying patches and PRs

The **Apply a patch or PR** panel applies a pull request or a `.diff`/`.patch` file to your site's checkout and rebuilds, so you can test someone else's work before adding your own. Your own changes are left alone.

![The Apply a patch or PR panel, with a field for a pull request URL and a link to choose a patch file](/screenshots/apply-patch-panel.png)

## Choose what to apply

There are three ways to get a patch into the panel:

- Paste a pull request URL or number into the field and click **Apply PR**.
- Click **or choose a .diff / .patch file…** and pick a file from disk.
- Click **Apply…** next to a pull request or attachment in the [Trac ticket panel](trac-tickets).

## The preview

Nothing is changed yet. The panel first shows what the patch would do:

- The list of files it changes.
- A warning if you have your own edits to any of those files. The patch is applied on top of them: it succeeds if the changes do not overlap, and fails without touching anything if they do. Save a patch of your work first if you want a copy — see [Submitting your changes](submitting-changes).
- Which files are binary and will be skipped.
- Whether it changes `package-lock.json`, in which case dependencies will be installed before the rebuild.

Click **Apply and rebuild** to go ahead, or **Cancel** to back out.

## Apply and rebuild

The panel shows each step as it runs: applying the patch, installing dependencies if needed, and rebuilding. When it finishes, the panel reports what is applied — the patch's name, how many files it changed, and when.

If the [build watch](running-the-site#the-build-watch) is running and the patch only touches `src/`, there is no build step: the patch is applied and left for the watch to compile, and the checklist says so. A patch that moves `package-lock.json` or needs a full build pauses the watch for the duration and resumes it after — the dev server stays up throughout.

## When a patch will not apply

The apply is all-or-nothing. If anything fails, nothing is written to your checkout — but the panel now tells you *how much* failed, because one region of twenty missing and all twenty missing are opposite decisions for you.

The headline is a count, not an adjective: *4 of this patch's 20 changes across 3 files no longer fit — the other 16 do.* When every change is already in your checkout — which is what a patch that has since been committed to core looks like — it says that instead, rather than reporting the patch as dead.

### For a patch file or a Trac attachment

You get the full breakdown, because you are the only one who can rescue it. Each file lists its failing regions, and each region says **why**:

- **the code around it has changed** — the patch was written against an older trunk and the lines it expected have moved.
- **looks like it is already in your checkout** — that change is present. The app tells the two apart by testing whether the region's reverse fits.

Each region shows the lines it wanted to add and remove, and — more usefully — an **anchor line taken from your own file** to search for. A hunk's line numbers are coordinates in the file as its author had it, so on an old patch they miss by exactly the drift that made it fail; a line you can search for does not.

### For a pull request

The regions belong to whoever updates the pull request, and that is its author, not you. So the notice names the situation and its scale — *this pull request was written against an older trunk and no longer fits it: 4 of its 20 changes, in 3 files, would need rework* — without the line-level detail, and points at the one act that is genuinely yours: telling the author. Leaving a comment asking for a rebase is a real contribution.

A **closed** pull request is read differently, because on `wordpress-develop` "closed" is also what landing looks like — core commits go through SVN and the pull request is closed, never merged. If all its changes read back as already in trunk, the panel says it was likely committed to core and there is nothing left to apply. Otherwise it says nobody is coming back to update it, and offers **See why it was closed**.

### The way out

When the ticket has other patches on it — another pull request, another attachment — the panel offers them. It only does so when there is genuinely one to try: a way out that lands you back at the same dead end costs a click to discover.

## Applied patches belong to a ticket

What is applied is recorded against the ticket you are on, not against the site. Switch to another ticket and the green "applied" box goes with the first one; switch back and it is there again, describing the patch you actually applied on that ticket. See [Working on several tickets](ticket-branches).

## Reverting an applied patch

While a patch is applied, the panel shows it in a green box with a **Revert this patch** button. Reverting removes the patch's changes and rebuilds, again leaving your own edits alone.

Very large patches cannot be undone automatically. The panel says so; use **Update to latest trunk** to reset the checkout instead — see [Staying up to date with trunk](trunk-updates).

That escape hatch only resets a site sitting on trunk. On a ticket, an update parks your branch before it resets trunk and checks the branch back out afterwards — applied patch and all — so it leaves you where you were. On a ticket, the way to be rid of both the patch and the work under it is [deleting that ticket's work](ticket-branches).

## Your own changes

Applying and reverting patches never discards your own edits. The only risk is overlap: if a patch touches the same lines you changed, the apply fails cleanly rather than mixing the two. The preview names the files where you both have changes, so you see this before pressing anything.

## Next steps

- [Link the ticket you are testing](trac-tickets)
- [Submit your own changes](submitting-changes)
