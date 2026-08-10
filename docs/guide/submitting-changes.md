# Submitting your changes

When your change works and you want to contribute it, open the **Submit changes** screen. It shows your work as a patch and, next to it, the places that patch can go.

## Your changes

The left side of the screen is the diff, titled **Your changes** — everything this site has that its copy of trunk does not. This is exactly what will be submitted, so read it before choosing a destination.

Two buttons sit above the diff:

- **Save** — saves the diff as a patch file wherever you choose.
- **Copy** — copies the whole diff to the clipboard.

If the site has no changes against its copy of trunk, the screen says there is nothing to send yet. If the site's WordPress code is old, a warning says the patch may not apply on Trac and suggests updating to the latest trunk first — see [Staying up to date with trunk](trunk-updates).

## Where this patch goes

The right side lists three destinations. The pull request is the one the app sends for you; the other two save a file for you to send. Each card states what it costs to use and what happens afterwards, so you can choose with the trade-offs in front of you.

- **Open a pull request** — needs a GitHub account. The app forks `wordpress-develop` to your account, pushes your change to a branch, and opens the pull request. Automated checks run on it. [Opening a pull request](submit-github-pr)
- **Attach to Trac** — needs a WordPress.org account, which you need anyway for props and to comment. The app saves the patch file and opens the ticket's attach page; you upload it yourself. No automated checks run. [Attaching a patch to Trac](submit-trac)
- **Hand it to a mentor** — needs no accounts at all. The app saves a patch file carrying your WordPress.org username and the event you are at; someone else pushes it, and the props still land on you. [Handing a patch to a mentor](submit-mentor)

## Your WordPress.org username and event

The mentor destination asks for your WordPress.org username and, optionally, the event you are contributing from (for example a WordCamp contributor day). Both are asked once and remembered for every site — they are facts about you, not about one checkout.

The username and event are embedded in the patch file itself, as comment lines at the top, along with the ticket, the trunk revision the patch is based on, and the date. A filename survives until someone renames the download; the header survives with the file. This is what lets a mentor upload your patch with your name on the work.

The event is shown on every save — **The patch will say it was written at …** — so a remembered event from last year cannot keep stamping patches unnoticed. Click **Change these** to update either value, or clear them.

## Next steps

- [Opening a pull request](submit-github-pr)
- [Attaching a patch to Trac](submit-trac)
- [Handing a patch to a mentor](submit-mentor)
