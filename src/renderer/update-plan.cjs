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

/**
 * Maps the chain steps to checklist visual states for a given renderer
 * updateState. Steps before the current one are complete, the current one is
 * current, later ones pending; skipped steps stay 'skipped' once passed.
 */
function updateStepStatuses(steps, updateState) {
	const activeKey = STATE_TO_STEP[updateState] || null;
	const order = steps.map((s) => s.key);
	const activeIndex = activeKey ? order.indexOf(activeKey) : (updateState === 'done' ? steps.length : -1);
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
	trunkAgeInfo,
	planUpdateSteps,
	updateStepStatuses,
	updateOutcome
};
