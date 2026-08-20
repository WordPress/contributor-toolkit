'use strict';

// The buffer behind the debug.log panel. What it has to get right is the drop:
// the pane is read by someone looking for a PHP error, and a half line at the
// top of the scrollback reads as corruption rather than as a trimmed log.

const test = require('node:test');
const assert = require('node:assert/strict');

const { appendBounded, countLines, MAX_LOG_CHARACTERS } = require('../../src/renderer/debug-log.cjs');

test('text under the limit is appended unchanged', () => {
	assert.strictEqual(appendBounded('one\n', 'two\n', 100), 'one\ntwo\n');
});

test('an empty previous value and an empty chunk are both handled', () => {
	assert.strictEqual(appendBounded('', 'first\n', 100), 'first\n');
	assert.strictEqual(appendBounded('kept\n', '', 100), 'kept\n');
	assert.strictEqual(appendBounded(undefined, undefined, 100), '');
});

test('the oldest lines are dropped once the limit is passed', () => {
	// Four lines of five characters each, in a buffer that holds twelve. The cut
	// moves forward to the next boundary, so the result comes in under the limit
	// rather than over it — a whole line is dropped, never part of one.
	const result = appendBounded('aaaa\nbbbb\ncccc\n', 'dddd\n', 12);

	assert.strictEqual(result, 'cccc\ndddd\n');
	assert.ok(result.length <= 12, 'the limit is a ceiling');
});

// The property the panel depends on. Cutting at the character count alone would
// leave the pane starting mid-message.
test('the drop lands on a line boundary, never mid-line', () => {
	const result = appendBounded('PHP Warning: something long here\n', 'PHP Notice: short\n', 20);

	assert.strictEqual(result, 'PHP Notice: short\n');
	assert.ok(!result.startsWith('ing here'), 'a partial first line reads as corruption');
});

test('the newest content always survives', () => {
	const result = appendBounded('old\n'.repeat(100), 'newest line\n', 20);

	assert.ok(result.endsWith('newest line\n'));
});

// A var_dump or a serialized object is one line with no boundary to cut on. The
// tail is what is kept, because the end of such a line is where the file and
// line number are.
//
// Both terminations are asserted, and the terminated one is the case that
// matters: everything error_log() writes ends in a newline, so a version of
// this test using only an unterminated line exercises the one shape that cannot
// occur. It passed while appendBounded returned '' for every real line of this
// kind — the boundary search found the line's own terminator and dropped the
// whole buffer, blanking the panel mid-incident.
test('a single line longer than the whole limit keeps its tail', () => {
	const unterminated = appendBounded('', `${'x'.repeat(50)}END`, 10);
	assert.strictEqual(unterminated.length, 10);
	assert.ok(unterminated.endsWith('END'));

	const terminated = appendBounded('', `${'x'.repeat(50)}END\n`, 10);
	assert.strictEqual(terminated.length, 10);
	assert.ok(terminated.endsWith('END\n'));
});

test('an over-long terminated line does not wipe the buffer', () => {
	const result = appendBounded('a\n'.repeat(20), `PHP Fatal ${'z'.repeat(60)}\n`, 20);

	assert.notStrictEqual(result, '', 'a single long line must not blank the panel');
	assert.strictEqual(result.length, 20);
	assert.ok(result.endsWith('z\n'));
});

test('the default limit is generous but finite', () => {
	assert.strictEqual(MAX_LOG_CHARACTERS, 512 * 1024);

	const overflowing = appendBounded('a\n'.repeat(MAX_LOG_CHARACTERS), 'last\n');
	assert.ok(overflowing.length <= MAX_LOG_CHARACTERS);
	assert.ok(overflowing.endsWith('last\n'));
});

test('countLines counts terminators, so a split line is counted once', () => {
	assert.strictEqual(countLines('one\ntwo\n'), 2);
	// The two halves of a line that arrived across two reads.
	assert.strictEqual(countLines('one\ntw'), 1);
	assert.strictEqual(countLines('o\n'), 1);
	assert.strictEqual(countLines(''), 0);
	assert.strictEqual(countLines(undefined), 0);
});
