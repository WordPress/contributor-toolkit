# Opening the site in your editor

The app is not an editor. To change WordPress code you open the site's folder in the editor you already use. The app opens it for you from the **Site actions** menu, and opens a single changed file from the site's details.

![The site view, with the site's path under Local path in the details and the Site actions menu button at the right end of the header](/screenshots/site-view.png)

## Choose your code editor

In [Settings](./settings), under **General → Applications**, **Code editor** lists the editors the app found on your computer, and **Ask each time**, which is the default.

- With an editor chosen, the app opens the site and its files in that editor without asking.
- With **Ask each time**, the app asks which application to use every time.

The same setting decides which editor's setup the site's details offer for [step debugging](./step-debugging).

If the editor you chose is uninstalled later, the app asks again until you choose another one. The next time you open Settings, **Code editor** reads **Ask each time** and a notice says the editor is no longer installed.

Only editors the app found can be chosen. An application you pick with **Other application…** opens the site, but it cannot be saved as the setting.

## Open in

Open the **Site actions** menu (⋮) at the right end of the header, or right-click the site in the sidebar.

- With a code editor chosen in Settings, the menu has one item, **Open in** followed by the editor's name, for example **Open in PhpStorm**. Choose it to open the site's folder in that editor.
- With **Ask each time**, **Open in** opens a second menu. It lists each editor the app found on your computer, by name, and then **Other application…**, which is always last.

## Changed files

The **Changed files** section of the site's details lists, as folder trees, the files your work changes and the files an applied patch or pull request changes. Click a file to open it:

- With a code editor chosen in Settings, the file opens in that editor.
- With **Ask each time**, a menu labelled **Open in** opens next to the file, with the same editors and **Other application…**. Press Escape to close it without opening anything.
- If the app found no editor, the file is shown in your file manager.

Folders that editors create for their own settings are not listed: `.idea`, `.vscode`, `.vs`, `.fleet`, `.zed` and `.nova`. The app adds them to the site's local Git excludes (`.git/info/exclude`), so they also stay out of your patch. If you remove a rule from that file, the app does not add it again. A file that the project itself tracks in one of these folders, such as Gutenberg's own `.vscode` files, is still listed when you change it.

## How detection works

Detection looks in the standard install locations for a short list of common editors: VS Code, Cursor, PhpStorm, Sublime Text, and Zed. It runs again each time you open a menu, so an editor you install while the app is running appears the next time. While it is still looking, the menu shows **Looking for applications…**.

The list is a shortcut, not a limit. Detection checks fixed install paths rather than your shell's `PATH` (a packaged desktop app does not inherit it), so it can miss editors installed somewhere unusual: JetBrains standalone installers with version-numbered folders, for instance, or most Linux packaging variants. An editor the list misses is not one the app refuses to use: that is what **Other application…** is for.

## Other application…

**Other application…** opens your system's application picker. Choose any application and the site's folder is handed to it. This works for any editor, found or not, and is the reliable path when detection finds nothing.

## Copy path and the file manager

- The **Copy** button next to **Local path** in the details copies the site's full path to the clipboard, and briefly reads **Copied**. Use it to open the folder from an editor's own **Open Folder** dialog or from a terminal.
- The **Site actions** menu also has **Copy path**, and **Show in Finder** / **Show in Explorer** (**Show in file manager** on Linux), which shows the folder in your file manager.

## When an open fails

If an application cannot open the folder or file (it was uninstalled, or the launch was refused), a notice at the top of the site's page says what went wrong. When it can help, the notice has a **Choose application…** button that opens the same picker as **Other application…**, so you can choose an application that works.

## What to edit

The source you edit lives in the site's folder: under `src/` on a WordPress Core site, under `packages/` on a Gutenberg site. While the [build watch](./running-the-site#the-build-watch) is running, your edits are rebuilt into `build/` as you save them. It runs on its own control, so it does not need the dev server up. On a WordPress Core site, starting the server starts it too; on a built Gutenberg site the server starts without it, so start it yourself when you want `packages/` edits compiled on save. When your change is ready, see [Submitting changes](./submitting-changes).
