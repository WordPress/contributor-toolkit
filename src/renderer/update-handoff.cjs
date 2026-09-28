'use strict';

const { resumedWatchUpdateHandOff } = require('./watch-activity.cjs');

/**
 * The state a trunk update moves to when it leaves its build to the watch it
 * paused (#507), as three outcomes rather than three branches inside the
 * component.
 *
 * The update pauses the watch for the reset, and on a target whose watch
 * rebuilds build/ from scratch when it starts (Gutenberg's `npm run dev`) a
 * build of the chain's own would be thrown away the moment the watch resumes.
 * So the chain resumes it instead and lets that be the one build. Unlike an
 * apply, which is done as soon as the checkout is on disk (#506), an update is
 * not done until build/ matches the new source: `main.js` writes
 * `updateIncomplete` at the reset and only `markUpdateComplete` clears it, so
 * ending the chain at the hand-off would show the red banner for the whole
 * rebuild and call the update complete before it was.
 *
 * Hence three outcomes, each one a state to apply:
 *
 * - `finish`, when no paused watch will resume (stopped by hand during the
 *   install). Nothing rebuilds, so the update ends incomplete right away.
 * - `waiting`, applied at the hand-off: the card stays on step 3 naming the
 *   watch. Releasing the terminal lock stays in the component: it is a lock
 *   release, not a decision, and the watch writes to its own tab and holds no
 *   lock of its own.
 * - `ready` and `failed`, applied when the watch settles: its ready line means
 *   build/ is complete, so that is where the persisted marker, the summary and
 *   the toast go (`completesUpdate`); an exit before it leaves the update
 *   incomplete, with the banner and retry a failed build would have left.
 *
 * Kept out of `index.jsx` because a decision with more than one branch cannot
 * be reached by the suite there (see the renderer rule in
 * `.github/instructions/code-review.instructions.md`): the component is left
 * applying the state and wiring the callbacks.
 *
 * `completesUpdate` rides only on the two phases a callback branches on.
 *
 * @param {string} watchState the watch state at the hand-off
 * @return {{waits: boolean, finish?: Object, waiting?: Object, ready?: Object, failed?: Object}}
 */
function planUpdateHandOff(watchState) {
	const handOff = resumedWatchUpdateHandOff(watchState);
	if (!handOff.waits) {
		return { waits: false, finish: { message: handOff.stopped } };
	}
	return {
		waits: true,
		waiting: {
			updateState: 'building',
			waitingOnWatch: true,
			message: '\nThe build watch rebuilds build/ from scratch as it resumes — output in the Build watcher tab. The update completes when it is watching again.\n'
		},
		ready: {
			updateState: 'idle',
			waitingOnWatch: false,
			completesUpdate: true,
			message: handOff.ready
		},
		failed: {
			updateState: 'idle',
			waitingOnWatch: false,
			completesUpdate: false,
			message: handOff.failed
		}
	};
}

module.exports = { planUpdateHandOff };
