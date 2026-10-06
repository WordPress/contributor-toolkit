'use strict';

// The read policy behind the debug.log tail.
//
// The rule that matters is the shrinking file. Before it existed the tail only
// ever moved forward, so emptying the file — which the panel's own Clear button
// now does, and which `grunt clean` does as part of a rebuild — left the offset
// pointing past the end. Nothing was ever read again: the file had to grow back
// past its old length before a single byte reappeared, and until then the panel
// looked exactly like a site that was not logging.
//
// The second rule is where a read ends. A range with a `start` and no `end` is
// read to wherever the file ends when the stream gets to it, which is after the
// stat that planned it, so a line WordPress appended in between arrived from
// that stream and again from the next change's read, which starts at the size
// the stat saw. Every range ends at the size it was planned from.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { planInitialRead, planTailRead, MAX_INITIAL_READ } = require('../../src/log-tail.js');

test('an empty file has no backlog to replay', () => {
	assert.deepEqual(planInitialRead(0), { read: null, lastSize: 0 });
});

test('a small file is replayed whole', () => {
	assert.deepEqual(planInitialRead(500), { read: { start: 0, end: 499 }, lastSize: 500 });
});

test('a large file is replayed from its tail, not its start', () => {
	const size = MAX_INITIAL_READ * 3;

	assert.deepEqual(planInitialRead(size), { read: { start: size - MAX_INITIAL_READ, end: size - 1 }, lastSize: size });
});

test('growth is read from where the last read stopped', () => {
	assert.deepEqual(planTailRead(100, 180), { read: { start: 100, end: 179 }, lastSize: 180 });
});

test('an unchanged size reads nothing', () => {
	assert.deepEqual(planTailRead(100, 100), { read: null, lastSize: 100 });
});

// The regression this module exists for.
test('a truncated file is read again from the start, not from the stale offset', () => {
	const next = planTailRead(4096, 120);

	assert.deepEqual(next.read, { start: 0, end: 119 }, 'reading from the old offset skips everything written next');
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

	assert.deepEqual(afterClear.read, { start: 0, end: 59 });
	assert.equal(afterClear.lastSize, 60);
});

test('junk sizes are floored rather than producing a negative range', () => {
	assert.deepEqual(planTailRead(undefined, 50), { read: { start: 0, end: 49 }, lastSize: 50 });
	assert.deepEqual(planTailRead(-10, 50), { read: { start: 0, end: 49 }, lastSize: 50 });
	assert.deepEqual(planInitialRead(-1), { read: null, lastSize: 0 });
});

// Every range ends at the size it was planned from, inclusive, as
// fs.createReadStream takes `end`: the byte after it is the first byte of the
// next read. A one-byte file is the edge where an off-by-one shows.
test('a range ends at the last byte of the size it was planned from', () => {
	assert.deepEqual(planInitialRead(1).read, { start: 0, end: 0 });
	assert.deepEqual(planTailRead(0, 1).read, { start: 0, end: 0 });
	assert.deepEqual(planTailRead(5, 6).read, { start: 5, end: 5 });
	assert.deepEqual(planTailRead(6, 1).read, { start: 0, end: 0 });
});

const readAll = (stream) => new Promise((resolve, reject) => {
	let text = '';
	stream.on('data', (chunk) => { text += chunk.toString(); });
	stream.on('end', () => resolve(text));
	stream.on('error', reject);
});

// The duplicate, on a real file. The tail stats the file and opens a stream
// for the range; the stream reads later, on its own turn, and WordPress may
// have appended by then. What it appended belongs to the change event that
// write fires, whose read starts at the size the stat saw — so the first
// stream must not carry it too. Red with a `start` and no `end`.
test('a stream opened from a plan sends only what the plan saw, not what was appended before it read', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'log-tail-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const file = path.join(dir, 'debug.log');
	fs.writeFileSync(file, 'PHP Notice: one\nPHP Notice: two\n');

	const initial = planInitialRead(fs.statSync(file).size);
	const replay = fs.createReadStream(file, initial.read);
	// Appended before the stream has read a byte: the event loop has not turned.
	fs.appendFileSync(file, 'PHP Notice: three\n');
	const replayed = await readAll(replay);

	const next = planTailRead(initial.lastSize, fs.statSync(file).size);
	const tailed = await readAll(fs.createReadStream(file, next.read));

	assert.equal(replayed, 'PHP Notice: one\nPHP Notice: two\n', 'the replay carried a line the change event sends too');
	assert.equal(tailed, 'PHP Notice: three\n');
});
