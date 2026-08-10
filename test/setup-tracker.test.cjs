'use strict';

// The set of sites this process is creating right now.
//
// Everything here is about the release, not the record: a path that stays
// tracked after its setup ended would keep `sites:delete` refusing a site the
// contributor can see and has every right to remove.

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSetupTracker } = require('../src/setup-tracker.js');

const DIR = '/Users/dev/sites/wp';

test('a path is tracked while its work runs, and not before or after', async () => {
	const tracker = createSetupTracker();
	assert.equal(tracker.has(DIR), false);

	let duringTheWork;
	await tracker.track(DIR, async () => {
		duringTheWork = tracker.has(DIR);
	});

	assert.equal(duringTheWork, true, 'the folder must be openable while it is being created');
	assert.equal(tracker.has(DIR), false, 'the entry must not outlive the setup');
});

// The whole reason the module exists rather than a bare Set with two call
// sites: a clone that throws is the case where forgetting to release would
// leave the site permanently undeletable.
test('a failure releases the path and still fails', async () => {
	const tracker = createSetupTracker();
	const boom = new Error('clone failed');

	await assert.rejects(
		tracker.track(DIR, async () => { throw boom; }),
		(e) => e === boom
	);

	assert.equal(tracker.has(DIR), false);
});

test('the work’s own value is what track resolves to', async () => {
	const tracker = createSetupTracker();

	assert.equal(await tracker.track(DIR, async () => DIR), DIR);
});

// Two windows can compute the same directory name before either creates it, and
// a second setup into a directory the first is cloning into would interleave two
// clones in one tree.
test('a path already being set up is refused a second setup', async () => {
	const tracker = createSetupTracker();
	let secondAttempt;
	let ranSecondWork = false;
	let stillHeldAfterRefusal;

	await tracker.track(DIR, async () => {
		secondAttempt = await tracker.track(DIR, async () => { ranSecondWork = true; }).then(
			() => null,
			(e) => e
		);
		// Asserted here, inside the first setup, rather than after it: the
		// release this is about is the one a refused attempt must *not* perform.
		// Checked after the outer `track` had ended, it would only be re-testing
		// the outer release and would pass for a tracker whose refusal deleted
		// the entry — leaving a live clone deletable.
		stillHeldAfterRefusal = tracker.has(DIR);
	});

	assert.ok(secondAttempt instanceof Error, 'the second setup must not run');
	assert.equal(ranSecondWork, false, 'and must not run its work either');
	assert.equal(stillHeldAfterRefusal, true, 'the refused attempt must not release the first one’s entry');
	assert.equal(tracker.has(DIR), false, 'the first one still releases normally');
});

test('paths lists what is in flight, and is a copy', () => {
	const tracker = createSetupTracker();
	tracker.begin(DIR);

	const paths = tracker.paths();
	assert.deepEqual(paths, [DIR]);

	paths.push('/somewhere/else');
	assert.deepEqual(tracker.paths(), [DIR], 'a caller must not be able to widen the guard');
});

test('sites being set up in parallel are tracked independently', async () => {
	const tracker = createSetupTracker();
	const other = '/Users/dev/sites/other';
	let seen;

	await tracker.track(DIR, async () => {
		await tracker.track(other, async () => { seen = tracker.paths().sort(); });
		assert.equal(tracker.has(other), false);
		assert.equal(tracker.has(DIR), true);
	});

	assert.deepEqual(seen, [other, DIR].sort());
	assert.deepEqual(tracker.paths(), []);
});

test('anything that is not a usable path is not tracked', () => {
	const tracker = createSetupTracker();

	for (const bad of ['', null, undefined, 42, {}]) {
		assert.equal(tracker.begin(bad), false, String(bad));
	}
	assert.deepEqual(tracker.paths(), []);
});
