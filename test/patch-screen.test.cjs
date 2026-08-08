'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	PR_FAILURES,
	DEFAULT_FAILURE_TITLE,
	patchScreenStep,
	patchScreenCopy,
	carryTestMode,
	prFailureMessage
} = require('../src/renderer/patch-screen.cjs');

test('patchScreenStep: nothing in flight is the chooser (issue #190)', () => {
	assert.strictEqual(patchScreenStep(), 'choose');
	assert.strictEqual(patchScreenStep({}), 'choose');
	assert.strictEqual(patchScreenStep({ prStage: '', prError: null, prResult: null }), 'choose');
});

test('patchScreenStep: a code on screen is the sign-in moment (issue #190)', () => {
	assert.strictEqual(
		patchScreenStep({ deviceCode: { userCode: 'WDF4-9CQX' } }),
		'signin'
	);
});

test('patchScreenStep: a stage in flight is the working moment (issue #190)', () => {
	assert.strictEqual(patchScreenStep({ prStage: 'forking' }), 'working');
});

test('patchScreenStep: an opened pull request is the outcome (issue #190)', () => {
	assert.strictEqual(patchScreenStep({ prResult: { number: 6091 } }), 'done');
});

test('patchScreenStep: a failure is its own moment (issue #190)', () => {
	assert.strictEqual(patchScreenStep({ prError: { reason: 'offline' } }), 'failed');
});

// The flow leaves these overlapping for a render or two, which is exactly when
// the wrong precedence is visible: a failure flashing as progress, or a stale
// code covering the pull request it produced.
test('patchScreenStep: a failure recorded before the stage clears reads as failed (issue #190)', () => {
	assert.strictEqual(
		patchScreenStep({ prStage: 'committing', prError: { reason: 'rate-limited' } }),
		'failed'
	);
});

test('patchScreenStep: an outcome outranks a stage still set (issue #190)', () => {
	assert.strictEqual(
		patchScreenStep({ prStage: 'opening', prResult: { number: 6091 } }),
		'done'
	);
});

test('patchScreenStep: the pull request outranks the code that authorized it (issue #190)', () => {
	assert.strictEqual(
		patchScreenStep({ deviceCode: { userCode: 'WDF4-9CQX' }, prResult: { number: 6091 } }),
		'done'
	);
	assert.strictEqual(
		patchScreenStep({ deviceCode: { userCode: 'WDF4-9CQX' }, prStage: 'forking' }),
		'working'
	);
});

test('patchScreenCopy: every moment names itself and what is still safe (issue #190)', () => {
	for (const step of ['choose', 'signin', 'working', 'done', 'failed']) {
		const copy = patchScreenCopy({ step });
		assert.ok(copy.heading.length > 0, `${step} has a heading`);
		assert.ok(copy.subheading.length > 0, `${step} says what is still safe`);
	}
});

test('patchScreenCopy: an attempt in flight offers no way back (issue #190)', () => {
	assert.strictEqual(patchScreenCopy({ step: 'working' }).backLabel, '');
});

test('patchScreenCopy: the chooser is already the way out (issue #190)', () => {
	const copy = patchScreenCopy({ step: 'choose' });
	assert.strictEqual(copy.backLabel, '');
	assert.strictEqual(copy.footerNote, '');
});

test('patchScreenCopy: a dry run never claims a pull request (issue #190)', () => {
	const dry = patchScreenCopy({ step: 'done', dryRun: true });
	assert.ok(!/pull request opened/i.test(dry.heading));
	assert.match(dry.subheading, /No pull request was opened/);

	const real = patchScreenCopy({ step: 'done' });
	assert.strictEqual(real.heading, 'Pull request opened');
});

test('patchScreenCopy: the failure heading names the cause it was given (issue #190)', () => {
	assert.strictEqual(
		patchScreenCopy({ step: 'failed', failureReason: 'rate-limited' }).heading,
		PR_FAILURES['rate-limited'].title
	);
	assert.strictEqual(
		patchScreenCopy({ step: 'failed', failureReason: 'something-new' }).heading,
		DEFAULT_FAILURE_TITLE
	);
	assert.strictEqual(
		patchScreenCopy({ step: 'failed' }).heading,
		DEFAULT_FAILURE_TITLE
	);
});

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

test('prFailureMessage: a known reason is explained in the app\'s own words (issue #190)', () => {
	assert.strictEqual(
		prFailureMessage({ reason: 'unauthorized', error: 'HTTP 401' }),
		PR_FAILURES.unauthorized.message
	);
});

test('prFailureMessage: an unknown reason still shows what the flow reported (issue #190)', () => {
	assert.strictEqual(
		prFailureMessage({ reason: 'teapot', error: 'GitHub returned 418.' }),
		'GitHub returned 418.'
	);
	assert.strictEqual(prFailureMessage({ reason: 'teapot' }), '');
	assert.strictEqual(prFailureMessage(null), '');
});
