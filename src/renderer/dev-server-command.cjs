'use strict';

/**
 * Decides what starting the dev server has to run, from whether the site
 * already has a completed build.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as setup-steps.cjs).
 *
 * Why the watcher is `grunt -- _watch` and not `npm run watch`:
 * wordpress-develop's Gruntfile renames the real watch task to `_watch` and
 * registers a `watch` wrapper that runs the entire production `build` task
 * first when invoked without arguments. On a site that has already completed
 * the wizard's full build that rebuild has nothing to do, yet it is where
 * tens of minutes go on every dev-server start (30+ on a Windows VM).
 * Invoking `_watch` through the `grunt` passthrough script starts the same
 * watchers immediately. Sites without a completed build still need one, so
 * they get `npm run build` — whose exit code is a real completion signal —
 * before the watcher starts.
 *
 * The `'--'` in the watcher args is load-bearing: script-runner.js
 * deliberately does not insert a separator, and without one npm consumes
 * `_watch` as its own argument and runs bare `grunt` — the default task,
 * i.e. a full build with no watcher.
 */

const WATCH_SCRIPT = 'grunt';
const WATCH_ARGS = ['--', '_watch'];
const WATCH_COMMAND_LABEL = 'npm run grunt -- _watch';

function planDevServerStart(flags = {}) {
	const hasBuilt = Boolean(flags.hasBuilt);
	return {
		// True when `npm run build` must run (and exit 0) before the watcher
		// and the server may start.
		needsBuild: !hasBuilt,
		watch: {
			script: WATCH_SCRIPT,
			args: WATCH_ARGS.slice(),
			label: WATCH_COMMAND_LABEL
		}
	};
}

/**
 * Formats a duration in whole seconds for the "Starting dev server…" counter:
 * '42s' under a minute, '3m 05s' above. The counter exists so a contributor on
 * a slow machine can tell a boot in progress from a hang (issue #73).
 *
 * @param {number} seconds
 * @return {string}
 */
function formatElapsed(seconds) {
	const total = Math.max(0, Math.floor(Number(seconds) || 0));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	const rest = total % 60;
	return `${minutes}m ${String(rest).padStart(2, '0')}s`;
}

module.exports = { planDevServerStart, formatElapsed };
