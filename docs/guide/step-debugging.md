# Step debugging with Xdebug

A site's PHP can run with Xdebug, so you can stop on a breakpoint in your editor and step through Core one line at a time. It is off unless you turn it on, because it slows every request.

This is a proof of concept. It has setup for VS Code, Cursor, PhpStorm and Zed, and one running site has Xdebug at a time.

## Turn it on

1. Open **Settings** and choose the **Sites** tab.
2. Turn on **Step debugging (Xdebug)**.
3. Start the site's development server. If it is already running, stop it and start it again: a server keeps what it started with.

The **Debugging** row of the site's details then names *Xdebug*, and while the server runs with it, a **Set up Xdebug for your editor** menu sits under the row. If the row says *Restart the server to use it* instead, the server started before you turned the setting on.

The menu lists the editors the app finds on your computer that it has setup for. If it finds none of them, there is no menu. The app looks in each editor's usual install location, so it can miss one installed elsewhere, such as PhpStorm from JetBrains' own installer on Windows. Sublime Text has no setup: its PHP debugger needs Node.js installed on your computer.

If you chose one of these editors as your **Code editor** on the **General** tab of **Settings**, and the app finds it, the button is named for it instead, such as **Set up Xdebug for Zed**, and opens that editor's setup without the menu. In the steps below, select that button where they say to choose your editor from the menu. To set up a different editor, change the **Code editor** setting, or set it to **Ask each time** to have the menu back.

## Connect VS Code or Cursor

Cursor uses the same setup as VS Code: choose **Cursor** in the menu, and follow the same steps in Cursor.

1. In VS Code, install the **PHP Debug** extension by Xdebug.
2. Open the site's folder.
3. In the site's details, select **Set up Xdebug for your editor**, choose **VS Code**, then select **Copy launch.json**, and paste it into `.vscode/launch.json` in that folder.
4. Open **Run and Debug**, choose **Listen for Xdebug**, and start it.
5. Set a breakpoint, and load a page of the site in the browser.

The launch.json listens on `127.0.0.1` only, so other machines on your network cannot connect to it.

The app does not write `.vscode/launch.json` for you, but it does keep the file out of your patch: the site's local Git excludes leave out editor folders such as `.vscode/` and `.zed/`, so Zed's `.zed/debug.json` stays out too. Gutenberg's own files in `.vscode/`, such as `launch-example.json`, are tracked, so a change to one of them is still part of your work.

## Connect PhpStorm

PhpStorm keeps its debug setup in its own settings, so the app gives you the values to enter there. In the site's details, select **Set up Xdebug for your editor**, and choose **PhpStorm**.

1. In **Settings → PHP → Debug**, make sure **Debug port** includes 9003. Turn off both **Force break at first line** options: every request first runs a file of Playground's own, which has no mapping, and PhpStorm would stop there.
2. In **Settings → PHP → Servers**, add a server with **Xdebug** as its debugger. Copy the **Host** and **Port** from the dialog, turn on **Use path mappings**, and map the dialog's **File/Directory** to its **Absolute path on the server**.
3. Turn on **Run → Start Listening for PHP Debug Connections**, set a breakpoint, and load the site.

The **Host** includes the site's port, such as `127.0.0.1:9400`, and the **Port** is `80`. That is how Playground describes the site to PHP, and PhpStorm uses it to find the server. With the host as `127.0.0.1` and the port as `9400`, PhpStorm ignores every request.

If the site starts on another port, PhpStorm asks which server the connection is for. Update the server's **Host** to the one the dialog shows.

## Connect Zed

1. In Zed, run **zed: extensions** from the command palette, and install **PHP**. Its Xdebug adapter is what Zed debugs PHP with.
2. Open the site's folder.
3. In the site's details, select **Set up Xdebug for your editor**, choose **Zed**, then select **Copy debug.json**, and paste it into `.zed/debug.json` in that folder.
4. Run **debugger: start** from the command palette, and choose **Listen for Xdebug**.
5. Set a breakpoint, and load a page of the site in the browser.

Like the launch.json, the debug.json listens on `127.0.0.1` only.

If Zed says no debug tasks were found, the PHP extension is not installed: Zed leaves out a debug task whose adapter it does not have.

## Where to set breakpoints

On a Core site, set breakpoints in `src/`, the files you edit. The server runs WordPress from `build/`, but the build copies the PHP from `src/` line for line, and the launch.json maps one to the other.

Three files do not line up:

- `src/index.php` and `src/wp-admin/index.php` are short notes that tell you to run the build. The real files are `src/_index.php` and `src/wp-admin/_index.php`.
- `src/wp-includes/version.php` differs from its built copy on the line that holds the version.

On a Gutenberg site, the checkout is the plugin, so set breakpoints in the checkout's own PHP files.

## One site at a time

Every site's server sends Xdebug to port 9003, and your editor cannot tell two sites apart, because both serve their files from the same paths. So only one running server has Xdebug at a time: the first one started while the setting is on.

A site you start while another site's server has Xdebug starts without it. Its **Debugging** row says which site has it. To debug the second site, stop the first site's server, then restart the second one.

## If your editor does not stop

- Check that the site's details show **Set up Xdebug for your editor**, or **Set up Xdebug for** and your code editor's name, under **Debugging**. If they do not, restart the server. If they still do not, the app found no editor it has setup for.
- Check that **Listen for Xdebug** is running in VS Code, Cursor or Zed, or that PhpStorm is listening for debug connections, and that no other program uses port 9003.
- On a Core site, check that the breakpoint is in `src/`, not `build/`, and not in one of the three files above.
- On a Gutenberg site, check that the breakpoint is in one of the checkout's own PHP files.
- Check that no other site's server is running with Xdebug.

With Xdebug on and no editor listening, the site works as usual, only a little slower.

## If the server stays on "starting"

Playground runs some PHP of its own while the server starts, and with Xdebug on, your editor can stop there too: on a breakpoint, or, in PhpStorm, on **Force break at first line** or on its question about which server the connection is for. The server waits until your editor lets it go on.

Continue in your editor, or select **Cancel** next to **Server starting…** in the site's details. A server that starts with Xdebug is given 15 minutes, instead of the usual 2, before the app gives up on it.
