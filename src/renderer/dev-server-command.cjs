'use strict';

/**
 * Decides what starting the dev server has to run, from whether the site
 * already has a completed build and which target it is a checkout of.
 *
 * Kept as a pure module so it can be unit tested without a DOM: the renderer
 * bundle imports it, `node --test` requires it directly (same convention as
 * setup-steps.cjs). Its one dependency is the project-type registry, which
 * is pure too.
 *
 * The watcher command is the target's (#251): Core's is `grunt -- _watch`,
 * Gutenberg's is `npm run dev`. The registry holds each with the reasoning
 * beside it; what this module decides is only whether a build has to run
 * first. Sites without a completed build need one, so they get `npm run
 * build`, whose exit code is a real completion signal, before the watcher
 * starts.
 */

const { getProjectType } = require('../project-type.cjs');

/**
 * `build` is the registry's `build` entry for the site's type. It defaults to
 * Core's, so a caller that does not know the type gets what every site got
 * before.
 *
 * @param {{hasBuilt?: boolean}}                                     [flags]
 * @param {{watch: {script: string, args: string[], label: string}}} [build]
 * @return {{needsBuild: boolean, watch: {script: string, args: string[], label: string}}}
 */
function planDevServerStart(flags = {}, build = getProjectType().build) {
	const hasBuilt = Boolean(flags.hasBuilt);
	return {
		// True when `npm run build` must run (and exit 0) before the watcher
		// and the server may start.
		needsBuild: !hasBuilt,
		watch: {
			script: build.watch.script,
			args: build.watch.args.slice(),
			label: build.watch.label,
			// The line the watcher prints once it is safe to serve, or null when
			// it is safe from the start. See createWatchReadyDetector.
			readyPattern: typeof build.watch.readyPattern === 'string' && build.watch.readyPattern ? build.watch.readyPattern : null
		}
	};
}

/**
 * Tells, from the watcher's output, when the server may start.
 *
 * A watcher that rebuilds `build/` from scratch before it watches (Gutenberg's
 * `npm run dev`, #488) is not ready when its process is: it is ready when it
 * prints the registry's `readyPattern`. One with no pattern (Core's `grunt --
 * _watch`) is ready as soon as it starts, and `immediate` says so.
 *
 * `feed` takes the output as it streams, in whatever chunks the pipe delivers,
 * and returns true once the pattern has been seen. The pattern may straddle two
 * chunks, so the detector keeps the tail of the last one; and it fires once
 * only, because wp-build prints the same line after every rebuild and the
 * server must not be started twice.
 *
 * @param {string|null} [readyPattern]
 * @return {{immediate: boolean, ready: boolean, feed: (chunk: string) => boolean}}
 */
function createWatchReadyDetector(readyPattern) {
	const pattern = typeof readyPattern === 'string' && readyPattern ? readyPattern : null;
	const detector = {
		immediate: pattern === null,
		ready: pattern === null,
		feed(chunk) {
			if (detector.ready) return false;
			tail += String(chunk === null || chunk === undefined ? '' : chunk);
			if (tail.includes(pattern)) {
				detector.ready = true;
				tail = '';
				return true;
			}
			// Keep only what a pattern split across chunks could still need.
			if (tail.length > pattern.length) tail = tail.slice(tail.length - (pattern.length - 1));
			return false;
		}
	};
	let tail = '';
	return detector;
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

/**
 * The title for the build-watcher log tab, from its lifecycle state. The tab is
 * always present, so its title is where the watcher's state is shown: a
 * contributor can tell at a glance whether `src/` edits are being compiled,
 * paused for another operation, or stopped — without opening the tab.
 *
 * `exitCode` is only meaningful when `state` is 'exited'. `compiling` is
 * whether the watch is still compiling a change just handed to it (#492,
 * watch-activity.cjs); it only reads on a watching watch.
 *
 * @param {'idle'|'watching'|'building'|'paused'|'exited'} state
 * @param {number|null}                                    [exitCode]
 * @param {boolean}                                        [compiling]
 * @return {string}
 */
function watchTabLabel(state, exitCode, compiling = false) {
	switch (state) {
		case 'watching': return compiling ? 'Build watcher (compiling)' : 'Build watcher (watching)';
		case 'building': return 'Build watcher (building)';
		case 'paused': return 'Build watcher (paused)';
		case 'exited': {
			const code = Number.isFinite(exitCode) ? exitCode : null;
			return code === null ? 'Build watcher (stopped)' : `Build watcher (exited ${code})`;
		}
		case 'idle':
		default: return 'Build watcher';
	}
}

module.exports = { planDevServerStart, createWatchReadyDetector, formatElapsed, watchTabLabel };
