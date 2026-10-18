'use strict';

// The buffer behind the debug.log panel. What it has to get right is the drop:
// the pane is read by someone looking for a PHP error, and a half line at the
// top of the scrollback reads as corruption rather than as a trimmed log.

const test = require('node:test');
const assert = require('node:assert/strict');

const { appendBounded, countLines, debugLogOnScreen, unseenIn, unseenLinesNote, MAX_BADGE_COUNT, MAX_LOG_CHARACTERS } = require('../../src/renderer/debug-log.cjs');

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

// Which lines count as not yet seen (#558). The pane is in the tray, and a
// tab left selected in a tray nobody is looking at is not being read.

test('debug.log is in front of someone only while the Logs are on screen with its tab selected', () => {
	assert.strictEqual(debugLogOnScreen({ shown: true, activeTab: 'debug' }), true);
	assert.strictEqual(debugLogOnScreen({ shown: true, activeTab: 'runtime' }), false);
	assert.strictEqual(debugLogOnScreen({ shown: true, activeTab: 'watch' }), false);
	assert.strictEqual(debugLogOnScreen({ shown: false, activeTab: 'debug' }), false);
	assert.strictEqual(debugLogOnScreen(), false);
});

test('a chunk adds its lines to the unseen count unless it is being read or is what the file already held', () => {
	const chunk = 'PHP Notice: one\nPHP Notice: two\n';
	assert.strictEqual(unseenIn(chunk, { backlog: false, onScreen: false }), 2);
	assert.strictEqual(unseenIn(chunk), 2);
	assert.strictEqual(unseenIn(chunk, { backlog: false, onScreen: true }), 0);
	assert.strictEqual(unseenIn(chunk, { backlog: true, onScreen: false }), 0);
	assert.strictEqual(unseenIn(chunk, { backlog: true, onScreen: true }), 0);
	assert.strictEqual(unseenIn('', { backlog: false, onScreen: false }), 0);
});

test('unseen lines are a number for the footer and words that say what it counts', () => {
	assert.deepStrictEqual(unseenLinesNote(1), { badge: '1', note: '1 unseen line in Debug.log' });
	assert.deepStrictEqual(unseenLinesNote(3), { badge: '3', note: '3 unseen lines in Debug.log' });
});

test('past what the badge counts to it says there are more, and the words still say how many', () => {
	assert.deepStrictEqual(unseenLinesNote(MAX_BADGE_COUNT), { badge: '99', note: '99 unseen lines in Debug.log' });
	assert.deepStrictEqual(unseenLinesNote(MAX_BADGE_COUNT + 1), { badge: '99+', note: '100 unseen lines in Debug.log' });
	assert.deepStrictEqual(unseenLinesNote(4096), { badge: '99+', note: '4096 unseen lines in Debug.log' });
});

test('with every line seen there is nothing to say', () => {
	assert.strictEqual(unseenLinesNote(0), null);
	assert.strictEqual(unseenLinesNote(-1), null);
	assert.strictEqual(unseenLinesNote(undefined), null);
	assert.strictEqual(unseenLinesNote(1.5), null);
});
