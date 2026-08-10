# The setup wizard

After [creating a site](./creating-a-site), its view shows the **Initial setup checklist**. Complete each step to prepare the site for development. The steps run in order — each one unlocks the next.

![The Initial setup checklist showing four steps: download, install npm dependencies, run full build, and start dev server](/screenshots/setup-wizard.png)

## The four steps

### 1. Download WordPress development version

The clone of `wordpress-develop` that started when you created the site. It runs on its own; while it is in progress the checklist reads "Cloning the WordPress develop repository… the next step unlocks when it finishes." and every later step stays locked.

### 2. Install npm dependencies

Click **Install npm dependencies** to run `npm install` using the Node.js runtime bundled with the app — no system Node or npm is needed. If the install fails, the button changes to **Retry npm install**; a leftover `node_modules` folder from a failed run does not count as completed.

Once installed, the button reads **Dependencies installed** and stays disabled. If you later add a dependency to `package.json`, run `npm install` yourself in the [Terminal](./terminal).

### 3. Run full build

Click **Run full build** to compile WordPress core and generate the `dist` files the dev server serves. This is the longest step after the clone.

You only run it manually once: [trunk updates](./trunk-updates) and [applied patches](./applying-patches) rebuild on their own. If you edit files in `src/` by hand, run `npm run build` in the Terminal so the site picks them up.

### 4. Start dev server & finish wizard

Click **Start dev server and finish the wizard** to launch the WordPress dev server for the first time. This completes the checklist and permanently replaces it with the compact action bar described below. The server URL appears next to the button once it is up — see [Running the site](./running-the-site).

## Step states

Each step carries a state label:

- **Completed** — done, marked with a green check.
- **In progress** — the step to do next; its button is enabled.
- **Pending** — ready but waiting for you to reach it.
- **Locked** — its prerequisites are not met yet; the button is disabled.

Steps also lock temporarily while a [trunk update](./trunk-updates) is running, since the update owns the working tree during that time.

## Skipping the wizard

Below the checklist is a **Skip initialization wizard** link. Clicking it hides the checklist for this site, for good, and shows the compact action bar instead: the dev server start/stop button, **Review & submit changes**, and — while the server is running — **Open Adminer**.

Skipping does not run any of the steps for you. If the dependencies were never installed or the build never ran, the dev server will not have anything to serve, so only skip on a site you know is already set up (for example, a `wordpress-develop` checkout you prepared outside the app). For everything else, finishing step 4 gets you to the same action bar with the work actually done.
