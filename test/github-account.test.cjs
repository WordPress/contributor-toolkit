'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { carryTestMode } = require('../src/renderer/github-account.cjs');

// The bug (#197): signing in replaced the account wholesale, so the dry-run
// banner vanished and the button went back to reading "Open pull request" at
// the one point it could actually push something.
test('carryTestMode: signing in keeps the test mode the build is running in (issue #197)', () => {
	const before = { login: null, configured: true, testMode: { dryRun: true } };
	const after = carryTestMode(before, { login: 'juanmaguitar', configured: true });
	assert.deepStrictEqual(after.testMode, { dryRun: true });
	assert.strictEqual(after.login, 'juanmaguitar');
});

test('carryTestMode: signing out and losing an authorization keep it too (issue #197)', () => {
	const signedIn = { login: 'juanmaguitar', configured: true, testMode: { target: 'juanmaguitar/sandbox' } };
	assert.deepStrictEqual(
		carryTestMode(signedIn, { login: null, configured: true }).testMode,
		{ target: 'juanmaguitar/sandbox' }
	);
});

test('carryTestMode: a shipped build is never given a mode it does not have (issue #197)', () => {
	const after = carryTestMode({ login: null, configured: true }, { login: 'juanmaguitar', configured: true });
	assert.strictEqual('testMode' in after, false);
	assert.strictEqual(carryTestMode(undefined, { login: null }).testMode, undefined);
});

test('carryTestMode: what the main process reports wins over what was remembered (issue #197)', () => {
	const after = carryTestMode(
		{ testMode: { dryRun: true } },
		{ login: 'juanmaguitar', configured: true, testMode: null }
	);
	assert.strictEqual(after.testMode, null);
});
