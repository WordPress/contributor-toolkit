# The Mail panel

WordPress sends email constantly — new user notifications, password resets, comment moderation.
On a development site none of that should reach a real inbox, and with this app none of it can:
each site gets its own built-in SMTP catcher, listening only on `127.0.0.1`. WordPress's
`wp_mail()` is pointed at it, so every email the site sends lands in the **Mail** panel instead
of leaving your machine.

![The Mail panel with a captured email](/screenshots/mail-panel.png)

## How it works

The SMTP catcher starts and stops together with the dev server. While the server is running, the
panel shows the address it listens on, for example `SMTP listening on 127.0.0.1:54321` — the port
is assigned by the operating system, so it varies. Before the server has started, the panel says
`SMTP will start with the dev server.`

No configuration is needed on the WordPress side: the app installs a small must-use plugin in the
Playground environment that routes `wp_mail()` through SMTP to the catcher.

## Reading emails

Captured emails appear in a list showing the date, the sender, and the subject. Click an email
(or press Enter on it) to open it in a full-screen viewer with the **From**, **To**, **CC**, and
**Date** headers and two tabs:

- **Rendered** — the HTML body as a mail client would show it, or the plain-text body if the
  email has no HTML part.
- **Raw** — the raw message source, headers and all. Useful when the bug you are chasing is in
  how core builds the email itself.

**Clear emails** deletes all captured emails for the site.

## Trying it out

Trigger any email-sending flow on the dev site — the password reset form at `/wp-login.php?action=lostpassword`
is the quickest — and the email appears in the panel. See [Running the site](./running-the-site)
for starting the server.
