'use strict';

// What the Tests section says about the last PHP unit test run. The summaries
// below are PHPUnit 9's own, as core's suite prints them on the bundled PHP,
// colour codes and all.

const test = require('node:test');
const assert = require('node:assert/strict');

const { phpunitSummary, phpunitResult } = require('../../src/renderer/phpunit-result.cjs');

const PASSED = 'PHPUnit 9.6.38 by Sebastian Bergmann and contributors.\n\n.....  21 / 21 (100%)\n\nTime: 00:00.725, Memory: 217.00 MB\n\n\u001b[30;42mOK (21 tests, 115 assertions)\u001b[0m\n';
const FAILED = 'FAILURES!\n\u001b[37;41mTests: 2133\u001b[0m\u001b[37;41m, Assertions: 1118406\u001b[0m\u001b[37;41m, Failures: 4\u001b[0m\u001b[37;41m, Warnings: 5\u001b[0m\u001b[37;41m.\u001b[0m\n';
const ERRORS = 'ERRORS!\nTests: 25948, Assertions: 4560440, Errors: 5, Failures: 131, Warnings: 81, Skipped: 100.\n';
const SKIPPED = 'OK, but incomplete, skipped, or risky tests!\nTests: 10, Assertions: 20, Skipped: 2.\n';
const NONE = 'No tests executed!\n';

test('phpunitSummary reads the counts PHPUnit ends a run with', () => {
	assert.deepEqual(phpunitSummary(PASSED), { tests: 21, failures: 0, errors: 0, skipped: 0 });
	assert.deepEqual(phpunitSummary(FAILED), { tests: 2133, failures: 4, errors: 0, skipped: 0 });
	assert.deepEqual(phpunitSummary(ERRORS), { tests: 25948, failures: 131, errors: 5, skipped: 100 });
	assert.deepEqual(phpunitSummary(SKIPPED), { tests: 10, failures: 0, errors: 0, skipped: 2 });
	assert.deepEqual(phpunitSummary(NONE), { tests: 0, failures: 0, errors: 0, skipped: 0 });
	assert.equal(phpunitSummary('[PHP tests] Installing the test site…\n'), null);
	// The last summary is the run's, when the output holds more than one.
	assert.deepEqual(phpunitSummary(`${FAILED}\n${PASSED}`).tests, 21);
});

test('phpunitResult gives each kind of run its dot and its sentence', () => {
	assert.deepEqual(phpunitResult(null), { status: 'offline', text: 'Not run yet.' });
	assert.deepEqual(phpunitResult({ running: true }), { status: 'busy', text: 'Running…' });
	assert.deepEqual(phpunitResult({ running: false, code: 0, output: PASSED }), { status: 'online', text: '21 tests passed.' });
	assert.deepEqual(phpunitResult({ running: false, code: 0, output: SKIPPED }), { status: 'online', text: '10 tests passed. 2 skipped.' });
	assert.deepEqual(phpunitResult({ running: false, code: 1, output: FAILED }), { status: 'failed', text: '4 of 2133 tests failed.' });
	assert.deepEqual(phpunitResult({ running: false, code: 2, output: ERRORS }), { status: 'failed', text: '136 of 25948 tests failed.' });
	assert.deepEqual(phpunitResult({ running: false, code: 1, output: NONE }), { status: 'offline', text: 'No tests matched.' });
});

test('a run stopped with Ctrl+C, or one that never printed a summary, is not a pass', () => {
	assert.deepEqual(phpunitResult({ running: false, code: 130, stopped: true, output: PASSED }), { status: 'offline', text: 'Stopped before it finished.' });
	assert.deepEqual(phpunitResult({ running: false, code: 1, output: 'Composer could not install PHPUnit (exit code 1).' }), { status: 'failed', text: 'The run did not finish (exit code 1).' });
	assert.deepEqual(phpunitResult({ running: false, code: 0, output: '' }), { status: 'failed', text: 'The run did not finish (exit code 0).' });
});
