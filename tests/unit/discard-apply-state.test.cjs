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

// "Discard your changes" keeps the patch (#669), so its banner stays.
test('a discard that kept the patch keeps it on screen', () => {
	assert.deepEqual(applyFeedbackAfterDiscard({ ok: true, keptPatch: 'x.diff' }, {
		appliedPatch: { label: 'x.diff' },
		applyError: 'Older error',
		applyConflict: null,
		applyNotice: 'Older notice'
	}), {
		appliedPatch: { label: 'x.diff' },
		applyError: '',
		applyConflict: null,
		applyNotice: ''
	});
});

test('a discard that could not put the patch back says so', () => {
	assert.deepEqual(applyFeedbackAfterDiscard({ ok: true, removedPatch: 'x.diff', patchLost: true }, {
		appliedPatch: { label: 'x.diff' },
		applyError: '',
		applyConflict: null,
		applyNotice: ''
	}), {
		appliedPatch: null,
		applyError: 'Your changes were discarded, but x.diff could not be put back, so it is no longer applied.',
		applyConflict: null,
		applyNotice: ''
	});
});
