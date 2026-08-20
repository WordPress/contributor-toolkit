'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyFeedbackAfterDiscard } = require('../../src/renderer/changes-note.cjs');

test('a successful discard clears the apply failure it resolved', () => {
	assert.deepEqual(applyFeedbackAfterDiscard({ ok: true }, {
		appliedPatch: { label: 'PR #13017' },
		applyError: 'The patch could not be lifted back out.',
		applyConflict: { headline: '1 change needs rework' },
		applyNotice: 'Older notice'
	}), {
		appliedPatch: null,
		applyError: '',
		applyConflict: null,
		applyNotice: ''
	});
});

test('a failed discard preserves the failure the contributor still needs', () => {
	const current = {
		appliedPatch: { label: 'PR #13017' },
		applyError: 'The patch could not be lifted back out.',
		applyConflict: { headline: '1 change needs rework' },
		applyNotice: ''
	};
	assert.strictEqual(applyFeedbackAfterDiscard({ ok: false }, current), current);
});
