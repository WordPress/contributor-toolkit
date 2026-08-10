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

If a step fails, the error says what went wrong and the checkout was not changed.

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
