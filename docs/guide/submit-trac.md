# Attaching a patch to Trac

**Attach to Trac** is the traditional way to contribute a WordPress core change: a `.diff` file attached to the ticket. It needs a WordPress.org account — which you need anyway, for props and to comment on the ticket.

## What the app does, and what you do

The app does not post to Trac on your behalf — that would mean it holding a WordPress.org session, which it deliberately never does. Instead, the destination on the [Review & submit changes](submitting-changes) screen splits the work:

1. Click **Save, then open #NNNNN**.
2. The app saves your patch as a file wherever you choose.
3. Once the file exists, the app opens the ticket's attach page in your browser.
4. On that page, sign in to WordPress.org if you are not already, choose the file you just saved, and upload it yourself.

The browser is only opened after a file exists, so you never land on an attach form with nothing to attach.

The saved file is the plain diff shown under **Your changes** — no header is added, because a patch attached to Trac conventionally carries none.

## If no ticket is linked

The card says there is nowhere to attach the patch yet, and offers the same field as the [Trac ticket panel](trac-tickets): type the ticket number or URL and click **Link ticket**. The ticket is stored with the site, and the **Save, then open** button appears in its place.

## What happens afterwards

No automated checks run on a Trac attachment. It is common for a reviewer to then ask for the same change as a pull request, where the test suite runs — if that happens, the [pull request destination](submit-github-pr) sends the identical diff.

After uploading, leave a comment on the ticket saying what the patch does and how you tested it. An attachment with no comment is easy to miss.

## Before you attach

If the warning at the top of the **Review & submit changes** screen says your site's WordPress code is old, the patch may not apply cleanly on Trac. Update to the latest trunk first — see [Staying up to date with trunk](trunk-updates) — and check your change still works.
