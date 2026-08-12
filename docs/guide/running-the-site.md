# Running the site

Once the [setup wizard](./setup-wizard) is complete, the site view shows a **Start dev server** button. This starts a local WordPress that serves the code in your site's `build/` directory, so you can see your changes running.

![The site view with Start dev server and Review & submit changes](/screenshots/site-view.png)

## Start and stop

Click **Start dev server**. The button cycles through three states:

- **Start dev server** — nothing is running.
- **Starting dev server...** — the server is booting. A "Dev server is starting…" line below the button shows the elapsed time.
- **Stop dev server** — the server is up. The button shows a red dot; clicking it stops the server.

When the server is ready, its URL appears below the button, for example `http://127.0.0.1:<port>/`, with a **wp-admin** link beside it. Click either to open the site in your default browser.

The button is disabled while a trunk update is running. The reverse is no longer true: an update can run with the server up, because it pauses the build watch for the rebuild and leaves the server serving — see [Applying patches and PRs](./applying-patches) and [Staying up to date with trunk](./trunk-updates).

## Logging in

Every site uses the same credentials, shown next to the URL:

- Username: `admin`
- Password: `password`

The **wp-admin** link next to the site URL opens the dashboard directly. It appears in both places the URL does: the [setup checklist](./setup-wizard) step and the site page.

## What the dev server actually runs

The dev server is not a stub — it is WordPress Playground running your checkout:

- The app spawns the [Playground CLI](https://wordpress.github.io/wordpress-playground/) (`@wp-playground/cli`) in server mode, with your site's `build/` directory mounted as the WordPress root. PHP runs as WebAssembly inside the bundled Node.js runtime, so no PHP install is needed.
- The database is **SQLite**, stored inside the Playground instance. This covers most core contribution work; if a ticket specifically needs MySQL behaviour, this environment cannot reproduce it.
- The server binds to the loopback interface only. It is reachable from your machine, not from the rest of your network.
- Outgoing mail is captured locally instead of being sent — see [Mail](./mail).

## The build watch

The build watcher compiles what you edit under `src/` into `build/`, which is what the server actually serves. It has its own **Start build watch** button next to the dev-server button, and its own status dot:

| Dot | State |
| --- | --- |
| Green | Watching — waiting for you to save something. |
| Amber | Building — compiling a change, or paused while another action owns the build directory. |
| Red | It exited on its own. Read the **Build watcher** log tab to find out why. |
| Grey | Stopped. |

The watch and the server are independent in both directions:

- Starting the dev server starts the watch first (building once if the site has no `build/` yet), then serves.
- Stopping the dev server leaves the watch running, so you can keep compile-on-save going without a server.
- The watch exiting never touches the server.
- You can start and stop the watch on its own, at any time, whether or not a server is up.

While the watch is running, applying a patch or updating trunk uses it rather than fighting it. A change that only touches `src/` is applied and left for the watch to rebuild — the checklist shows the build step skipped and names the watch as doing it. Anything that installs dependencies or needs a full build pauses the watch for the duration and resumes it after, with the PHP server up throughout.

Its output goes to its own **Build watcher** log tab, not to the terminal, and it no longer holds the terminal's "running" lock — so the terminal and one-shot actions stay available while it runs.

## Open Adminer

While the server is running, an **Open Adminer** button appears next to **Stop dev server**. It opens Adminer, a database browser, against the site's SQLite database — useful for inspecting what a code change wrote. See [Database](./database) for details.

The button disappears when the server stops, because there is no database to connect to.

## Where the output goes

The server's output goes to the **Server** tab of the Logs section, and the watcher's to its own **Build watcher** tab; startup errors land there too. The terminal panel is for the commands you type. See [Logs and debugging](./logs-and-debugging) and [Terminal](./terminal).
