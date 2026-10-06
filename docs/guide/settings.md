# Settings

The app's settings are in one dialog, opened from the cog at the bottom right of the window, or from the menu: **Settings…** in the application menu on macOS (⌘,), under **File** on Windows and Linux (Ctrl+,). A setting applies to every site and is kept between launches.

## General

- **Language** — which language the app is shown in: your system's language, which is the default, or one of the languages the app has a translation for. A change applies after a relaunch, which the dialog offers; relaunching stops running servers and builds, as quitting does. Translations come from [translate.wordpress.org](https://translate.wordpress.org/projects/meta/contributor-toolkit/) and ship with the app once they are mostly complete, so the list grows from release to release.
- **New sites go here** — the folder new sites are created in, each in a subfolder of its own. With one set, the [create-site dialog](./creating-a-site) starts on it; you can still pick another folder for one site without changing the setting. **Forget this folder** clears it, and the dialog goes back to asking each time. A folder that no longer exists is refused when you choose it.

## Account

- **WordPress.org username** and **Event** — who a patch you [hand to a mentor](./submit-mentor) says it is from, and where it was written. The same two answers the handoff asks for, so changing them here changes them there. Leave the event empty when you are not at one. A profile link pasted as the username is kept as the username it names.
- **GitHub** — the account the app opens pull requests with, if you have signed in. Signing in happens where it is needed, in [Opening a pull request](./submit-github-pr); here you can see which account it is and sign out of it.
