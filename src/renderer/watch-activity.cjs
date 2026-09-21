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
 * The watch's first line can arrive late: chokidar waits for writes to
 * settle, and a large checkout on a slow disk takes a while to write. Output
 * within `graceMs` of the hand-off therefore reopens a window that the quiet
 * rule had already closed, so the banner does not say "done" as the rebuild
 * starts. Output later than that is some other rebuild's.
 *
 * Pure: the clock is injected so the suite can drive it.
 *
 * @param {{quietMs?: number, graceMs?: number}} [options]
 * @return {{handOff: (now: number) => void, output: (now: number) => void, clear: () => void, isCompiling: (now: number) => boolean, settlesAt: () => number|null}}
 */
function createWatchActivity({ quietMs = 3000, graceMs = 15000 } = {}) {
	let handOffAt = null;
	let lastActivity = null;
	return {
		// A change was just left to the watch.
		handOff(now) {
			handOffAt = now;
			lastActivity = now;
		},
		// The watch printed something. Counts while a hand-off is open, and
		// reopens one that the quiet rule closed within the grace period.
		output(now) {
			if (handOffAt === null) return;
			if (now - handOffAt >= graceMs && !(now - lastActivity < quietMs)) return;
			if (now > lastActivity) lastActivity = now;
		},
		// The watch stopped, paused or exited: nothing is compiling.
		clear() {
			handOffAt = null;
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

/**
 * What the applied banner says about the watch, or null when nothing needs
 * saying. Two stretches matter:
 *
 * - The watch is rebuilding from scratch ('building'): a pull-request checkout
 *   pauses it for the app's own build and resumes it after, and on Gutenberg
 *   the resumed `npm run dev` removes build/ and rebuilds for about 20 s,
 *   during which the site answers with the "requires files to be built"
 *   notice (#489). The banner is up by then, so it has to say so.
 * - The watch is compiling a change handed to it (`compiling`, above).
 *
 * @param {string}  watchState 'idle' | 'building' | 'watching' | 'paused' | 'exited'
 * @param {boolean} compiling  from createWatchActivity().isCompiling
 * @return {string|null}
 */
function watchBusyMessage(watchState, compiling) {
	if (watchState === 'building') return 'The build watch is rebuilding after this change. Wait for the Build watcher tab to say (watching) before trying the site.';
	if (watchState === 'watching' && compiling) return compilingMessage();
	return null;
}

/**
 * The terminal line that ends an apply, given what the watch is doing once it
 * has been resumed. An apply that ran the app's own build ends on "open the
 * site to try it out"; when the resumed watch is rebuilding from scratch that
 * is not yet true, so the invitation is dropped and the rebuilding line
 * follows instead of contradicting it.
 *
 * @param {string} message    the line the apply would print on its own
 * @param {string} watchState the watch state after the resume
 * @return {string}
 */
function applyFinishMessage(message, watchState) {
	const busy = watchBusyMessage(watchState, false);
	if (!busy) return message;
	return `${message.replace(/ — open the site to try it out\./, '.')}${busy}\n`;
}

/**
 * What an apply says when it leaves the one build to the watch it paused
 * (#506): a watch that rebuilds build/ from scratch when it resumes makes a
 * build of the apply's own redundant, so the apply resumes it and waits for
 * its ready line before confirming. `waits` is false when there is no paused
 * watch to resume (stopped by hand while the apply ran), and then `stopped`
 * is the whole story; otherwise `ready` is the line for the ready pattern and
 * `failed` the line for a watch that exits before it.
 *
 * @param {string} verb       'Checked out', 'Restored', 'Applied', 'Reverted'
 * @param {string} noun       'pull request', 'previous branch', 'saved work', 'patch'
 * @param {string} watchState the watch state at the hand-off
 * @return {{waits: boolean, stopped?: string, ready?: string, failed?: string}}
 */
function resumedWatchHandOff(verb, noun, watchState) {
	const done = `The ${noun} is ${verb.toLowerCase()}`;
	const stale = 'so the site still runs the old assets. Start the build watch, or run npm run build in the Terminal below.';
	if (watchState !== 'paused') {
		return { waits: false, stopped: `\n${done} but the build watch was stopped, ${stale}\n` };
	}
	return {
		waits: true,
		ready: `\n${verb} — the build watch has rebuilt. Open the site to try it out.\n`,
		failed: `\n${done} but the build watch stopped before it finished rebuilding, ${stale}\n`
	};
}

module.exports = { createWatchActivity, compilingMessage, watchBusyMessage, applyFinishMessage, resumedWatchHandOff };
