# Logs and debugging

The **Logs** section of the site view has three tabs:

- **Server** — the dev server's own output: everything the Playground server prints while
  starting and running.
- **Build watcher** — the [build watch](./running-the-site#the-build-watch)'s output. The tab title
  carries its state while it is doing something: *Build watcher (watching)*, *(building)*,
  *(paused)*, or *(exited 1)* when it stopped on its own. Stop it yourself and the title goes back
  to a plain *Build watcher*.
- **debug.log** — WordPress's PHP log for this site, streamed live while the dev server runs.

Output from `npm install` and `npm run` commands appears in the [Terminal](./terminal), not here.

All three panes read in the terminal's own monospace font, so the columns of a PHP stack trace line
up, and each line is coloured by what it is: a fatal, a warning, a deprecation, a notice, a stack
trace frame, or the `Ready! WordPress is running on …` line you are actually waiting for. The
`[11-Aug-2026 …]` timestamp at the head of a `debug.log` line is dimmed, so 26 identical characters
per line recede instead of competing with the message.

![The debug.log tab showing PHP notices](/screenshots/debug-log.png)

## The debug.log tab

Anything WordPress or your code writes to the PHP error log — `error_log()` calls, notices,
warnings, deprecations, `_doing_it_wrong()`, fatals — appears here while the dev server runs.
This works because every site is booted with WordPress's debug constants already set. They are
not configurable:

| Constant | Value | Effect |
| --- | --- | --- |
| `WP_DEBUG` | `true` | Notices, warnings, and deprecations are reported. |
| `WP_DEBUG_LOG` | `true` | They are written to `wp-content/debug.log`, which this panel tails. |
| `WP_DEBUG_DISPLAY` | `true` | Errors are also printed in the browser. |
| `SCRIPT_DEBUG` | `true` | Core serves unminified JS and CSS. |
| `WP_DISABLE_FATAL_ERROR_HANDLER` | `true` | A fatal shows the actual error instead of WordPress's "critical error" recovery screen. |
| `AUTOMATIC_UPDATER_DISABLED` | `true` | Core's automatic updater does not run (and does not fill the log with its own messages). |

Note that `WP_DEBUG_DISPLAY` has a known cost: a notice fired during a REST or AJAX request is
printed into the response and can corrupt the JSON it expects. That trade is made deliberately —
seeing the error beats a silent blank page for a newcomer.

While you are reading another tab, the **debug.log** tab shows an unread count, for example
**debug.log (3)**, so a notice landing while you watch the server output does not go unseen.
Selecting the tab resets the count. The panel keeps the most recent 512&nbsp;KB of the log.

Under the pane:

- The full path to the log file (inside the site's `build/wp-content/` directory) is shown and can
  be selected and copied — useful for tailing it in a real terminal or attaching it to a ticket.
- **Show in folder** reveals the file in your file manager.
- **Copy** puts the panel's contents on the clipboard, ready to paste into a Trac ticket or a pull
  request comment.
- **Clear** empties both the panel and the file on disk. If the file cannot be cleared, the panel
  says so — otherwise the same lines would replay the next time the server starts.

## The app's own log

The application keeps a separate log of its own activity — server starts, installs, errors. Do not
confuse it with the site's debug.log. Open it from the menu: **Help → Open App Log**, or
**Help → Show Logs Folder** to reveal the directory. This is the file to attach when
[reporting a problem with the app itself](./troubleshooting).
