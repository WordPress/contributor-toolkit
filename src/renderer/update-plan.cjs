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

// How old a snapshot has to be before the calendar alone calls it stale.
//
// This used to be the *only* test, and the invariant written here said so:
// staleness was judged from the snapshot's own age and never from a network
// probe. That was chosen so the dot worked offline — but it answered the wrong
// question. Age is a proxy for distance from trunk, and it misses in both
// directions: a three-day-old snapshot can be dozens of commits behind in a
// busy week, and a two-week-old one can be nearly current.
//
// So since #307 the primary test is the remote's own answer: `src/trunk-remote.js`
// asks where `refs/heads/trunk` is (a refs lookup, not a fetch) in the main
// process, and the resulting oid arrives here as plain data — this module stays
// pure and DOM-free, and does no I/O of its own.
//
// The threshold survives as the fallback, and that is what keeps the offline
// promise intact: with no probe answer (offline, proxied, rate-limited, or
// simply not asked yet) the calendar decides exactly as it did before, and
// nothing waits on the network to render.
const STALE_THRESHOLD_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Describes a site's trunk snapshot: how old it is, and — when the remote has
 * been asked — whether trunk has actually moved past it.
 *
 * Unknown or invalid dates are never reported stale: a missing date means an
 * older site record, not an old checkout.
 *
 * `behind` is deliberately three-valued, because "we asked and trunk is where
 * this snapshot is" and "we could not ask" are different facts and lead to
 * different sentences:
 *
 * - `true`  — the remote's trunk oid differs from this snapshot's. Stale,
 *             whatever the calendar says.
 * - `false` — the remote's trunk oid is this snapshot's. NOT stale, even if the
 *             snapshot is months old: a quiet trunk is not an out-of-date one.
 * - `null`  — no answer to compare against; the calendar decides.
 *
 * A differing oid is read as "the remote has moved on" rather than "the two
 * have diverged" because the app only ever advances local `trunk` by fetching
 * this same remote — it commits contributor work to ticket branches (#108),
 * never to trunk.
 *
 * @param {Object}  root0
 * @param {string}  [root0.trunkDate]      Committer date of the local snapshot.
 * @param {?string} [root0.trunkOid]       Commit local `trunk` points at.
 * @param {?string} [root0.remoteTrunkOid] Commit the remote's trunk points at,
 *                                         from the last successful probe.
 * @param {number}  [root0.now]
 */
function trunkAgeInfo({ trunkDate, trunkOid, remoteTrunkOid, now = Date.now() } = {}) {
	const comparable = Boolean(trunkOid) && Boolean(remoteTrunkOid);
	const behind = comparable ? trunkOid !== remoteTrunkOid : null;

	const ts = trunkDate ? Date.parse(trunkDate) : NaN;
	if (!Number.isFinite(ts)) {
		// No date to show and none to judge by. The probe can still answer, and
		// when it does it is the whole answer — this is the site record that
		// predates the date being stored, not a young checkout.
		return { known: false, ageDays: null, stale: behind === true, label: '', behind, source: comparable ? 'remote' : 'calendar' };
	}
	const ageDays = Math.max(0, Math.floor((now - ts) / DAY_MS));
	const label = `trunk as of ${new Date(ts).toLocaleDateString(undefined, {
		year: 'numeric', month: 'short', day: 'numeric'
	})}`;
	const stale = comparable ? behind : ageDays > STALE_THRESHOLD_DAYS;
	return { known: true, ageDays, stale, label, behind, source: comparable ? 'remote' : 'calendar' };
}

/**
 * What the app should say about a stale snapshot, and whether it should say it
 * loudly. Every string the contributor reads about staleness is decided here,
 * so the renderer holds none of the branching.
 *
 * Two things this copy is careful about, and both are the reason it is a
 * function rather than a template in the view:
 *
 * **It does not nag toward destruction.** Updating parks the ticket and resets
 * the working tree, which takes an applied patch off disk with it (see the
 * applied-patch clearing in `src/main.js`'s `git:update-trunk`). So an applied
 * patch turns `recommendUpdate` false: the dot and the label still say trunk has
 * moved — the contributor is not kept in the dark — but the amber "you should
 * update" block and the next-action cue stay away, and the wording says what
 * updating would cost instead of urging it.
 *
 * Uncommitted edits are deliberately NOT treated the same way, and the
 * difference is not an oversight. An applied patch is removed by an update
 * without being asked about; edits are not — `startTrunkUpdate` asks the narrow
 * "is the worktree dirty" question first and opens a dialog that offers saving
 * them (#234). Work that cannot be lost without a prompt is not a reason to go
 * quiet, so it is stated in the copy instead of suppressing the advice. Which
 * also keeps this function away from a measure it would get wrong: the value
 * the panel holds is the branch-point one (#239), and it counts parked work a
 * force checkout survives.
 *
 * **It says what updating actually fixes: the site.** "Update to latest trunk"
 * moves the site's copy of WordPress. It does not move a ticket branch, which
 * keeps the base it was born at on purpose — a ticket's diff would otherwise
 * swallow everything trunk moved. Carrying a ticket forward is its own action
 * (#305), so the copy must never imply this one does it.
 *
 * The one moment worth interrupting for is *before* a ticket exists, which is
 * what `preLinkNote` is: updating first is the cheapest way to stop a ticket
 * being born on trunk it will have to fight later.
 *
 * @param {Object}  root0
 * @param {Object}  root0.trunkAge       The `trunkAgeInfo` result.
 * @param {boolean} [root0.appliedPatch] A patch is applied on this ticket.
 * @param {boolean} [root0.ticketLinked] A ticket is linked to this site.
 * @return {{recommendUpdate: boolean, atRisk: boolean, headline: string, detail: string, dotTitle: string, preLinkNote: string}}
 */
function trunkUpdateAdvice({ trunkAge, appliedPatch, ticketLinked } = {}) {
	const age = trunkAge || {};
	const quiet = { recommendUpdate: false, atRisk: false, headline: '', detail: '', dotTitle: '', preLinkNote: '' };
	if (!age.stale) return quiet;

	const atRisk = Boolean(appliedPatch);

	// The probe's answer is a fact about trunk; the calendar's is a fact about
	// the snapshot. Say whichever one was actually established.
	const headline = age.behind === true
		? 'Trunk has moved since this snapshot'
		: `This site\u2019s WordPress code is ${age.ageDays} days old`;

	// The dot's tooltip is the one place the signal appears with no room for the
	// detail below it, so it carries the reason not to act when there is one:
	// suggesting an update to someone holding a patch it would remove is the
	// nag this function exists to avoid, and a tooltip is no exception.
	let dotTitle;
	if (atRisk) {
		dotTitle = age.behind === true
			? 'Trunk has moved since this snapshot — updating would remove the patch you applied'
			: `WordPress code is ${age.ageDays} days old — updating would remove the patch you applied`;
	} else {
		dotTitle = age.behind === true
			? 'Trunk has moved since this snapshot — update this site to latest trunk'
			: `WordPress code is ${age.ageDays} days old — update to latest trunk`;
	}

	// Always true, and true whether or not there are edits right now: the update
	// path asks before it resets anything. Saying it unconditionally is what
	// lets this function stay out of the business of measuring the worktree.
	const cost = appliedPatch
		? 'It also resets the working tree, so the patch you have applied would be removed. Revert it first if you still need it.'
		: 'It also resets the working tree, so any edits you have not written down yet are asked about first.';

	const detail = [
		'Updating brings this site\u2019s copy of WordPress up to date, so patches you write are measured against current trunk.',
		ticketLinked
			? 'The ticket you have linked keeps the trunk it was created from — updating the site does not move it.'
			: '',
		cost
	].filter(Boolean).join(' ');

	// Only before a ticket exists, and only when updating is a safe thing to
	// suggest: this is the one prompt that claims a moment of the contributor's
	// attention rather than waiting to be read.
	const preLinkNote = (!ticketLinked && !atRisk)
		? `${headline}. Updating first means this ticket is not born behind.`
		: '';

	return { recommendUpdate: !atRisk, atRisk, headline, detail, dotTitle, preLinkNote };
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
	trunkUpdateAdvice,
	planUpdateSteps,
	updateStepStatuses,
	setupOutcome,
	updateOutcome
};
