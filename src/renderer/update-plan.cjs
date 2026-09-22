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
// The update's build step while a resumed watch does the rebuild (#507): the
// step stays a real step, current until the watch's ready line, because the
// update is not complete until build/ is back and the card is what says so.
const UPDATE_BUILD_BY_RESUMED_WATCH_MESSAGE = 'The build watch is rebuilding — output in the Build watcher tab';

/**
 * The update chain always has the same three steps; the middle one is skipped
 * (but still shown, with an explicit message) when package-lock.json did not
 * change between the old and new trunk. Naming the skipped step is deliberate:
 * "update" should always mean the same thing to the contributor.
 *
 * The build step is never skipped, but who runs it can change: on a Gutenberg
 * site whose watch was paused for the update, the resumed watch rebuilds from
 * scratch anyway, so the update leaves the one build to it and the step names
 * the watch while it is current (`buildByWatcher`, #507). The step's status
 * still comes from the update state, so the card stays on step 3 until the
 * watch is watching again.
 *
 * @param {Object}               root0
 * @param {boolean}              [root0.lockfileChanged]
 * @param {null|'resumed-watch'} [root0.buildByWatcher]
 */
function planUpdateSteps({ lockfileChanged, buildByWatcher = null } = {}) {
	return [
		{ key: 'fetch', label: 'Fetch latest trunk', skipped: false },
		{
			key: 'install',
			label: 'Install dependencies',
			skipped: !lockfileChanged,
			skipMessage: SKIP_INSTALL_MESSAGE
		},
		{
			key: 'build',
			label: 'Rebuild',
			skipped: false,
			...(buildByWatcher === 'resumed-watch' ? { currentMessage: UPDATE_BUILD_BY_RESUMED_WATCH_MESSAGE } : {})
		}
	];
}

// Which chain step each renderer updateState is executing.
const STATE_TO_STEP = { fetching: 'fetch', installing: 'install', building: 'build' };

// What the update card says for each step in each status.
const UPDATE_STEP_LABELS = {
	fetch: { pending: 'Fetch and reset to trunk', current: 'Fetching and resetting to trunk…', complete: 'Fetched and reset to trunk' },
	install: { pending: 'Install dependencies', current: 'Dependencies changed — installing the difference…', complete: 'Dependencies installed', skipped: SKIP_INSTALL_MESSAGE },
	build: { pending: 'Rebuild', current: 'Rebuilding — output in the Terminal below', complete: 'Rebuilt' }
};

/**
 * The line the update card shows for one step. The status labels are the
 * table above; a step that names who runs it while current (the resumed watch,
 * #507) carries that in `currentMessage` and it wins while the step is current.
 * Unknown keys or statuses fall back to the pending label, then the key, so a
 * new state never renders an empty row.
 *
 * @param {Array}  steps        from planUpdateSteps
 * @param {Object} entry        one entry of updateStepStatuses
 * @param {string} entry.key
 * @param {string} entry.status
 * @return {string}
 */
function updateStepText(steps, { key, status } = {}) {
	const labels = UPDATE_STEP_LABELS[key] || {};
	const planned = (steps || []).find((step) => step.key === key);
	if (status === 'current' && planned && planned.currentMessage) return planned.currentMessage;
	return labels[status] || labels.pending || key;
}

// Applying someone else's patch (#11) is the same three-stage chain with a
// different first step, so it shares updateStepStatuses below. It lives here
// rather than beside the patch parsing because this module is the renderer's
// half and carries no dependencies — importing the parser into the bundle
// would drag the `diff` package in for two constants.
const APPLY_STATE_TO_STEP = { applying: 'apply', installing: 'install', building: 'build' };

const BUILD_BY_WATCHER_MESSAGE = 'The build watch will recompile the change';
const BUILD_BY_RESUMED_WATCH_MESSAGE = 'The build watch rebuilds when it resumes';

/**
 * The chain applying a patch runs. Like the update chain, the install step is
 * named even when skipped so "apply" always means the same thing. When a build
 * watch does the rebuild instead of this chain, the build step is skipped too,
 * with a message saying who is doing it: the running watch recompiling a
 * src-only patch (`live-watch`, #262), or a watch paused for the apply that
 * rebuilds from scratch when it resumes (`resumed-watch`, #506). A plain `true`
 * is the live case, so older callers keep their meaning.
 *
 * @param {Object}                                    root0
 * @param {boolean}                                   [root0.needsInstall]
 * @param {boolean|'live-watch'|'resumed-watch'|null} [root0.buildByWatcher]
 * @param {string}                                    [root0.kind]           `pr` when the first step checks out a PR.
 * @return {Array}
 */
function planApplySteps({ needsInstall, buildByWatcher, kind = 'patch' } = {}) {
	const firstLabels = { pr: 'Apply the pull request', 'leave-pr': 'Revert the pull request' };
	const buildSkipMessage = buildByWatcher === 'resumed-watch' ? BUILD_BY_RESUMED_WATCH_MESSAGE : BUILD_BY_WATCHER_MESSAGE;
	return [
		{ key: 'apply', label: firstLabels[kind] || 'Apply the patch', skipped: false },
		{ key: 'install', label: 'Install dependencies', skipped: !needsInstall, skipMessage: SKIP_INSTALL_MESSAGE },
		{ key: 'build', label: 'Rebuild', skipped: Boolean(buildByWatcher), skipMessage: buildSkipMessage }
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
 * How applying a patch, checking out a pull request, restoring saved work or
 * updating trunk should treat a running build watch (#247, #262, #506, #507).
 * A watch that is running already recompiles src/ on save, so a patch that only
 * touches src/ needs no build of its own and no interruption: apply it and let
 * the watch pick it up.
 * Anything that has to install dependencies or run a full build needs the build
 * directory and node_modules to itself, so the watch is paused for the duration
 * and resumed after. A whole-tree switch (`wholeTree`: a pull request checkout,
 * leaving one, restoring saved work, a trunk reset) rewrites far more than a
 * src/ patch and always pauses a live watch.
 *
 * Which build runs after a pause depends on what the watch does when it comes
 * back. Core's `grunt _watch` starts watching and touches nothing, so the apply
 * has to build. Gutenberg's `npm run dev` removes build/ and rebuilds every
 * package before it watches (`watchRebuildsOnStart`, the registry's
 * readyPattern), and it cannot be told not to, so a build run by the apply is
 * thrown away the moment the watch resumes: two full builds back to back (#506).
 * There the apply skips its own build and the resumed watch does the one build;
 * `buildBy` says so, for the step panel and the confirmation that waits on it.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.needsInstall]         the patch/update changes the lockfile
 * @param {boolean} [root0.watcherActive]        a build watch is currently running
 * @param {boolean} [root0.watchRebuildsOnStart] the target's watch rebuilds build/ from scratch when started
 * @param {boolean} [root0.wholeTree]            a pull request checkout, leave, restore or trunk reset, not a patch
 * @return {{ pauseWatcher: boolean, runBuild: boolean, buildBy: null|'live-watch'|'resumed-watch' }}
 */
function planWatchImpact({ needsInstall, watcherActive, watchRebuildsOnStart = false, wholeTree = false } = {}) {
	const active = Boolean(watcherActive);
	// A live watch takes a src-only patch as it is; a whole-tree switch never
	// leaves it running.
	if (active && !wholeTree && !needsInstall) {
		return { pauseWatcher: false, runBuild: false, buildBy: 'live-watch' };
	}
	// From here any live watch is paused for what follows (install, checkout,
	// build). Whether the apply builds depends on what the resumed watch does.
	if (active && watchRebuildsOnStart) {
		return { pauseWatcher: true, runBuild: false, buildBy: 'resumed-watch' };
	}
	return { pauseWatcher: active, runBuild: true, buildBy: null };
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
	BUILD_BY_RESUMED_WATCH_MESSAGE,
	UPDATE_BUILD_BY_RESUMED_WATCH_MESSAGE,
	STATE_TO_STEP,
	APPLY_STATE_TO_STEP,
	SETUP_STATE_TO_STEP,
	planApplySteps,
	planWatchImpact,
	planSetupSteps,
	trunkAgeInfo,
	planUpdateSteps,
	updateStepStatuses,
	updateStepText,
	setupOutcome,
	updateOutcome
};
