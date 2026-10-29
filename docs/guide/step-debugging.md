# Step debugging with Xdebug

A site's PHP can run with Xdebug, so you can stop on a breakpoint in VS Code and step through Core one line at a time. It is off unless you turn it on, because it slows every request.

This is a proof of concept. It has setup for VS Code and PhpStorm, and it follows one running site at a time.

## Turn it on

1. Open **Settings** and choose the **Sites** tab.
2. Turn on **Step debugging (Xdebug)**.
3. Start the site's development server. If it is already running, stop it and start it again: a server keeps what it started with.

The **Debugging** row of the site's details then names *Xdebug*, and while the server runs with it, a **Set up your editor** button sits under the row. If the row says *Restart the server to use it* instead, the server started before you turned the setting on.

## Connect VS Code

1. In VS Code, install the **PHP Debug** extension by Xdebug.
2. Open the site's folder.
3. In the site's details, select **Set up your editor**, then **Copy launch.json**, and paste it into `.vscode/launch.json` in that folder.
4. Open **Run and Debug**, choose **Listen for Xdebug**, and start it.
5. Set a breakpoint, and load a page of the site in the browser.

The app does not write `.vscode/launch.json` for you. A file it wrote into the checkout could end up in your patch.

## Connect PhpStorm

PhpStorm keeps its debug setup in its own settings, so the app gives you the values to enter there. In the site's details, select **Set up your editor**, and choose the **PhpStorm** tab.

1. In **Settings → PHP → Debug**, make sure **Debug port** includes 9003. Turn off both **Force break at first line** options: every request first runs a file of Playground's own, which has no mapping, and PhpStorm would stop there.
2. In **Settings → PHP → Servers**, add a server with **Xdebug** as its debugger. Copy the **Host** and **Port** from the dialog, turn on **Use path mappings**, and map the dialog's **File/Directory** to its **Absolute path on the server**.
3. Turn on **Run → Start Listening for PHP Debug Connections**, set a breakpoint, and load the site.

If the site starts on another port, PhpStorm asks which server the connection is for. Update the server's port to the one the dialog shows.

## Where to set breakpoints

On a Core site, set breakpoints in `src/`, the files you edit. The server runs WordPress from `build/`, but the build copies the PHP from `src/` line for line, and the launch.json maps one to the other.

Three files do not line up:

- `src/index.php` and `src/wp-admin/index.php` are short notes that tell you to run the build. The real files are `src/_index.php` and `src/wp-admin/_index.php`.
- `src/wp-includes/version.php` differs from its built copy on the line that holds the version.

On a Gutenberg site, the checkout is the plugin, so set breakpoints in the checkout's own PHP files.

## One site at a time

Every site's server sends Xdebug to port 9003, and only one VS Code window can listen on it. VS Code also cannot tell two sites apart, because both serve their files from the same paths.

If two sites run with Xdebug at once, VS Code may stop on one site's breakpoints for the other site's pages, or not stop at all. The **Debugging** row warns you when another site's server is running with Xdebug. Stop the other server while you debug.

## If VS Code does not stop

- Check that the site's details show **Set up your editor** under **Debugging**. If they do not, restart the server.
- Check that **Listen for Xdebug** is running in VS Code, or that PhpStorm is listening for debug connections, and that no other program uses port 9003.
- Check that the breakpoint is in `src/`, not `build/`, and not in one of the three files above.
- Check that no other site's server is running with Xdebug.

With Xdebug on and VS Code not listening, the site works as usual, only a little slower.
