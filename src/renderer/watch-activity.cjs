'use strict';

/**
 * Whether the build watch is still compiling a change that was just handed
 * to it, so the screen can say so (#492).
 *
 * A patch or pull request applied while the watch runs gets no build of its
 * own: the checkout happens and the watch recompiles what changed (#262). On
 * Core that takes a second; Gutenberg's `npm run dev` takes seconds per
 * package. Neither watcher prints a line when it is done again (wp-build
 * prints one `✅ package (…ms)` per package and then nothing; grunt prints
 * `Waiting...`), so "done" is the watch's output going quiet: `quietMs` of
 * silence after the hand-off, or after the last line it printed, whichever
 * is later. A change the watch has nothing to compile (PHP only) clears
 * after the same `quietMs` with no output at all.
 *
 * Pure: the clock is injected so the suite can drive it.
 *
 * @param {{quietMs?: number}} [options]
 * @return {{handOff: (now: number) => void, output: (now: number) => void, clear: () => void, isCompiling: (now: number) => boolean, settlesAt: () => number|null}}
 */
function createWatchActivity({ quietMs = 3000 } = {}) {
	let lastActivity = null;
	return {
		// A change was just left to the watch.
		handOff(now) {
			lastActivity = now;
		},
		// The watch printed something. Only counts while a hand-off is open.
		output(now) {
			if (lastActivity !== null && now > lastActivity) lastActivity = now;
		},
		// The watch stopped, paused or exited: nothing is compiling.
		clear() {
			lastActivity = null;
		},
		isCompiling(now) {
			return lastActivity !== null && now - lastActivity < quietMs;
		},
		// When the current hand-off counts as done if nothing else is printed,
		// or null when nothing is compiling.
		settlesAt() {
			return lastActivity === null ? null : lastActivity + quietMs;
		}
	};
}

/**
 * The line the applied banner shows while the watch compiles the change.
 *
 * @return {string}
 */
function compilingMessage() {
	return 'The build watch is still compiling this change. Wait for the Build watcher tab to go quiet before trying the site.';
}

module.exports = { createWatchActivity, compilingMessage };
