'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { deriveNextAction } = require('../src/renderer/next-action.cjs');

test('during setup, the next action is the checklist\'s current step', () => {
	const next = deriveNextAction({ skipInit: false, currentSetupStep: 'install' });

	assert.deepStrictEqual(next && next.id, 'setup-install');
});

test('setup defers entirely to the checklist, ignoring post-init flags', () => {
	// The post-init flags below would each point somewhere if the wizard were
	// skipped; while the checklist shows, none of them may override it.
	const next = deriveNextAction({
		skipInit: false,
		currentSetupStep: 'build',
		updateIncomplete: true,
		stale: true,
		running: false
	});

	assert.strictEqual(next.id, 'setup-build');
});

test('during setup with no current step, nothing is pointed at', () => {
	const next = deriveNextAction({ skipInit: false, currentSetupStep: null });

	assert.strictEqual(next, null);
});

test('an incomplete update outranks everything post-init', () => {
	const next = deriveNextAction({
		skipInit: true,
		updateIncomplete: true,
		stale: true,
		running: false,
		hasChanges: true,
		ticketLinked: false
	});

	assert.strictEqual(next.id, 'retry-install-build');
});

test('an update in flight suppresses the retry banner and points at its tracker', () => {
	// updateIncomplete is set during the window an update owns the tree; while the
	// update is actually running there is nothing to retry, only progress to find.
	const next = deriveNextAction({
		skipInit: true,
		updateIncomplete: true,
		isUpdating: true
	});

	assert.strictEqual(next.id, 'updating');
});

test('a stale tree outranks the routine steps', () => {
	const next = deriveNextAction({
		skipInit: true,
		stale: true,
		running: false,
		hasChanges: true,
		ticketLinked: false
	});

	assert.strictEqual(next.id, 'update-trunk');
});

test('with nothing urgent, the first routine step is starting the dev server', () => {
	const next = deriveNextAction({
		skipInit: true,
		running: false,
		hasChanges: true,
		ticketLinked: false
	});

	assert.strictEqual(next.id, 'start-dev');
});

test('a running server with pending changes points at reviewing them', () => {
	const next = deriveNextAction({
		skipInit: true,
		running: true,
		hasChanges: true,
		ticketLinked: false
	});

	assert.strictEqual(next.id, 'review-changes');
});

test('a running, clean site with no ticket points at linking one', () => {
	const next = deriveNextAction({
		skipInit: true,
		running: true,
		hasChanges: false,
		ticketLinked: false
	});

	assert.strictEqual(next.id, 'link-ticket');
});

test('a running, clean, linked site has no next action', () => {
	const next = deriveNextAction({
		skipInit: true,
		running: true,
		hasChanges: false,
		ticketLinked: true
	});

	assert.strictEqual(next, null);
});

test('missing state is treated as nothing pending, not a crash', () => {
	assert.strictEqual(deriveNextAction(), null);
	assert.strictEqual(deriveNextAction({}), null);
});
