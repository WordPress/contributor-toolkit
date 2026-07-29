const test = require('node:test');
const assert = require('node:assert/strict');

const { createLineBuffer } = require('../src/log-lines.js');

test('emits complete lines and holds back a partial one', () => {
	const buf = createLineBuffer();
	assert.deepEqual(buf.push('added 733 packages\nfound 0 vul'), ['added 733 packages']);
	// The partial line only surfaces once its newline arrives.
	assert.deepEqual(buf.push('nerabilities\n'), ['found 0 vulnerabilities']);
});

test('a chunk ending on a newline leaves nothing pending', () => {
	const buf = createLineBuffer();
	assert.deepEqual(buf.push('one\ntwo\n'), ['one', 'two']);
	assert.deepEqual(buf.flush(), []);
});

test('a line split across three chunks is reassembled', () => {
	const buf = createLineBuffer();
	assert.deepEqual(buf.push('npm error code '), []);
	assert.deepEqual(buf.push('EBAD'), []);
	assert.deepEqual(buf.push('ENGINE\n'), ['npm error code EBADENGINE']);
});

test('strips the CR of Windows CRLF output', () => {
	const buf = createLineBuffer();
	assert.deepEqual(buf.push('C:\\Users\\dev>npm install\r\ndone\r\n'), ['C:\\Users\\dev>npm install', 'done']);
});

test('flush returns the unterminated last line', () => {
	// Servers commonly exit right after a prompt with no trailing newline, and
	// that line is usually the one explaining why.
	const buf = createLineBuffer();
	assert.deepEqual(buf.push('Error: listen EPERM'), []);
	assert.deepEqual(buf.flush(), ['Error: listen EPERM']);
	// Flushing twice must not repeat it.
	assert.deepEqual(buf.flush(), []);
});

test('blank lines are preserved but a trailing empty remainder is not', () => {
	const buf = createLineBuffer();
	assert.deepEqual(buf.push('a\n\nb\n'), ['a', '', 'b']);
	assert.deepEqual(buf.flush(), []);
});

test('empty and nullish chunks are no-ops', () => {
	const buf = createLineBuffer();
	assert.deepEqual(buf.push(''), []);
	assert.deepEqual(buf.push(undefined), []);
	assert.deepEqual(buf.push(null), []);
	assert.deepEqual(buf.flush(), []);
});

test('buffers are independent so stdout and stderr do not interleave', () => {
	const out = createLineBuffer();
	const err = createLineBuffer();
	assert.deepEqual(out.push('half of stdout'), []);
	assert.deepEqual(err.push('a whole stderr line\n'), ['a whole stderr line']);
	assert.deepEqual(out.push(' completed\n'), ['half of stdout completed']);
});
