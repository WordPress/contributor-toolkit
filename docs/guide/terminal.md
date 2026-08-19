# The Terminal panel

Each site view includes an embedded terminal. It is not a general-purpose shell: it accepts a small, fixed set of commands, all of which run in the site's directory using the Node.js runtime bundled with the app. This is enough to rebuild the site after editing code — the reason the panel exists — without requiring Node or npm on your machine.

![The Terminal panel with the command hints below it](/screenshots/terminal.png)

## Supported commands

Type `help` to see the list at any time:

| Command | What it does |
| --- | --- |
| `help` | Lists the supported commands. |
| `npm install` | Runs `npm install` in the site directory. `npm i` and `install` work too. |
| `npm run <script>` | Runs one of the allowed scripts: `build`, `build:dev`, `dev`, `test`, `watch`, `grunt`. |

Any other script name is refused with a message listing the allowed scripts. Only one command runs at a time; if one is already running, the terminal tells you to stop it first.

Press **Ctrl+C** to stop the running command. The Up and Down arrow keys move through your command history.

## When to use it

The [setup wizard](./setup-wizard) runs `npm install` and `npm run build` once, when the site is created. After that, keeping the built site in sync with your edits is up to you:

- **Edited files in `src/`?** Run `npm run build` so the site picks them up.
- **Added a dependency to `package.json`?** Run `npm install`.

Once the site has been built, these two hints appear directly under the terminal. The command in each hint is a link: clicking it types the command into the terminal for you, ready to run — it does not execute it. While a command is running the hints stop being links and show as plain text, so there is nothing to click until it finishes.

::: warning Do not run `npm run watch`
It looks like the way to rebuild continuously, and it is a trap. `wordpress-develop`'s Gruntfile renames the real watch task to `_watch` and leaves a `watch` wrapper that runs a **full production build first** — tens of minutes with nothing to show for it, and 30+ on a Windows VM.

You do not need it anyway: [starting the dev server](./running-the-site) already starts the real watcher for you, as `grunt -- _watch`.
:::
