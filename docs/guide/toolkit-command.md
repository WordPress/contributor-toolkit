# The toolkit command

::: warning Experimental
This is a first step towards letting scripts and AI tools use the app ([#764](https://github.com/WordPress/contributor-toolkit/issues/764)). It can only read so far, and the command, its output and where it lives may all change.
:::

The app writes a small command, `toolkit`, that asks the running app a question and prints the answer. A script, a Contributor Day facilitator or an AI coding tool with a terminal can use it to find the sites the app has set up, where each one is on disk, and which ticket, branch and dev server it has, so the tool can work in the checkout the app already made instead of building its own.

It needs nothing installed. Like the app's own `npm`, the command runs on the Node that ships inside the app.

## Where the command is

The app writes the command into its own data folder each time it starts, and names the full path in its log. Choose **Help → Open App Log** and look for the line that names the command:

```
answering at …/control.sock; the command is …/bin/toolkit
```

On Windows the file is `toolkit.cmd`. Run it by that full path, in quotes, since the path usually has a space in it.

## Listing your sites

The app has to be open. With it closed, the command says so and exits with an error.

```
"/path/from/the/log/bin/toolkit" sites
```

```
my-site (WordPress Core)
  Path:    /Users/you/WordPress/my-site
  Work:    Trac ticket #62281 (branch ticket/62281)
  Server:  running at http://127.0.0.1:9400
```

Add `--json` for a form a tool can read:

```json
{
  "ok": true,
  "sites": [
    {
      "path": "/Users/you/WordPress/my-site",
      "label": "my-site",
      "project": "core",
      "workItem": { "provider": "trac", "id": 62281 },
      "branch": "ticket/62281",
      "pullRequest": null,
      "initialized": true,
      "server": { "running": true, "url": "http://127.0.0.1:9400" }
    }
  ]
}
```

| Field | What it says |
| --- | --- |
| `path` | The site's folder. |
| `project` | `core` or `gutenberg`. |
| `workItem` | The linked Trac ticket (`trac`) or GitHub issue (`github-issue`), or `null`. |
| `branch` | The branch checked out in the folder. |
| `pullRequest` | The number of the pull request that is checked out, or `null`. |
| `initialized` | `false` while the site's setup has not finished. |
| `server` | Whether the dev server is running, and its address once it has one. |

When something goes wrong the command exits with a status other than zero. With `--json` the reason is still printed as JSON, with `"ok": false`, a `code` such as `not-running`, and an `error` sentence.

## What it cannot do

It does not create a site, link a ticket, apply a patch or start the dev server: those are still done in the window. It also does not start the app.

## Who can use it

Only programs running as you, on this computer. The command talks to the app over a local socket in the app's data folder (a named pipe on Windows), not over the network, so a web page or another computer cannot reach it.
