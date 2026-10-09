'use strict';

// The terminal reads main's answer to phpunit:run through this: a run to track,
// or a sentence when nothing started. A refusal used to be printed as whatever
// the answer held, which for an answer with no reason was "undefined".

const test = require('node:test');
const assert = require('node:assert/strict');

const { phpunitStart } = require('../../src/renderer/phpunit-start.cjs');

test('a started run is tracked by its id', () => {
	assert.deepEqual(phpunitStart({ ok: true, runId: 'r1' }), { runId: 'r1', error: '' });
});

test('a refusal or a failed start gives its reason, and a sentence when it names none', () => {
	assert.deepEqual(phpunitStart({ ok: false, error: 'Site is not registered' }), { runId: null, error: 'Site is not registered' });
	assert.deepEqual(phpunitStart(new Error('spawn EPERM')), { runId: null, error: 'spawn EPERM' });
	for (const answer of [undefined, null, {}, { ok: false }, { ok: true }, 'odd']) {
		assert.deepEqual(phpunitStart(answer), { runId: null, error: 'The PHP unit tests could not be started.' }, JSON.stringify(answer));
	}
});
