# Settings

The app's settings are in one dialog, opened from the cog at the bottom right of the window, or from the menu: **Settings…** in the application menu on macOS (⌘,), under **File** on Windows and Linux (Ctrl+,). A setting applies to every site and is kept between launches.

## General

- **New sites go here** — the folder new sites are created in, each in a subfolder of its own. With one set, the [create-site dialog](./creating-a-site) starts on it; you can still pick another folder for one site without changing the setting. **Forget this folder** clears it, and the dialog goes back to asking each time. A folder that no longer exists is refused when you choose it.

## Account

- **WordPress.org username** and **Event** — who a patch you [hand to a mentor](./submit-mentor) says it is from, and where it was written. The same two answers the handoff asks for, so changing them here changes them there. Leave the event empty when you are not at one. A profile link pasted as the username is kept as the username it names.
- **GitHub** — the account the app opens pull requests with, if you have signed in. Signing in happens where it is needed, in [Opening a pull request](./submit-github-pr); here you can see which account it is and sign out of it.

More settings — the PHP version a site runs on, the debug constants, what starts when a site opens and what happens to running servers when you quit — are on the way.
