'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { PROFILES_HOST, MAX_HANDLE_LENGTH, profileUrl, parseHandle } = require('../../src/wporg-handle.cjs');

test('parseHandle: a bare username is a handle (issue #166)', () => {
	const res = parseHandle('janedoe');
	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.handle, 'janedoe');
	assert.strictEqual(res.url, 'https://profiles.wordpress.org/janedoe/');
});

test('parseHandle: the @ people copy out of a chat message is not an error (issue #166)', () => {
	assert.strictEqual(parseHandle('@janedoe').handle, 'janedoe');
	assert.strictEqual(parseHandle('  @janedoe  ').handle, 'janedoe');
});

test('parseHandle: the separators WordPress.org allows survive (issue #166)', () => {
	for (const handle of ['jane-doe', 'jane_doe', 'jane.doe', 'jane1', '1jane', 'j']) {
		assert.strictEqual(parseHandle(handle).handle, handle, `handle: ${handle}`);
	}
});

test('parseHandle: a profile URL resolves, in the shapes an address bar produces (issue #166)', () => {
	const forms = [
		'https://profiles.wordpress.org/janedoe/',
		'https://profiles.wordpress.org/janedoe',
		'http://profiles.wordpress.org/janedoe/',
		'profiles.wordpress.org/janedoe/',
		'https://profiles.wordpress.org/janedoe/?foo=1#bar'
	];
	for (const form of forms) {
		assert.strictEqual(parseHandle(form).handle, 'janedoe', `form: ${form}`);
	}
});

test('parseHandle: every accepted form yields the same canonical profile URL (issue #166)', () => {
	const forms = ['janedoe', '@janedoe', 'JaneDoe', 'profiles.wordpress.org/janedoe/'];
	for (const form of forms) {
		assert.strictEqual(parseHandle(form).url, profileUrl('janedoe'), `form: ${form}`);
	}
});

// The handle rides in a filename and in a patch header line, so it is stored in
// the one casing profiles.wordpress.org serves rather than however it was typed.
test('parseHandle: a handle is stored lowercase (issue #166)', () => {
	assert.strictEqual(parseHandle('JaneDoe').handle, 'janedoe');
});

test('parseHandle: empty input asks for a username rather than reporting a parse failure (issue #166)', () => {
	for (const empty of ['', '   ', null, undefined, 42]) {
		const res = parseHandle(empty);
		assert.strictEqual(res.ok, false);
		assert.strictEqual(res.error, 'Enter your WordPress.org username.');
	}
});

// Anything that would end up in a filename or break the one-line header. The
// point is that these are refused here, not sanitized somewhere downstream.
test('parseHandle: characters outside the handle charset are refused (issue #166)', () => {
	const bad = [
		'jane doe',
		'jane/doe',
		'jane\\doe',
		'../../etc/passwd',
		'jane\ndoe',
		'jane#doe',
		'-janedoe',
		'janedoe-',
		'.janedoe',
		'jane%20doe',
		'a'.repeat(MAX_HANDLE_LENGTH + 1)
	];
	for (const input of bad) {
		assert.strictEqual(parseHandle(input).ok, false, `input: ${JSON.stringify(input)}`);
	}
});

test('parseHandle: a profile link on another host names the host it wants (issue #166)', () => {
	const res = parseHandle('https://example.com/janedoe/');
	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.error, `Only ${PROFILES_HOST} profile links are supported.`);
});

test('parseHandle: a profiles URL that is not a profile is refused (issue #166)', () => {
	assert.strictEqual(parseHandle('https://profiles.wordpress.org/').ok, false);
	assert.strictEqual(parseHandle('https://profiles.wordpress.org/janedoe/activity/').ok, false);
	assert.strictEqual(parseHandle('https://profiles.wordpress.org/%zz/').ok, false);
});
