'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { planUpdateHandOff } = require('../../src/renderer/update-handoff.cjs');

// #507: the three outcomes of a trunk update that leaves its build to the
// watch it paused. The messages are watch-activity's and covered there; what
// these assert is the state each outcome moves the chain to, which is what a
// renderer regression would get wrong.

test('the hand-off waits on the watch, keeping the card on the build step and releasing the terminal (#507)', () => {
	const plan = planUpdateHandOff('paused');

	assert.strictEqual(plan.waits, true);
	assert.strictEqual(plan.waiting.updateState, 'building');
	assert.strictEqual(plan.waiting.waitingOnWatch, true);
	assert.match(plan.waiting.message, /Build watcher tab/);
	assert.match(plan.waiting.message, /completes when it is watching again/);
	assert.strictEqual(plan.finish, undefined);
});

test('the ready line is what completes the update, and it ends the wait (#507)', () => {
	const { ready } = planUpdateHandOff('paused');

	assert.strictEqual(ready.completesUpdate, true);
	assert.strictEqual(ready.updateState, 'idle');
	assert.strictEqual(ready.waitingOnWatch, false);
	assert.match(ready.message, /Update complete/);
});

test('a watch that exits before its ready line leaves the update incomplete (#507)', () => {
	const { failed } = planUpdateHandOff('paused');

	assert.strictEqual(failed.completesUpdate, false, 'nothing rebuilt, so the marker must not be written');
	assert.strictEqual(failed.updateState, 'idle');
	assert.strictEqual(failed.waitingOnWatch, false);
	assert.match(failed.message, /Update incomplete/);
	assert.match(failed.message, /retry install & build/);
});

test('with no paused watch to resume, the update finishes at once and incomplete (#507)', () => {
	// 'building' is a live state of the same lifecycle (watchOccupiesBuild
	// counts it as holding build/), so it belongs in this list: a watch that is
	// building is not a paused one about to resume, and handing the update to it
	// would wait on a ready line that is not coming.
	for (const watchState of ['idle', 'exited', 'watching', 'building', undefined]) {
		const plan = planUpdateHandOff(watchState);

		assert.strictEqual(plan.waits, false, `${watchState}: no resume is coming`);
		assert.match(plan.finish.message, /Update incomplete/);
		assert.strictEqual(plan.waiting, undefined);
		assert.strictEqual(plan.ready, undefined);
		assert.strictEqual(plan.failed, undefined);
	}
});

// The outcome that would be worst to get wrong: completing an update whose
// build never ran. Only the ready line may carry it.
test('only the ready line completes the update (#507)', () => {
	const plan = planUpdateHandOff('paused');
	const completing = [plan.waiting, plan.ready, plan.failed].filter((phase) => phase.completesUpdate);

	assert.deepStrictEqual(completing, [plan.ready]);
	// The no-wait outcome carries no such flag at all: nothing rebuilt.
	assert.strictEqual('completesUpdate' in planUpdateHandOff('idle').finish, false);
});
