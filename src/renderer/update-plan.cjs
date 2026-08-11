'use strict';

/**
 * Decision logic for the "Update to latest trunk" feature (issue #94): how old
 * a site's trunk snapshot is, which steps an update runs, and how the chain
 * ends.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as setup-steps.cjs and dev-server-command.cjs).
 */

// A site older than this shows the staleness dot and notice. Local-only:
// staleness is judged from the snapshot's own age, never from a network probe,
// so it works offline and never talks to GitHub on app launch. A spuriously
// stale site just gets "Already up to date." when the user clicks Update.
const STALE_THRESHOLD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Describes the age of a site's trunk snapshot from its stored commit date.
 * Unknown or invalid dates are never reported stale — a missing date means an
 * older site record, not an old checkout.
 *
 * @param {Object} root0
 * @param {string} [root0.trunkDate]
 * @param {number} [root0.now]
 */
function trunkAgeInfo({ trunkDate, now = Date.now() } = {}) {
	const ts = trunkDate ? Date.parse(trunkDate) : NaN;
	if (!Number.isFinite(ts)) {
		return { known: false, ageDays: null, stale: false, label: '' };
	}
	const ageDays = Math.max(0, Math.floor((now - ts) / DAY_MS));
	const label = `trunk as of ${new Date(ts).toLocaleDateString(undefined, {
		year: 'numeric', month: 'short', day: 'numeric'
	})}`;
	return { known: true, ageDays, stale: ageDays > STALE_THRESHOLD_DAYS, label };
}

const SKIP_INSTALL_MESSAGE = 'Dependencies unchanged — skipping npm install';

/**
 * The update chain always has the same three steps; the middle one is skipped
 * (but still shown, with an explicit message) when package-lock.json did not
 * change between the old and new trunk. Naming the skipped step is deliberate:
 * "update" should always mean the same thing to the contributor.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.lockfileChanged]
 */
function planUpdateSteps({ lockfileChanged } = {}) {
	return [
		{ key: 'fetch', label: 'Fetch latest trunk', skipped: false },
		{
			key: 'install',
			label: 'Install dependencies',
			skipped: !lockfileChanged,
			skipMessage: SKIP_INSTALL_MESSAGE
		},
		{ key: 'build', label: 'Rebuild', skipped: false }
	];
}

// Which chain step each renderer updateState is executing.
const STATE_TO_STEP = { fetching: 'fetch', installing: 'install', building: 'build' };

// Applying someone else's patch (#11) is the same three-stage chain with a
// different first step, so it shares updateStepStatuses below. It lives here
// rather than beside the patch parsing because this module is the renderer's
// half and carries no dependencies — importing the parser into the bundle
// would drag the `diff` package in for two constants.
const APPLY_STATE_TO_STEP = { applying: 'apply', installing: 'install', building: 'build' };

const BUILD_BY_WATCHER_MESSAGE = 'The build watch will recompile the change';

/**
 * The chain applying a patch runs. Like the update chain, the install step is
 * named even when skipped so "apply" always means the same thing. When the
 * running build watch will recompile the change (a src-only patch, #262), the
 * build step is skipped too — with a message saying who is doing it instead.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.needsInstall]
 * @param {boolean} [root0.buildByWatcher]
 * @return {Array}
 */
function planApplySteps({ needsInstall, buildByWatcher } = {}) {
	return [
		{ key: 'apply', label: 'Apply the patch', skipped: false },
		{ key: 'install', label: 'Install dependencies', skipped: !needsInstall, skipMessage: SKIP_INSTALL_MESSAGE },
		{ key: 'build', label: 'Rebuild', skipped: Boolean(buildByWatcher), skipMessage: BUILD_BY_WATCHER_MESSAGE }
	];
}

/**
 * How applying a patch (or updating trunk) should treat a running build watch
 * (#247, #262). A watch that is running already recompiles src/ on save, so a
 * patch that only touches src/ needs no build of its own and no interruption —
 * apply it and let the watch pick it up. Anything that has to install
 * dependencies or run a full build needs the build directory and node_modules
 * to itself, so the watch is paused for the duration and resumed after.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.needsInstall]  the patch/update changes the lockfile
 * @param {boolean} [root0.watcherActive] a build watch is currently running
 * @return {{ pauseWatcher: boolean, runBuild: boolean }}
 */
function planWatchImpact({ needsInstall, watcherActive } = {}) {
	// A full build runs unless a live watch can do the recompile instead.
	const runBuild = Boolean(needsInstall) || !watcherActive;
	// Pause only when we run a build/install ourselves and a watch is live to
	// collide with it; a src-only patch with a watch never pauses.
	const pauseWatcher = Boolean(watcherActive) && runBuild;
	return { pauseWatcher, runBuild };
}

/**
 * Maps the chain steps to checklist visual states for a given renderer
 * updateState. Steps before the current one are complete, the current one is
 * current, later ones pending; skipped steps stay 'skipped' once passed.
 *
 * The state→step map is a parameter so a different chain can reuse this: the
 * applying chain (#11) has the same three-stage shape with its own state names.
 *
 * @param {Array}  steps
 * @param {string} updateState
 * @param {Object} [stateToStep]
 */
function updateStepStatuses(steps, updateState, stateToStep = STATE_TO_STEP) {
	const activeKey = stateToStep[updateState] || null;
	const order = steps.map((s) => s.key);
	let activeIndex = -1;
	if (activeKey) {
		activeIndex = order.indexOf(activeKey);
	} else if (updateState === 'done') {
		activeIndex = steps.length;
	}
	return steps.map((step, i) => {
		if (step.skipped && i < activeIndex) return { key: step.key, status: 'skipped' };
		if (i < activeIndex) return { key: step.key, status: 'complete' };
		if (i === activeIndex) return { key: step.key, status: 'current' };
		return { key: step.key, status: 'pending' };
	});
}

/**
 * How the chain ended. 'incomplete' is the state worth its own name: trunk
 * moved but install/build failed, so the code is new while the built assets
 * are old — the site may not run until install+build succeed.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.fetchOk]
 * @param {boolean} [root0.upToDate]
 * @param {boolean} [root0.moved]
 * @param {boolean} [root0.installNeeded]
 * @param {number}  [root0.installCode]
 * @param {number}  [root0.buildCode]
 */
function updateOutcome({ fetchOk, upToDate, moved, installNeeded, installCode, buildCode } = {}) {
	if (!fetchOk) return 'failed-fetch';
	if (upToDate) return 'up-to-date';
	if (!moved) return 'failed-fetch';
	if (installNeeded && installCode !== 0) return 'incomplete';
	if (buildCode !== 0) return 'incomplete';
	return 'done';
}

module.exports = {
	STALE_THRESHOLD_DAYS,
	SKIP_INSTALL_MESSAGE,
	BUILD_BY_WATCHER_MESSAGE,
	STATE_TO_STEP,
	APPLY_STATE_TO_STEP,
	planApplySteps,
	planWatchImpact,
	trunkAgeInfo,
	planUpdateSteps,
	updateStepStatuses,
	updateOutcome
};
