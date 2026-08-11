'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { computeSetupStepState, setupStepLabel } = require('../src/renderer/setup-steps.cjs');

test('while the clone is still running, the install step is locked (issue #47)', () => {
	const steps = computeSetupStepState({ isPending: true });

	assert.strictEqual(steps.download.done, false, 'download must not read as complete mid-clone');
	assert.strictEqual(steps.install.ready, false, 'install must stay locked mid-clone');
	assert.strictEqual(steps.install.disabled, true, 'install button must be disabled mid-clone');
});

test('a pending clone never unlocks the later steps', () => {
	const steps = computeSetupStepState({ isPending: true, hasNodeModules: true, hasBuilt: true });

	assert.strictEqual(steps.install.disabled, true);
	assert.strictEqual(steps.download.done, false);
});

test('once the clone finishes the install step becomes actionable', () => {
	const steps = computeSetupStepState({ isPending: false });

	assert.strictEqual(steps.download.done, true);
	assert.strictEqual(steps.install.ready, true);
	assert.strictEqual(steps.install.disabled, false);
});

test('the status probe still gates the install button', () => {
	const steps = computeSetupStepState({ statusLoading: true });

	assert.strictEqual(steps.install.disabled, true);
});

test('an install in flight disables its own button', () => {
	const steps = computeSetupStepState({ installing: true });

	assert.strictEqual(steps.install.disabled, true);
	assert.strictEqual(steps.install.done, false);
});

test('installed dependencies complete the install step and unlock the build', () => {
	const steps = computeSetupStepState({ hasNodeModules: true });

	assert.strictEqual(steps.install.done, true);
	assert.strictEqual(steps.install.disabled, true, 'nothing left to install');
	assert.strictEqual(steps.build.ready, true);
	assert.strictEqual(steps.build.disabled, false);
});

test('a failed install does not complete the step, even though node_modules exists (issue #42)', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, installFailed: true });

	assert.strictEqual(steps.install.done, false, 'a failed install is not a completed step');
	assert.strictEqual(steps.install.disabled, false, 'the retry must stay available');
	assert.strictEqual(steps.build.ready, false, 'the build stays locked after a failed install');
	assert.strictEqual(steps.build.disabled, true);
});

test('a successful install after a failure completes the step again', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, installFailed: false });

	assert.strictEqual(steps.install.done, true);
	assert.strictEqual(steps.build.ready, true);
});

test('the build stays locked without node_modules', () => {
	const steps = computeSetupStepState({});

	assert.strictEqual(steps.build.ready, false);
	assert.strictEqual(steps.build.disabled, true);
});

test('a finished build completes its step and unlocks the dev server', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true });

	assert.strictEqual(steps.build.done, true);
	assert.strictEqual(steps.build.disabled, true, 'nothing left to build');
	assert.strictEqual(steps.dev.ready, true);
	assert.strictEqual(steps.dev.disabled, false);
});

test('the dev step is never marked done by the checklist', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true, starting: true });

	assert.strictEqual(steps.dev.done, false);
	assert.strictEqual(steps.dev.disabled, true, 'disabled while starting');
});

test('a trunk update in flight locks the checklist even before its own install/build flags are set (#111 review)', () => {
	// The update chain's fetch step runs before `installing`/`building` are
	// ever set, so this reproduces the exact window a race would occur in:
	// node_modules and a build already exist, nothing is "installing" yet,
	// but the working tree is being reset underneath the checklist.
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true, isUpdating: true });

	assert.strictEqual(steps.install.disabled, true, 'install must not race the update chain\'s checkout');
	assert.strictEqual(steps.build.disabled, true, 'build must not race the update chain\'s checkout');
	assert.strictEqual(steps.dev.disabled, true, 'the dev server must not start against a tree the update owns');
});

test('a finished update releases the checklist again', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true, isUpdating: false });

	assert.strictEqual(steps.install.disabled, true, 'nothing left to install');
	assert.strictEqual(steps.build.disabled, true, 'nothing left to build');
	assert.strictEqual(steps.dev.disabled, false);
});

test('the current step reads "Ready" until its action starts (#257)', () => {
	// The exact case from the report: a fresh site, install is the next step,
	// nothing is running. It must not claim to be under way.
	assert.strictEqual(setupStepLabel('current', false), 'Ready');
});

test('the current step reads "In progress" once its action is running (#257)', () => {
	assert.strictEqual(setupStepLabel('current', true), 'In progress');
});

test('the other statuses keep their fixed labels regardless of the running flag', () => {
	for (const running of [true, false]) {
		assert.strictEqual(setupStepLabel('complete', running), 'Completed');
		assert.strictEqual(setupStepLabel('pending', running), 'Pending');
		assert.strictEqual(setupStepLabel('locked', running), 'Locked');
	}
});
