'use strict';

// The read policy behind the debug.log tail.
//
// The rule that matters is the shrinking file. Before it existed the tail only
// ever moved forward, so emptying the file — which the panel's own Clear button
// now does, and which `grunt clean` does as part of a rebuild — left the offset
// pointing past the end. Nothing was ever read again: the file had to grow back
// past its old length before a single byte reappeared, and until then the panel
// looked exactly like a site that was not logging.

const test = require('node:test');
const assert = require('node:assert/strict');

const { planInitialRead, planTailRead, MAX_INITIAL_READ } = require('../../src/log-tail.js');

test('an empty file has no backlog to replay', () => {
	assert.deepEqual(planInitialRead(0), { read: null, lastSize: 0 });
});

test('a small file is replayed whole', () => {
	assert.deepEqual(planInitialRead(500), { read: { start: 0 }, lastSize: 500 });
});

test('a large file is replayed from its tail, not its start', () => {
	const size = MAX_INITIAL_READ * 3;

	assert.deepEqual(planInitialRead(size), { read: { start: size - MAX_INITIAL_READ }, lastSize: size });
});

test('growth is read from where the last read stopped', () => {
	assert.deepEqual(planTailRead(100, 180), { read: { start: 100 }, lastSize: 180 });
});

test('an unchanged size reads nothing', () => {
	assert.deepEqual(planTailRead(100, 100), { read: null, lastSize: 100 });
});

// The regression this module exists for.
test('a truncated file is read again from the start, not from the stale offset', () => {
	const next = planTailRead(4096, 120);

	assert.deepEqual(next.read, { start: 0 }, 'reading from the old offset skips everything written next');
	assert.equal(next.lastSize, 120);
});

test('a file emptied to nothing leaves nothing to read and forgets the offset', () => {
	const next = planTailRead(4096, 0);

	assert.equal(next.read, null);
	assert.equal(next.lastSize, 0, 'a stale offset here silences every later write');
});

// The sequence the Clear button produces: a full file, truncated to nothing,
// then written to again. The last step is what was broken — it has to arrive.
test('writes after a clear still reach the panel', () => {
	let lastSize = 4096;

	lastSize = planTailRead(lastSize, 0).lastSize;
	const afterClear = planTailRead(lastSize, 60);

	assert.deepEqual(afterClear.read, { start: 0 });
	assert.equal(afterClear.lastSize, 60);
});

test('junk sizes are floored rather than producing a negative range', () => {
	assert.deepEqual(planTailRead(undefined, 50), { read: { start: 0 }, lastSize: 50 });
	assert.deepEqual(planTailRead(-10, 50), { read: { start: 0 }, lastSize: 50 });
	assert.deepEqual(planInitialRead(-1), { read: null, lastSize: 0 });
});
