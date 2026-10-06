# Settings

The app's settings are in one dialog, opened from the cog at the bottom right of the window, or from the menu: **Settings…** in the application menu on macOS (⌘,), under **File** on Windows and Linux (Ctrl+,). A setting applies to every site and is kept between launches.

## General

- **Language** — which language the app is shown in: your system's language, which is the default, or one of the languages the app has a translation for. A change applies after a relaunch, which the dialog offers; relaunching stops running servers and builds, as quitting does. Translations come from [translate.wordpress.org](https://translate.wordpress.org/projects/meta/contributor-toolkit/) and ship with the app once they are mostly complete, so the list grows from release to release.
- **Start the server when I open a site** and **Start the build watch when I open a site** — off unless you turn them on. On, opening a site that is set up starts its [development server](./running-the-site), its build watch, or both, as it would if you pressed Start; on WordPress Core the server's start brings the watch with it. Nothing starts for a site whose setup, update or deletion is under way, and nothing already running is started again.
- **When I quit, running servers and build watches** — quitting always stops them, as it always has. **Stop them, and start them again next time** remembers which sites had a server or a watch running and starts them again when the app next opens, whichever site it opens on.
- **New sites go here** — the folder new sites are created in, each in a subfolder of its own. With one set, the [create-site dialog](./creating-a-site) starts on it; you can still pick another folder for one site without changing the setting. **Forget this folder** clears it, and the dialog goes back to asking each time. A folder that no longer exists is refused when you choose it.

## Sites

What every site's development server runs with. A change applies the next time a server starts; one that is running keeps what it started with until you stop and start it. The open site's details, in the right-hand column, show the PHP version beside the checkout and which debug constants are on.

- **PHP version** — the PHP the site runs on, from the versions the bundled WordPress Playground has. 8.3 unless you choose another.
- **Report notices and deprecations (WP_DEBUG)** — on, notices and deprecations are reported along with warnings and errors, written to `debug.log` and shown in the browser; see [Logs and debugging](./logs-and-debugging). Off, notices and deprecations are not reported; warnings and errors still reach `debug.log` and the browser, and `error_log()` calls still reach `debug.log`: the app's PHP keeps logging and display on whatever WP_DEBUG says.
- **Use unminified scripts (SCRIPT_DEBUG)** — on, Core serves its JavaScript and CSS unminified.

## Account

- **WordPress.org username** and **Event** — who a patch you [hand to a mentor](./submit-mentor) says it is from, and where it was written. The same two answers the handoff asks for, so changing them here changes them there. Leave the event empty when you are not at one. A profile link pasted as the username is kept as the username it names.
- **GitHub** — the account the app opens pull requests with, if you have signed in. Signing in happens where it is needed, in [Opening a pull request](./submit-github-pr); here you can see which account it is and sign out of it.
