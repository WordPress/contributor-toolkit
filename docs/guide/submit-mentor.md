# Handing a patch to a mentor

**Hand it to a mentor** is the destination on the [Submit changes](submitting-changes) screen for the contributor who will not create a GitHub account today — common at a contributor day, where a mentor collects patches and pushes them on the contributors' behalf. It needs no accounts at all. Someone else pushes the patch, and the props still land on you.

## What the app asks for

The first time, the card asks for two things:

- **WordPress.org username** — required. This is who the work is credited to.
- **Event** — optional. Where the patch was written: "WordCamp Europe 2026", a meetup, a company contributor day. It is free text, because most of these are named the day they happen.

Click **Remember this**. Both values are remembered for every site — they are facts about you, not about one checkout. On a shared laptop, click **Change these** and clear them before the next person takes over.

## Saving the patch

Click **Save patch as your-username**. The app saves a patch file that carries its own provenance, as comment lines before the diff:

```
# WordPress Contributor Toolkit patch
# Contributor: janedoe (wordpress.org)
# Event: WordCamp Europe 2026
# Ticket: https://core.trac.wordpress.org/ticket/62281
# Base: trunk @ a1b2c3d, 2026-08-09
# Generated: 2026-08-10
```

The header says who made the patch, at which event, for which ticket, against which trunk revision, and when. A field the app does not know is left out rather than written as "unknown", so a mentor can trust the lines that are there. The `#` lines are ignored by `git apply`, `patch`, and Trac's own tooling, so the file applies exactly like a plain diff.

Under the button, the card confirms what the header will claim — **The patch will say it was written at …**, or "No event on the patch" — on every save, so a remembered event from last year cannot stamp patches unnoticed.

## The file name

The suggested filename carries the ticket and your username:

- `62281.janedoe.diff` when a ticket is [linked to the site](trac-tickets)
- `janedoe.diff` when none is

The username is in the filename because it is what a mentor sorts a folder of patches by; the header is what survives if someone renames the file.

## What the mentor does with it

The mentor uploads the patch to the Trac ticket (or turns it into a pull request) from their own account. The header tells them — and whoever assigns props — whose work it is and what it was based on, so the credit follows the file, not the account that uploaded it.
