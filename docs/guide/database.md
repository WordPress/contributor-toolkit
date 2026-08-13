# Browsing the database

The dev server runs WordPress on SQLite, and the app bundles [Adminer](https://www.adminer.org/)
so you can look inside that database from your browser.

## Opening Adminer

While the dev server is running, a **DB inspect (Adminer)** link appears beside the server URL in
the site view, after **wp-admin**. Clicking it opens Adminer in your browser, already logged into the site's
SQLite database — no credentials to enter. From there you can browse tables, inspect rows, and run
SQL, the same way you would against a MySQL-backed install.

The database file itself lives inside the Playground environment at
`/wordpress/wp-content/database/.ht.sqlite`. It is not a file you can open directly on disk; go
through Adminer.

Adminer is only reachable while the dev server runs — the link disappears when the server
stops, and so does the page it opened.

## Is SQLite enough for core development?

For most new contributors, yes. WordPress's SQLite support has matured considerably: most plugins
and most core unit tests work, and thanks to the query parser, remaining gaps are tracked and
steadily closed.

It is not a complete substitute for MySQL, though. Be aware of the limits:

- Some queries and features behave differently on SQLite than on MySQL, and a small number do not
  work at all.
- If your contribution touches the database layer itself — `wpdb`, schema changes, MySQL-specific
  SQL — you should verify it against a real MySQL install before submitting. The toolkit cannot
  do that for you: WordPress Playground can work with MySQL, but this app does not ship a MySQL
  server.

For the typical first contribution — a fix in PHP, JavaScript, or CSS that reads and writes
ordinary posts, options, and users — the difference will not affect you.

## Related pages

- [Running the site](./running-the-site) — starting and stopping the dev server.
- [Logs and debugging](./logs-and-debugging) — where database errors surface as PHP notices.
