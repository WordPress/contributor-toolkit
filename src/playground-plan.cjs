'use strict';

// Plans the Playground launch options that differ by serve strategy (#251).
//
// Kept pure and dependency-free, no `@wp-playground/cli`, no fs, so the
// branching can be unit tested without booting WASM PHP. server-runner.js calls
// this, merges the result with the blueprint constants (debug + SMTP), and
// spawns the CLI. The actual boot stays an integration concern.
//
// The two strategies mirror @wp-playground/cli's own `--auto-mount` handling
// (see run-cli's plugin vs WordPress-docroot branches):
//
//  - 'docroot', the site's build/ already IS a WordPress install
//    (wordpress-develop / Core). Mount it before install as /wordpress and skip
//    the download with `install-from-existing-files-if-needed`; a fresh download
//    would unpack a second WordPress over the mount.
//
//  - 'plugin-mount', the site is a plugin, not a WordPress (Gutenberg). Leave
//    the install mode at Playground's default so it downloads and installs a
//    stock WordPress, then mount the built checkout as a plugin under
//    wp-content/plugins/<slug> and activate it, exactly what the CLI does for a
//    plugin passed to --auto-mount (a `mount` plus an `activatePlugin` step).

const WORDPRESS_VFS_ROOT = '/wordpress';
const PLUGINS_VFS_BASE = `${WORDPRESS_VFS_ROOT}/wp-content/plugins`;

// Returns the runCLI option fragment for a serve strategy. Keys are the exact
// ones @wp-playground/cli reads: `mount`, `mount-before-install`,
// `additional-blueprint-steps`, and (docroot only) `wordpressInstallMode`.
function planPlaygroundLaunch(config) {
	const cfg = config || {};

	if (cfg.strategy === 'plugin-mount') {
		if (!cfg.pluginDir) throw new Error('plugin-mount serve needs a pluginDir');
		const slug = cfg.pluginSlug || 'plugin';
		// The slug becomes a path segment under the plugins directory; one
		// carrying a separator or `..` would mount the checkout somewhere else
		// in the served WordPress. The registry is the only source today, but
		// this is the seam every strategy goes through.
		if (!/^[a-z0-9-]+$/i.test(slug)) throw new Error(`plugin-mount serve needs a plain slug, got ${JSON.stringify(slug)}`);
		const vfsPath = `${PLUGINS_VFS_BASE}/${slug}`;
		return {
			// `start` keeps WordPress (including SQLite and uploads) in Playground's
			// per-directory site storage. The runner's cwd is this checkout, so
			// each site gets its own installation and Stop/Start reuses it. The
			// `server` command would discard that state at every stop. Let the CLI
			// choose download vs reuse; keep our explicit plugin mount and slug.
			command: 'start',
			autoMount: false,
			skipBrowser: true,
			mount: [{ hostPath: cfg.pluginDir, vfsPath }],
			'mount-before-install': [],
			'additional-blueprint-steps': [{ step: 'activatePlugin', pluginPath: vfsPath }]
		};
	}

	// 'docroot' (default): the build dir is the whole WordPress install. Exactly
	// the options the runner sent before strategies existed, no empty arrays
	// added: the CLI normalises a missing `mount` and a missing steps list to
	// the same thing, but the Core path is asserted byte for byte and stays
	// literally unchanged.
	if (!cfg.docroot) throw new Error('docroot serve needs a docroot');
	return {
		'mount-before-install': [{ hostPath: cfg.docroot, vfsPath: WORDPRESS_VFS_ROOT }],
		wordpressInstallMode: 'install-from-existing-files-if-needed'
	};
}

// The wp-config constants that depend on what the site is, on top of the shared
// debug/SMTP set.
//
// Every strategy gets the environment Core's own Docker environment sets up
// (#598): `.env.example` in wordpress-develop defaults WP_ENVIRONMENT_TYPE to
// `local` and WP_DEVELOPMENT_MODE to `core`, and the handbook documents that
// environment. Left undefined, the type falls back to `production`, and Core
// offers Application Passwords only over HTTPS or on a `local` site, so on the
// dev server's plain http://127.0.0.1 a ticket about them could not be tested.
// Any type but `production` also changes what a site does, and a contributor
// can meet it: pingbacks and trackbacks are off, in and out, and Site Health
// skips its page cache and object cache tests, drops the HTTPS test, and rates
// errors shown to visitors as recommended rather than critical. Core's Docker
// environment has all of that too, and a ticket about one of them needs the
// type changed on purpose: Core's own filters, from an mu-plugin in build/, do
// that per ticket better than a setting here would for every site. `local` itself also lets the screen that authorizes an
// application accept a plain-HTTP redirect URL, and would turn WP_DEBUG on by
// default, which the debug set decides anyway. Both values are strings,
// which is what Core compares them with, so they live here rather than in
// wp-debug-constants.js, whose values are all booleans; and the development
// mode follows from the strategy.
//
// The development mode is what the site is: a wordpress-develop checkout is
// Core development, and a Gutenberg checkout mounted into a stock WordPress is
// plugin development. `core` makes Core list its own blocks' stylesheets on
// every load instead of from a cached list kept until the version changes, so a
// block stylesheet added to or removed from build/ is picked up at once.
// `plugin` changes nothing in Core or Gutenberg today; it is set because it is
// the honest answer, and `core` would describe a Core checkout the site does
// not have. Neither value is a setting: there is nothing to choose that the
// site type does not already answer.
//
// 'plugin-mount' also asks for the two constants that make the mounted
// directory read-only from inside WordPress. The mount is a read-write NODEFS
// mount of the *source checkout*, not a regenerable build/, so Plugins → Delete
// on the mounted plugin, or the plugin file editor, writes straight through to
// the contributor's working tree, uncommitted work and .git included. Core's
// docroot strategy exposes only build/, which the app rebuilds, so it keeps
// WordPress's defaults.
//
// The cost is real and deliberate: DISALLOW_FILE_MODS also blocks installing a
// second plugin or theme into the preview. Losing an afternoon of uncommitted
// work is worse than restarting a preview you can restart.
function planServeConstants(config) {
	const cfg = config || {};
	if (cfg.strategy === 'plugin-mount') {
		return {
			WP_ENVIRONMENT_TYPE: 'local',
			WP_DEVELOPMENT_MODE: 'plugin',
			DISALLOW_FILE_MODS: true,
			DISALLOW_FILE_EDIT: true
		};
	}
	return { WP_ENVIRONMENT_TYPE: 'local', WP_DEVELOPMENT_MODE: 'core' };
}

module.exports = { planPlaygroundLaunch, planServeConstants, WORDPRESS_VFS_ROOT, PLUGINS_VFS_BASE };
