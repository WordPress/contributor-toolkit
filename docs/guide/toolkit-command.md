# The toolkit command

::: warning Experimental
This is new ([#764](https://github.com/WordPress/contributor-toolkit/issues/764)). The command, its output and where it lives may all change.
:::

The app writes a small command, `toolkit`, that a script, a Contributor Day facilitator or an AI coding tool with a terminal can run to work with your sites: find them, create one, link a ticket, apply the latest patch, start the server, and read what the site logged and mailed. A tool then works in the checkout the app made, with the app's own Git, Node and server, instead of building an environment of its own beside it.

It needs nothing installed. Like the app's own `npm`, the command runs on the Node that ships inside the app.

![An AI coding tool asked to set up a site for a Trac ticket, running the toolkit command four times](/images/toolkit-ai-tool-example.png)

*An illustration of an AI coding tool with a terminal using the command. The commands and what they print are the real ones.*

## Giving a tool the command

Open **Settings**, choose **Tools**, and press **Copy command**. Paste what it copied to your tool: it is the command's full path, in quotes, since the path has a space in it. On Windows the file is `toolkit.cmd`.

![The Tools tab of the settings, with the command's path, a Copy command button and the switch that lets tools change sites](/screenshots/settings-tools.png)

## Letting a tool change your sites

Out of the box the command can only read. To let it change a site, turn on **Let tools on this computer change my sites** in that same tab.

| Without the switch | With the switch |
| --- | --- |
| List your sites | Create a site |
| Read a site's `debug.log` | Link and unlink a ticket or issue |
| Read a site's caught mail | Apply the latest patch, check out or leave a pull request |
| | Update to the latest trunk |
| | Run `npm install` and the site's npm scripts |
| | Start and stop the dev server |

A tool can never delete a site, discard your changes, attach a patch to Trac or open a pull request. Those stay with you, in the window.

Everything a tool changes is done by the app's window, as if you had pressed the button yourself, so you see it happen: the terminal shows the build, the ticket card shows the ticket. When the app has a question, such as what to do with edits you made on trunk, it asks it in the window, and the command tells the tool so.

## The commands

Every command takes `--json` for an answer a tool can read, and exits with a status other than zero when it fails. With `--json` a failure is still printed as JSON, with `"ok": false`, a `code` and an `error` sentence.

A site is named by its path, by any folder inside it, or by its name in the app. Leave the site out and the command uses the site the current folder is in, which is what a tool working in the checkout wants.

Each command waits until what it asked for has ended. For a new site, an update or a build that is minutes. If the installed app is closed, the command opens it first.

### Reading

| Command | What it does |
| --- | --- |
| `toolkit sites` | Lists your sites: path, project, linked ticket or issue, branch, checked-out pull request, and the dev server's address. |
| `toolkit log [site] [--lines N]` | Prints the end of the site's WordPress `debug.log`, the file the [Logs panel](./logs-and-debugging) shows: the last 100 lines unless told otherwise, never more than 1000 or the last 256 KB. |
| `toolkit mail [site]` | Prints the mail the site sent and the app caught, as the [Mail panel](./mail) lists it: the newest 50, text only. |

### Changing a site

| Command | What it does |
| --- | --- |
| `toolkit create <name> [--project core\|gutenberg] [--folder <path>]` | Creates a site and waits until it is installed and built. Without `--folder` it goes in the folder for new sites from the settings. |
| `toolkit ticket link <ticket> [site] [--carry]` | Links a Trac ticket or a GitHub issue, by number or address, and switches to its branch. `--carry` brings edits made on trunk into a new ticket. |
| `toolkit ticket unlink [site]` | Unlinks the ticket and goes back to trunk. The ticket's work stays on its branch. |
| `toolkit patch apply [site]` | Applies the latest patch on the linked ticket: its newest attachment, or its newest pull request, whichever the app marks **Latest**. |
| `toolkit pr checkout <number> [site]` | Checks out a pull request. |
| `toolkit pr leave [site]` | Leaves the pull request and goes back to where the site was. |
| `toolkit update [site]` | Updates to the latest trunk, then installs and builds as needed. |
| `toolkit install [site]` | Runs `npm install`. |
| `toolkit run <script> [site]` | Runs one of the scripts [the terminal](./terminal) allows, such as `build`, and prints the end of its output. |
| `toolkit server start [site]` | Starts the dev server and prints its address. |
| `toolkit server stop [site]` | Stops the dev server. |

`toolkit run` refuses `watch` and `dev`: they never end, and would hold the site's terminal. On a WordPress Core site, starting the server starts the build watch, so edits are compiled as they are saved. On a Gutenberg site that is already built, the server starts without the watch: run `toolkit run build` after editing, or start the watch in the window.

## An example

Setting up a site for a ticket and trying its latest patch, the way an AI tool would:

```
toolkit create "Ticket 65930"
toolkit ticket link 65930 "Ticket 65930"
toolkit patch apply "Ticket 65930"
toolkit server start "Ticket 65930"
```

The last command prints the site's address. From there the tool can edit the files under the site's folder, run `toolkit run build`, and read `toolkit log` to see what PHP said.

## When the app refuses

The `code` says why, so a tool can decide what to do next:

| Code | What it means |
| --- | --- |
| `tools-not-allowed` | The switch in **Settings → Tools** is off. It is yours to turn on. |
| `unknown-site`, `ambiguous-site` | No site, or more than one, matches what was named. `toolkit sites` lists them. |
| `busy` | The site is in the middle of something: a build, an update, a switch. Try again when it has finished. |
| `site-not-open`, `window-not-ready`, `window-closed` | The app's window was not there to do it: it was closed, reloaded, or the site is still being created or deleted. Try again. |
| `not-built` | The site's setup has not finished, so there is nothing to serve. Run `toolkit install`, then `toolkit run build`. |
| `unsupported-script` | The script is not one the terminal allows for this site, or is a watch. |
| `no-ticket`, `already-applied` | `patch apply` needs a linked ticket, and no patch applied already. |
| `is-pull-request` | The number given to `ticket link` on a Gutenberg site is a pull request, not an issue. Use `pr checkout`. |
| `legacy-site`, `merge-in-progress` | The checkout is in a state the app does not change: made by an old version of the app, or with a merge or rebase left unfinished from a terminal. The site's page says what to do. |
| `dirty-trunk`, `dirty` | Edits in the checkout would be left behind or reset. The app is asking what to do with them in its window. |
| `no-latest-patch` | The ticket has no patch, or two are too close in time for the app to call one the latest. Choose one in the window. |
| `trac-failed`, `patches-failed` | Trac or GitHub could not be read. If Trac asked for a human check, answer it in the app's window. |
| `timed-out` | The app is still working on it. Look at its window before asking again. |
| `script-failed`, `setup-failed`, `update-failed`, `apply-failed`, `server-failed` | The step ran and failed. The error says which, and the app's terminal has the output. |

## Who can use it

Programs on this computer that can read the app's data folder, which is yours. The command talks to the app over a local socket in that folder, not over the network, so a web page or another computer cannot reach it. On Windows it is a named pipe whose name changes each time the app starts and is only written into that folder.

The switch is your consent, not a lock. It is kept in the app's settings file in that same folder, so it stops a tool that asks the app, which is what a well-behaved tool does; it does not stop a program that is already able to change your files. With the switch on, `toolkit create --folder` makes a site in whatever folder the tool names.
