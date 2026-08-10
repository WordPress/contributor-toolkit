# Working on a Trac ticket

Every WordPress core change starts life on a [Trac](https://core.trac.wordpress.org/) ticket. The **Trac ticket** panel on the site view links your site to the ticket you are working on, and then shows you the work that already exists on it — pull requests on GitHub and patch files attached on Trac — so you can test it before adding your own.

![The Trac ticket panel, showing a linked ticket with its linked pull requests and Trac attachments](/screenshots/trac-ticket-panel.png)

## Link a ticket

1. Type the ticket number or paste its full URL (for example `62281` or `https://core.trac.wordpress.org/ticket/62281`) into the field.
2. Click **Link ticket**.

The ticket is stored with the site, so it survives restarts. You can change or remove it at any time.

If you do not have a ticket yet, click **Not sure yet? Browse good first bugs on Trac** to open Trac's curated ticket lists in your browser.

Once a ticket is linked, the panel shows its number with two actions:

- **Open in Trac** — opens the ticket in your browser.
- **Unlink** — removes the link. Nothing on Trac is affected; only the app forgets the association.

## Linked pull requests

The panel searches GitHub for pull requests on `WordPress/wordpress-develop` that cite the ticket number, and lists them newest first. Each row shows the PR number (click it to open the PR in your browser), its title, whether it is open or closed, and when it was last updated. Click **Refresh** to search again.

Each pull request has an **Apply…** button, which fetches its diff and shows you a preview before anything is changed — see [Applying patches and PRs](applying-patches).

The search uses GitHub's unauthenticated API, which allows 60 requests per hour from your machine. If the limit is spent or you are offline, the panel says so and falls back to the last list it saw, noting when that was.

## Trac attachments

On many tickets — good first bugs especially — the existing work is a `.diff` file attached on Trac rather than a pull request. Click **Show Trac attachments** to list them.

Trac answers non-browser clients with a proof-of-work interstitial, so the app cannot simply download the list. Instead it opens the ticket in a real browser window, where the check runs — usually automatically within a few seconds, staying hidden. If Trac escalates to an "I am human" checkbox, the window appears so you can click it once. The window then closes on its own; the attachment list is read from the page and shown in the panel.

Each attachment row shows the filename (click it to open the file in your browser), the author, the date, and the size. Rows for patch files have an **Apply…** button that works the same way as for pull requests.

Two things can go wrong:

- If the human-check does not complete within 90 seconds, the panel says so — try again, and click "I am human" if it appears.
- If you close the Trac window before the list loads, click **Show Trac attachments** again.

## Which patch is newest

When a ticket has both pull requests and attachments, the panel marks the most recent one, and points out when the latest work is a file attachment rather than a pull request. Testing the newest patch first is usually what a ticket needs.

## Next steps

- [Apply a patch or PR to your site](applying-patches)
- [Submit your own changes](submitting-changes)
