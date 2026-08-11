'use strict';

/**
 * Decision logic for the "Update to latest trunk" feature (issue #94): how old
 * a site's trunk snapshot is, which steps an update runs, and how the chain
 * ends.
 *
 * It has since become the home of every multi-step chain the renderer runs —
 * updating (#94), applying a patch (#11) and initial setup (#246) — because all
 * three share `updateStepStatuses` and the same outcome vocabulary. Keeping the
 * three plans beside the machinery they share is what stops a fourth chain
 * growing its own.
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

// Initial setup (#246) is the third chain, and the one the contributor does not
// start: it runs on its own the moment the clone finishes, so a newcomer who
// walks away comes back to a built environment instead of a checklist waiting
// on two clicks with no decision between them.
const SETUP_STATE_TO_STEP = { cloning: 'download', installing: 'install', building: 'build' };

/**
 * The chain initial setup runs. Nothing is ever skipped here: a fresh clone has
 * no node_modules and no build, so both always run — the `skipped` field is kept
 * only so the three plans share one shape.
 *
 * Starting the dev server is deliberately not part of it. It is the step that
 * marks the initialization wizard finished and hands the contributor to a
 * WordPress setup wizard in a browser, so running it unattended would end the
 * checklist on their behalf and leave a server listening that nobody asked for.
 *
 * @return {Array}
 */
function planSetupSteps() {
	return [
		{ key: 'download', label: 'Download WordPress', skipped: false },
		{ key: 'install', label: 'Install dependencies', skipped: false },
		{ key: 'build', label: 'Run full build', skipped: false }
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
 * applying chain (#11) has the same three-stage shape with its own state names,
 * and the setup chain (#246) uses it for its progress counter.
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

/**
 * How the setup chain ended, and the only thing that decides what the
 * contributor is told. `stopped` is separated from `failed-install` /
 * `failed-build` on purpose: a chain the contributor stopped is not a problem to
 * report, and telling someone their install "failed" when they pressed Stop is
 * how a tool loses their trust.
 *
 * A stop and a failure are otherwise indistinguishable from the exit code — a
 * killed npm exits non-zero, and on Windows without even a signal — so the
 * caller passes `stopped` from the fact that it asked for the kill, not from
 * what the process did.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.stopped]     The contributor pressed Stop.
 * @param {number}  [root0.installCode] Exit code of npm install, if it ran.
 * @param {number}  [root0.buildCode]   Exit code of npm run build, if it ran.
 * @return {string}
 */
function setupOutcome({ stopped, installCode, buildCode } = {}) {
	if (stopped) return 'stopped';
	if (installCode !== 0) return 'failed-install';
	if (buildCode !== 0) return 'failed-build';
	return 'done';
}

module.exports = {
	STALE_THRESHOLD_DAYS,
	SKIP_INSTALL_MESSAGE,
	BUILD_BY_WATCHER_MESSAGE,
	STATE_TO_STEP,
	APPLY_STATE_TO_STEP,
	SETUP_STATE_TO_STEP,
	planApplySteps,
	planWatchImpact,
	planSetupSteps,
	trunkAgeInfo,
	planUpdateSteps,
	updateStepStatuses,
	setupOutcome,
	updateOutcome
};
