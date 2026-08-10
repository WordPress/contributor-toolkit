# Keeping a site up to date with trunk

A site is a clone of `wordpress-develop` frozen at the moment it was created, so it starts drifting behind trunk immediately. You never have to create a new site to get newer code.

The header of each site shows which snapshot it currently holds — for example `trunk as of 5 Aug 2026`.

## Update to latest trunk

**Update to latest trunk** lives in the ☰ **More** menu at the top right of any site. It brings an existing site up to the current trunk: it fetches the newest commits, reinstalls dependencies if `package-lock.json` moved, and rebuilds.

![The More menu with Update to latest trunk](/screenshots/site-menu.png)

This option is always there — on every site, at any time, no matter how old or new the snapshot is and whether or not the app has flagged it as stale. If nothing has moved, you simply get "Already up to date." in the terminal.

Stop the dev server first. The **Update to latest trunk** button in the staleness notice is
disabled while the server, an install, or a build is running — but the ☰ menu entry is not, and
clicking it in that state simply does nothing, with no message to say why.

## What an update runs

The update always shows the same three steps in a progress card, with a "step N of 3" counter:

1. **Fetch and reset to trunk** — pull the newest commits and reset the checkout to them. If you
   have uncommitted changes the app stops and asks first, offering **Save them as a patch first
   (as a local file)** or **Discard them** — the second loses the work and cannot be undone. When
   you choose to save, the summary afterwards tells you where the patch went.
2. **Install dependencies** — runs only if `package-lock.json` changed between the old and new trunk; otherwise the step is shown as "Dependencies unchanged — skipping npm install". When it does run, most packages are already cached, so it downloads the difference, not the whole tree.
3. **Rebuild** — rebuild the `build/` directory so it matches the new source.

When the chain finishes, a green summary reads **Up to date with trunk as of today.**, along with whether dependencies changed, how long the rebuild took, and the path of any saved patch. Updating typically takes a few minutes.

## Staleness dots and notices

The app flags sites that have fallen behind with a coloured dot next to the site name in the sidebar:

- **Amber** — the snapshot is more than 14 days old. The site view also shows a notice — "This site's WordPress code is N days old" — warning that patches you create now may not apply on Trac, with an **Update to latest trunk** button.
- **Red** — a previous update moved the code but never finished installing or rebuilding, so the built assets no longer match the source. Run the update again.

![The stale-site notice with its Update to latest trunk button](/screenshots/stale-site-notice.png)

## When an update does not finish

If the fetch succeeds but install or build fails, the site view shows a red banner: **Update incomplete** — the code is new but the built assets are old, and the site may not run correctly until install and build succeed. Click **Retry install & build** to run only the missing steps; the fetch is not repeated. The sidebar dot stays red until this succeeds.

## Staleness is judged locally

Staleness is judged locally, from the date of the commit your site is sitting on, and never by asking GitHub what the tip of trunk is. That keeps the app working offline and stops it from making a network request every time it launches. Two consequences worth knowing:

- A site created today is never marked out of date, even though trunk gets commits several times a day and yours is already behind by a few. Flagging that would mark every site stale within hours of creation, which makes the warning worthless.
- The only way to find out exactly how far behind you are is to run the update.
