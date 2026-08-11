'use strict';

// planPlaygroundLaunch is the pure seam that turns a serve strategy into the
// @wp-playground/cli mount/install options (#251). Booting WASM PHP is an
// integration concern; this pins the option shape both strategies produce so a
// regression in either is caught without a real WordPress.
//
// The expected shapes mirror @wp-playground/cli's own --auto-mount handling: a
// plugin is a `mount` under wp-content/plugins plus an `activatePlugin` step
// with the default (download-and-install) WordPress; a WordPress docroot is a
// `mount-before-install` at /wordpress with install-from-existing-files.

const test = require('node:test');
const assert = require('node:assert/strict');
const { planPlaygroundLaunch, PLUGINS_VFS_BASE } = require('../src/playground-plan.cjs');
const { getProjectType } = require('../src/project-type.cjs');

test('docroot strategy mounts the build dir as WordPress and skips the download', () => {
	const plan = planPlaygroundLaunch({ strategy: 'docroot', docroot: '/sites/wp/build' });

	assert.deepEqual(plan['mount-before-install'], [{ hostPath: '/sites/wp/build', vfsPath: '/wordpress' }]);
	assert.deepEqual(plan.mount, []);
	assert.deepEqual(plan['additional-blueprint-steps'], []);
	// The mounted build/ already is WordPress; a fresh download would unpack a
	// second one over the mount.
	assert.equal(plan.wordpressInstallMode, 'install-from-existing-files-if-needed');
});

test('plugin-mount strategy mounts the checkout as an active plugin in a stock WordPress', () => {
	const plan = planPlaygroundLaunch({ strategy: 'plugin-mount', pluginDir: '/sites/gb', pluginSlug: 'gutenberg' });

	assert.deepEqual(plan.mount, [{ hostPath: '/sites/gb', vfsPath: '/wordpress/wp-content/plugins/gutenberg' }]);
	assert.deepEqual(plan['mount-before-install'], []);
	assert.deepEqual(plan['additional-blueprint-steps'], [
		{ step: 'activatePlugin', pluginPath: '/wordpress/wp-content/plugins/gutenberg' }
	]);
	// No install-mode override: Playground downloads and installs a real
	// WordPress for the plugin to run in.
	assert.equal(plan.wordpressInstallMode, undefined);
});

test('the plugin is mounted under the plugins base path', () => {
	const plan = planPlaygroundLaunch({ strategy: 'plugin-mount', pluginDir: '/x', pluginSlug: 'my-plugin' });
	assert.equal(plan.mount[0].vfsPath, `${PLUGINS_VFS_BASE}/my-plugin`);
});

test('an unknown strategy is treated as docroot', () => {
	// Defense in depth against a serve config that lost its strategy: fall back to
	// the Core behaviour rather than throwing on a missing branch.
	const plan = planPlaygroundLaunch({ docroot: '/x/build' });
	assert.deepEqual(plan['mount-before-install'], [{ hostPath: '/x/build', vfsPath: '/wordpress' }]);
});

test('each strategy validates the path it needs', () => {
	assert.throws(() => planPlaygroundLaunch({ strategy: 'plugin-mount' }), /pluginDir/);
	assert.throws(() => planPlaygroundLaunch({ strategy: 'docroot' }), /docroot/);
	assert.throws(() => planPlaygroundLaunch({}), /docroot/);
});

// The registry drives which strategy each project type gets — this ties the
// serve plan back to the project-type config the handler actually reads.
test('the project-type registry selects the strategy per target', () => {
	assert.equal(getProjectType('core').serve.strategy, 'docroot');
	assert.equal(getProjectType('gutenberg').serve.strategy, 'plugin-mount');
	assert.equal(getProjectType('gutenberg').serve.pluginSlug, 'gutenberg');
});
