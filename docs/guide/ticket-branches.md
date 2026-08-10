# Working on several tickets

You do not need a second site to work on a second ticket.

A site is the expensive part: a clone of `wordpress-develop`, an `npm install`, and a first build — minutes of work, and the thing this app exists to spare you. A ticket is the cheap part. Each ticket you link gets its own branch inside the site, so moving between them is a file swap that takes seconds, with no reinstall and no rebuild.

Each ticket keeps its own work. What you edited for one ticket is not in the tree while you are on another, and the patch you submit for a ticket contains only that ticket's changes.

![A site with two tickets: the Trac ticket card for the one in hand, and an Other tickets on this site card under it](/screenshots/site-with-tickets.png)

## Starting a second ticket

Link it the same way you linked the first: type the number into the **Trac ticket** panel and click **Link ticket**. The app parks what you have on the current ticket, creates a branch for the new one, and swaps the files.

Nothing is installed and nothing is rebuilt. `node_modules`, the `build/` directory, the dev server and the database belong to the site, and all of them stay exactly as they are.

## Your tickets on this site

The site's tickets get their own card, between the **Trac ticket** card and **Apply a patch or PR**. It appears once the site has work on a ticket other than the one you are on; a site with only one ticket does not get an empty card.

With a ticket linked, the card is headed **Other tickets on this site**, and each row offers to **switch**:

![The Other tickets on this site card: "You also have work on #61002 — switch", with "Delete this ticket's work" beside it](/screenshots/ticket-list-card.png)

With no ticket linked, the same card is headed **Your tickets on this site**, and each row is a **Continue working on #NNNNN** link. This is how you come back to a ticket without having to remember its number:

![The Your tickets on this site card, listing two tickets to continue working on, most recently used first](/screenshots/ticket-list-unlinked.png)

Rows are listed most recently used first, with **edited 2 days ago** underneath — and after a week, the date itself. Every control on the card is disabled while an install, a build or a [trunk update](./trunk-updates) is running, because all three are writing to the same working directory a switch would swap.

## What a switch says while it runs

A switch is a scan of the working tree followed by a checkout. On a real `wordpress-develop` that is seconds, not minutes, but it is long enough that a silent window looks like a hung one — so the panel narrates it, under a spinner:

- **Saving your work on #59234…** — the ticket you are leaving is being committed to its branch. This is the part worth waiting out: it is the stretch where your edits are written down.
- **Checking which files change…**
- **Swapping files for #61002… 63%**
- **Ready to work on #61002**

Do not force-quit during a switch. Quitting part-way through the file swap leaves the checkout half of one ticket and half of the other. The app notices — the next ticket action is refused with *A previous switch from … to … did not finish. Retry it before making other changes* — and the way out is to retry the same switch, which finishes the swap. Your work on the ticket you were leaving is safe either way: it was committed to its branch before any file moved.

## Deleting a ticket's work

**Delete this ticket's work**, on each row, throws that ticket's branch away — every change you made for it, whether or not you ever submitted it. It asks first: *Delete all work on #61002 on this site? This cannot be undone.* There is no undo afterwards.

It is deliberately a different gesture from switching, and from unlinking. **Unlink** on the **Trac ticket** panel only puts the site back on trunk: the ticket's work stays on its branch, and the ticket reappears under **Your tickets on this site**, ready to continue.

## Edits you made before picking a ticket

If you started editing before you linked a ticket, those edits are on trunk, which the app never commits to. So when you link a ticket, it stops and asks what should happen to them:

![The question panel: "You have 1 uncommitted change on this site, not on any ticket yet. What should happen to them?" with four choices](/screenshots/trunk-work-question.png)

- **Take these edits into #NNNNN** — the edits come along and become part of that ticket's work. This is the answer for *I started editing, then realised which ticket this is*.
- **Save them as a patch, then start clean…** — the app asks where to save a `.diff`, then discards the edits and links the ticket. Cancelling the save dialog cancels the whole option and leaves everything as it was.
- **Discard them and start clean** — the edits are lost; this cannot be undone, and it asks again before doing it.
- **Cancel** — nothing happens. No branch is created and no ticket is linked.

**Take these edits into #NNNNN** is offered only for a ticket this site has not worked on yet. A ticket that already has a branch has its own work waiting to be restored, so loose edits cannot ride into it; the panel says so, and the other three choices stay.

When the edits do come along, the panel says where they went: *Your 1 uncommitted change came along into #62281, and will go into its patch.*

![The Trac ticket card after the carry, with a blue notice confirming the edits came along into the ticket](/screenshots/carried-work-notice.png)

If you saved them instead, the confirmation names the file — *Your edits were saved to … and are no longer in the working tree* — and stays on screen after the switch, so the path does not vanish with the panel that offered it.

Linking a ticket from a clean tree asks nothing and shows nothing. There is a standing line under the **Link ticket** field to say the question exists: *If you have edited anything already, you will be asked what should happen to those edits.*

## Unsubmitted work for the ticket you are on

Once a ticket has changes that have not been submitted anywhere, the **Trac ticket** card says so:

> You have 1 unsubmitted change for ticket #29798. You can **review and submit** or **discard your changes**.

This counts the ticket's whole work — including everything parked when you last switched away, which is most of it if you move between tickets. It is measured the same way the patch is, so the note and [the diff](./submitting-changes) never disagree: if the note says two changes, the patch has two files.

Under it is the reassurance that matters here: unlinking the ticket does not touch those changes. They stay attached to the ticket in this site, ready for when you link it again.

## What a patch contains

A patch is everything on the ticket's branch since the point it was created — only that ticket's work, never another's, and never a change that arrived from a trunk update.

That last point has a consequence worth knowing. A ticket branch keeps the snapshot of trunk it was born on, even after you [update the site to the latest trunk](./trunk-updates). The patch stays correct against that snapshot, which is what keeps it free of upstream changes you did not write — but a branch you started weeks ago produces a patch that may no longer apply to today's trunk.

The app has no way to replay an old ticket branch onto a newer trunk. Doing it by hand means saving the ticket's patch, deleting the ticket's work, linking the ticket again so a branch is created on the current trunk, and [applying the saved patch](./applying-patches) to it.

## Next steps

- [Working on a Trac ticket](./trac-tickets)
- [Submitting your changes](./submitting-changes)
- [Staying up to date with trunk](./trunk-updates)
