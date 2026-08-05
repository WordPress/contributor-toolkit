'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	STALE_THRESHOLD_DAYS,
	SKIP_INSTALL_MESSAGE,
	trunkAgeInfo,
	planUpdateSteps,
	updateStepStatuses,
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
