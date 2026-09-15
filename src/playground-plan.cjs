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
			// No wordpressInstallMode: Playground's default downloads and installs
			// a stock WordPress for the plugin to live in. The first serve needs
			// the network for that release zip; Playground caches it under
			// ~/.wordpress-playground afterwards, so later serves work offline,
			// unlike Core's docroot, which never downloads at all.
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

// The wp-config constants a strategy needs on top of the shared debug/SMTP set.
//
// Only 'plugin-mount' asks for any, and it asks for the two that make the
// mounted directory read-only from inside WordPress. The mount is a read-write
// NODEFS mount of the *source checkout*, not a regenerable build/, so
// Plugins → Delete on the mounted plugin, or the plugin file editor, writes
// straight through to the contributor's working tree, uncommitted work and .git
// included. Core's docroot strategy exposes only build/, which the app rebuilds,
// so it keeps WordPress's defaults.
//
// The cost is real and deliberate: DISALLOW_FILE_MODS also blocks installing a
// second plugin or theme into the preview. Losing an afternoon of uncommitted
// work is worse than restarting a preview you can restart.
function planServeConstants(config) {
	const cfg = config || {};
	if (cfg.strategy === 'plugin-mount') {
		return { DISALLOW_FILE_MODS: true, DISALLOW_FILE_EDIT: true };
	}
	return {};
}

module.exports = { planPlaygroundLaunch, planServeConstants, WORDPRESS_VFS_ROOT, PLUGINS_VFS_BASE };
