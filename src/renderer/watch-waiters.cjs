'use strict';

/**
 * Who is waiting for the build watch to be ready to serve behind, and when
 * the watch counts as occupying build/.
 *
 * The dev-server start hangs off the watcher's readiness, and on a target
 * whose watcher rebuilds build/ before it watches (Gutenberg's `npm run dev`,
 * #488) that readiness arrives from the watcher's output, well after its
 * process has started. Between the two, requests to start the server have to
 * be held somewhere and answered exactly once, ready or failed. This module
 * is that somewhere, kept out of `index.jsx` so the sequencing has a test.
 */

/**
 * Whether the watch is using build/ right now: watching it, or in the build
 * that precedes watching. Both the one-off `npm run build` on an unbuilt site
 * and a watcher's own initial rebuild put the state at 'building', and an
 * operation that needs build/ to itself (a patch install, a trunk update,
 * #262) has to pause the watch in either case, not only once it is watching.
 *
 * @param {string} state The watch lifecycle state ('idle' | 'building' | 'watching' | 'paused' | 'exited').
 * @return {boolean}
 */
function watchOccupiesBuild(state) {
	return state === 'watching' || state === 'building';
}

/**
 * A queue of { onReady, onFail } pairs, settled all at once.
 *
 * `settle(true)` calls every onReady, `settle(false)` every onFail; either
 * empties the queue first, so a callback that adds a new waiter (a retry)
 * lands in the next round, and a throwing callback does not keep the rest
 * from being called. A second settle with nothing queued is a no-op, which
 * is what lets the watcher's exit handler and a manual stop both call it
 * without checking who got there first.
 *
 * @return {{add: (onReady?: Function, onFail?: Function) => void, settle: (ready: boolean) => number, size: () => number}}
 */
function createWatchWaiters() {
	let waiters = [];
	return {
		add(onReady, onFail) {
			if (!onReady && !onFail) return;
			waiters.push({ onReady, onFail });
		},
		settle(ready) {
			const due = waiters;
			waiters = [];
			for (const waiter of due) {
				const fn = ready ? waiter.onReady : waiter.onFail;
				if (typeof fn !== 'function') continue;
				try { fn(); } catch { /* one waiter's error must not starve the next */ }
			}
			return due.length;
		},
		size() {
			return waiters.length;
		}
	};
}

/**
 * Which watcher run is the current one, so a callback from a replaced run can
 * tell it is stale and leave the state alone.
 *
 * Stopping a run is asynchronous: `npmKill` returns once the signal is sent,
 * and the process reports its exit later (up to the 3 s escalation when a
 * descendant ignores SIGTERM, as Gutenberg's `tsc` does). A run started in
 * between inherits the old run's late `onDone`, which would mark it exited and
 * fail the server start queued behind it. Each start takes a token; every
 * stop, pause and teardown invalidates the current one; each callback checks
 * the token it was born with before touching anything.
 *
 * @return {{next: () => number, invalidate: () => void, isCurrent: (token: number) => boolean}}
 */
function createRunGeneration() {
	let current = 0;
	let started = false;
	return {
		next() {
			current += 1;
			started = true;
			return current;
		},
		invalidate() {
			current += 1;
			started = false;
		},
		isCurrent(token) {
			// Only a token next() handed out can be current: before the first
			// start, and after an invalidate, nothing is.
			return started && token === current;
		}
	};
}

module.exports = { createWatchWaiters, createRunGeneration, watchOccupiesBuild };
