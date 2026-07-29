'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { computeSetupStepState } = require('../src/renderer/setup-steps.cjs');

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
