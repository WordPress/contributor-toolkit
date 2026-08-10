# Running the site

Once the [setup wizard](./setup-wizard) is complete, the site view shows a **Start dev server** button. This starts a local WordPress that serves the code in your site's `build/` directory, so you can see your changes running.

![The site view with Start dev server and Submit changes](/screenshots/site-view.png)

## Start and stop

Click **Start dev server**. The button cycles through three states:

- **Start dev server** — nothing is running.
- **Starting dev server...** — the server is booting. A "Dev server is starting…" line below the button shows the elapsed time.
- **Stop dev server** — the server is up. The button shows a red dot; clicking it stops the server.

When the server is ready, its URL appears below the button, for example `http://127.0.0.1:<port>/`. Click it to open the site in your default browser.

The button is disabled while a trunk update is running, and a trunk update is blocked while the server runs — the two would fight over the same files.

## Logging in

Every site uses the same credentials, shown next to the URL:

- Username: `admin`
- Password: `password`

Append `/wp-admin/` to the site URL to reach the dashboard.

## What the dev server actually runs

The dev server is not a stub — it is WordPress Playground running your checkout:

- The app spawns the [Playground CLI](https://wordpress.github.io/wordpress-playground/) (`@wp-playground/cli`) in server mode, with your site's `build/` directory mounted as the WordPress root. PHP runs as WebAssembly inside the bundled Node.js runtime, so no PHP install is needed.
- The database is **SQLite**, stored inside the Playground instance. This covers most core contribution work; if a ticket specifically needs MySQL behaviour, this environment cannot reproduce it.
- Alongside the server, the app runs the core build watcher, so edits under `src/` are rebuilt into `build/` while the server is up. A page reload then shows the change.
- The server binds to the loopback interface only. It is reachable from your machine, not from the rest of your network.
- Outgoing mail is captured locally instead of being sent — see [Mail](./mail).

## Open Adminer

While the server is running, an **Open Adminer** button appears next to **Stop dev server**. It opens Adminer, a database browser, against the site's SQLite database — useful for inspecting what a code change wrote. See [Database](./database) for details.

The button disappears when the server stops, because there is no database to connect to.

## Where the output goes

Everything the server and the watcher print streams into the site's terminal panel, which is also where startup errors land. See [Terminal](./terminal) and [Logs and debugging](./logs-and-debugging).
