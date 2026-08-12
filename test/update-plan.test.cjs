'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	STALE_THRESHOLD_DAYS,
	SKIP_INSTALL_MESSAGE,
	SETUP_STATE_TO_STEP,
	trunkAgeInfo,
	trunkUpdateAdvice,
	planUpdateSteps,
	planSetupSteps,
	updateStepStatuses,
	setupOutcome,
	updateOutcome
} = require('../src/renderer/update-plan.cjs');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-05T12:00:00Z');

function daysAgo(days) {
	return new Date(NOW - days * DAY_MS).toISOString();
}

test('trunkAgeInfo: a 13-day-old snapshot is not stale (issue #94)', () => {
	const info = trunkAgeInfo({ trunkDate: daysAgo(13), now: NOW });
	assert.strictEqual(info.known, true);
	assert.strictEqual(info.ageDays, 13);
	assert.strictEqual(info.stale, false);
});

test('trunkAgeInfo: a 15-day-old snapshot is stale (issue #94)', () => {
	const info = trunkAgeInfo({ trunkDate: daysAgo(15), now: NOW });
	assert.strictEqual(info.stale, true);
	assert.strictEqual(info.ageDays, 15);
});

test('trunkAgeInfo: exactly the threshold is not yet stale (issue #94)', () => {
	const info = trunkAgeInfo({ trunkDate: daysAgo(STALE_THRESHOLD_DAYS), now: NOW });
	assert.strictEqual(info.ageDays, STALE_THRESHOLD_DAYS);
	assert.strictEqual(info.stale, false);
});

test('trunkAgeInfo: missing or invalid dates are never stale (issue #94)', () => {
	for (const trunkDate of [undefined, null, '', 'not-a-date']) {
		const info = trunkAgeInfo({ trunkDate, now: NOW });
		assert.strictEqual(info.known, false, `trunkDate=${String(trunkDate)}`);
		assert.strictEqual(info.stale, false);
		assert.strictEqual(info.ageDays, null);
		assert.strictEqual(info.label, '');
	}
});

test('trunkAgeInfo: label names the snapshot date (issue #94)', () => {
	const info = trunkAgeInfo({ trunkDate: '2026-06-12T00:00:00Z', now: NOW });
	assert.match(info.label, /^trunk as of /);
	assert.match(info.label, /2026/);
});

test('trunkAgeInfo: a future date clamps to age 0, not negative (issue #94)', () => {
	const info = trunkAgeInfo({ trunkDate: daysAgo(-1), now: NOW });
	assert.strictEqual(info.ageDays, 0);
	assert.strictEqual(info.stale, false);
});

// --- staleness measured from the remote, not the calendar (#307) ---------
//
// The probe's answer arrives as `remoteTrunkOid`; the module itself does no
// I/O. Three inputs, three behaviours: it has moved, it has not, and we could
// not ask.

test('trunkAgeInfo: trunk has moved past this snapshot -> stale, whatever the calendar says (issue #307)', () => {
	// Three days old and already behind — exactly the case the calendar misses.
	const info = trunkAgeInfo({
		trunkDate: daysAgo(3),
		trunkOid: 'aaaaaaa',
		remoteTrunkOid: 'bbbbbbb',
		now: NOW
	});

	assert.strictEqual(info.behind, true);
	assert.strictEqual(info.stale, true);
	assert.strictEqual(info.source, 'remote');
	assert.strictEqual(info.ageDays, 3, 'the age is still reported; it is just no longer the test');
});

test('trunkAgeInfo: the remote says this snapshot IS trunk -> not stale, however old it is (issue #307)', () => {
	// Two months old and current: a quiet trunk is not an out-of-date one, and
	// telling this contributor to spend minutes updating would be a lie.
	const info = trunkAgeInfo({
		trunkDate: daysAgo(60),
		trunkOid: 'aaaaaaa',
		remoteTrunkOid: 'aaaaaaa',
		now: NOW
	});

	assert.strictEqual(info.behind, false);
	assert.strictEqual(info.stale, false);
	assert.strictEqual(info.source, 'remote');
	assert.strictEqual(info.ageDays, 60);
});

test('trunkAgeInfo: no probe answer falls back to the calendar, unchanged (issue #307)', () => {
	// Offline, rate-limited, proxied, or simply not asked yet. This is the
	// promise the threshold survives to keep: the dot still works with no
	// network, and behaves exactly as it did before #307.
	for (const probe of [{}, { remoteTrunkOid: null }, { trunkOid: 'aaaaaaa' }, { remoteTrunkOid: 'bbbbbbb' }]) {
		const fresh = trunkAgeInfo({ trunkDate: daysAgo(13), now: NOW, ...probe });
		assert.strictEqual(fresh.behind, null, JSON.stringify(probe));
		assert.strictEqual(fresh.source, 'calendar');
		assert.strictEqual(fresh.stale, false);

		const old = trunkAgeInfo({ trunkDate: daysAgo(15), now: NOW, ...probe });
		assert.strictEqual(old.behind, null, JSON.stringify(probe));
		assert.strictEqual(old.stale, true);
	}
});

test('trunkAgeInfo: a site record with no date can still be judged by the probe (issue #307)', () => {
	const info = trunkAgeInfo({ trunkOid: 'aaaaaaa', remoteTrunkOid: 'bbbbbbb', now: NOW });

	assert.strictEqual(info.known, false, 'there is still no date to show');
	assert.strictEqual(info.label, '');
	assert.strictEqual(info.stale, true, 'but the probe answered, and it is the whole answer');
});

// --- what the contributor is told about it (#307) -------------------------

const behindAge = () => trunkAgeInfo({ trunkDate: daysAgo(3), trunkOid: 'aaaaaaa', remoteTrunkOid: 'bbbbbbb', now: NOW });
const calendarAge = () => trunkAgeInfo({ trunkDate: daysAgo(20), now: NOW });

test('trunkUpdateAdvice: a current site is told nothing at all (issue #307)', () => {
	const advice = trunkUpdateAdvice({
		trunkAge: trunkAgeInfo({ trunkDate: daysAgo(60), trunkOid: 'a', remoteTrunkOid: 'a', now: NOW })
	});

	assert.strictEqual(advice.recommendUpdate, false);
	assert.strictEqual(advice.headline, '');
	assert.strictEqual(advice.preLinkNote, '');
});

test('trunkUpdateAdvice: the message names trunk when trunk is what was measured (issue #307)', () => {
	const advice = trunkUpdateAdvice({ trunkAge: behindAge() });

	assert.strictEqual(advice.recommendUpdate, true);
	assert.strictEqual(advice.headline, 'Trunk has moved since this snapshot');
	assert.doesNotMatch(advice.headline, /days old/, 'the age is not what was measured');
	assert.match(advice.dotTitle, /Trunk has moved/);
});

test('trunkUpdateAdvice: the calendar fallback keeps saying what it can honestly say (issue #307)', () => {
	const advice = trunkUpdateAdvice({ trunkAge: calendarAge() });

	assert.strictEqual(advice.recommendUpdate, true);
	assert.match(advice.headline, /WordPress code is 20 days old/);
	assert.doesNotMatch(advice.headline, /has moved/, 'nothing was measured against trunk here');
});

test('trunkUpdateAdvice: an applied patch is never nagged toward its own destruction (issue #307)', () => {
	const advice = trunkUpdateAdvice({ trunkAge: behindAge(), appliedPatch: true });

	// Updating resets the working tree and the applied patch goes with it, so
	// the amber "update now" block and the next-action cue stay away...
	assert.strictEqual(advice.recommendUpdate, false);
	assert.strictEqual(advice.atRisk, true);
	// ...but the fact is not hidden: the dot and the panel still say it.
	assert.match(advice.headline, /Trunk has moved/);
	assert.match(advice.detail, /patch you have applied would be removed/);
	// Including the tooltip, which has no detail line under it to soften it.
	assert.match(advice.dotTitle, /updating would remove the patch you applied/);
	assert.doesNotMatch(advice.dotTitle, /update this site to latest trunk/);
});

test('trunkUpdateAdvice: uncommitted edits are named, not silenced over (issue #307)', () => {
	// The opposite call to the applied patch above, and deliberate. An update
	// removes an applied patch without asking; it asks before it touches edits
	// (#234), so going quiet would withhold the signal over work that is not
	// actually in danger — and would rest on the branch-point measure the panel
	// holds, which counts parked work a force checkout survives (#239).
	const advice = trunkUpdateAdvice({ trunkAge: behindAge() });

	assert.strictEqual(advice.recommendUpdate, true);
	assert.match(advice.detail, /edits you have not written down yet are asked about first/);
});

test('trunkUpdateAdvice: the copy never implies updating carries a ticket forward (issue #305)', () => {
	const advice = trunkUpdateAdvice({ trunkAge: behindAge(), ticketLinked: true });

	// Updating moves the site. A ticket branch keeps the base it was born at,
	// deliberately — bringing it forward is #305's action, not this one, and
	// promising it here would be a lie the contributor discovers the hard way.
	assert.match(advice.detail, /copy of WordPress/);
	assert.match(advice.detail, /keeps the trunk it was created from/);
	assert.match(advice.detail, /does not move it/);
});

test('trunkUpdateAdvice: the pre-link prompt appears only where it is both true and safe (issue #307)', () => {
	// The cheapest moment: a ticket not yet born on a trunk that has moved.
	assert.match(
		trunkUpdateAdvice({ trunkAge: behindAge() }).preLinkNote,
		/Trunk has moved since this snapshot\. Updating first means this ticket is not born behind\./
	);

	// Not once a ticket exists — updating would not bring that one forward.
	assert.strictEqual(trunkUpdateAdvice({ trunkAge: behindAge(), ticketLinked: true }).preLinkNote, '');
	// Not over an applied patch, which updating would remove.
	assert.strictEqual(trunkUpdateAdvice({ trunkAge: behindAge(), appliedPatch: true }).preLinkNote, '');
	// Not when there is nothing to say.
	assert.strictEqual(trunkUpdateAdvice({ trunkAge: trunkAgeInfo({ trunkDate: daysAgo(1), now: NOW }) }).preLinkNote, '');
});

test('planUpdateSteps: install runs when the lockfile changed (issue #94)', () => {
	const steps = planUpdateSteps({ lockfileChanged: true });
	assert.deepStrictEqual(steps.map((s) => s.key), ['fetch', 'install', 'build']);
	assert.strictEqual(steps[1].skipped, false);
});

test('planUpdateSteps: install is skipped, with the exact message, when the lockfile did not change (issue #94)', () => {
	const steps = planUpdateSteps({ lockfileChanged: false });
	assert.strictEqual(steps[1].skipped, true);
	assert.strictEqual(steps[1].skipMessage, SKIP_INSTALL_MESSAGE);
	assert.strictEqual(SKIP_INSTALL_MESSAGE, 'Dependencies unchanged — skipping npm install');
});

test('updateStepStatuses: while building, fetch is complete and a skipped install shows as skipped (issue #94)', () => {
	const steps = planUpdateSteps({ lockfileChanged: false });
	const statuses = updateStepStatuses(steps, 'building');
	assert.deepStrictEqual(statuses, [
		{ key: 'fetch', status: 'complete' },
		{ key: 'install', status: 'skipped' },
		{ key: 'build', status: 'current' }
	]);
});

test('updateStepStatuses: while installing, later steps are pending (issue #94)', () => {
	const steps = planUpdateSteps({ lockfileChanged: true });
	const statuses = updateStepStatuses(steps, 'installing');
	assert.deepStrictEqual(statuses, [
		{ key: 'fetch', status: 'complete' },
		{ key: 'install', status: 'current' },
		{ key: 'build', status: 'pending' }
	]);
});

test('updateStepStatuses: done marks every non-skipped step complete (issue #94)', () => {
	const steps = planUpdateSteps({ lockfileChanged: false });
	const statuses = updateStepStatuses(steps, 'done');
	assert.deepStrictEqual(statuses.map((s) => s.status), ['complete', 'skipped', 'complete']);
});

test('updateOutcome: fetch failure is a plain failure, not incomplete (issue #94)', () => {
	assert.strictEqual(updateOutcome({ fetchOk: false }), 'failed-fetch');
});

test('updateOutcome: already up to date (issue #94)', () => {
	assert.strictEqual(updateOutcome({ fetchOk: true, upToDate: true }), 'up-to-date');
});

test('updateOutcome: trunk moved but install failed -> incomplete (issue #94)', () => {
	assert.strictEqual(
		updateOutcome({ fetchOk: true, upToDate: false, moved: true, installNeeded: true, installCode: 1, buildCode: 0 }),
		'incomplete'
	);
});

test('updateOutcome: trunk moved but build failed -> incomplete (issue #94)', () => {
	assert.strictEqual(
		updateOutcome({ fetchOk: true, upToDate: false, moved: true, installNeeded: false, buildCode: 2 }),
		'incomplete'
	);
});

test('updateOutcome: full chain success (issue #94)', () => {
	assert.strictEqual(
		updateOutcome({ fetchOk: true, upToDate: false, moved: true, installNeeded: true, installCode: 0, buildCode: 0 }),
		'done'
	);
});

// --- the setup chain (#246) ----------------------------------------------

test('planSetupSteps: clone, install, build — and nothing is ever skipped (issue #246)', () => {
	const steps = planSetupSteps();

	assert.deepStrictEqual(steps.map((s) => s.key), ['download', 'install', 'build']);
	// The update and apply chains skip the install when the lockfile did not
	// move; a fresh clone has no node_modules at all, so there is nothing this
	// chain can honestly skip.
	assert.deepStrictEqual(steps.map((s) => s.skipped), [false, false, false]);
	// Starting the dev server is deliberately outside the chain: it marks the
	// wizard finished and hands the contributor to a browser wizard.
	assert.ok(!steps.some((s) => s.key === 'dev'), 'the dev server is not part of the chain');
});

test('the setup chain reuses updateStepStatuses with its own state names (issue #246)', () => {
	const steps = planSetupSteps();
	const at = (state) => updateStepStatuses(steps, state, SETUP_STATE_TO_STEP)
		.map((s) => s.status);

	assert.deepStrictEqual(at('cloning'), ['current', 'pending', 'pending']);
	assert.deepStrictEqual(at('installing'), ['complete', 'current', 'pending']);
	assert.deepStrictEqual(at('building'), ['complete', 'complete', 'current']);
	assert.deepStrictEqual(at('done'), ['complete', 'complete', 'complete']);
});

test('an idle setup chain claims no step (issue #246)', () => {
	// 'idle' is not in the map, so nothing is current and nothing is complete —
	// which is what keeps the banner off the screen when no chain is running.
	assert.deepStrictEqual(
		updateStepStatuses(planSetupSteps(), 'idle', SETUP_STATE_TO_STEP).map((s) => s.status),
		['pending', 'pending', 'pending']
	);
});

test('setupOutcome: install and build both succeeded -> done (issue #246)', () => {
	assert.strictEqual(setupOutcome({ installCode: 0, buildCode: 0 }), 'done');
});

test('setupOutcome: a failed install never reaches the build (issue #246)', () => {
	// buildCode is undefined because the build never ran — the outcome has to
	// name the install, not read the missing build as the failure.
	assert.strictEqual(setupOutcome({ installCode: 1 }), 'failed-install');
});

test('setupOutcome: a failed build after a good install (issue #246)', () => {
	assert.strictEqual(setupOutcome({ installCode: 0, buildCode: 2 }), 'failed-build');
});

test('setupOutcome: Stop is not a failure, whatever exit code the kill produced (issue #246)', () => {
	// A killed npm exits non-zero, and on Windows without even a signal, so the
	// exit code cannot tell a stop from a failure. Telling a contributor their
	// install "failed" when they pressed Stop is how a tool loses their trust.
	assert.strictEqual(setupOutcome({ stopped: true, installCode: 1 }), 'stopped');
	assert.strictEqual(setupOutcome({ stopped: true, installCode: 0, buildCode: 143 }), 'stopped');
});
