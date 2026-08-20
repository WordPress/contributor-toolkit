'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { prDateLabel } = require('../../src/renderer/pr-date-label.cjs');

test('prDateLabel: a resolved commit date is what the row shows (issue #281)', () => {
	assert.deepStrictEqual(
		prDateLabel({ commitDate: '2026-04-12T11:30:00Z', updatedAt: '2026-07-06T03:10:28Z' }),
		{ prefix: 'last commit', when: '2026-04-12T11:30:00Z' },
		'the force-push stamp is on the object and must not be the one shown'
	);
});

test('prDateLabel: without a commit date the row says "updated", not nothing (issue #281)', () => {
	assert.deepStrictEqual(
		prDateLabel({ commitDate: null, updatedAt: '2026-07-06T03:10:28Z' }),
		{ prefix: 'updated', when: '2026-07-06T03:10:28Z' }
	);
	// The deliberate asymmetry with latest-patch.cjs: that module must never
	// fall back to `updatedAt`, because an undated PR does not compete for the
	// pill. The row shows it, labelled, because a date a contributor can read
	// beats a blank line.
	assert.strictEqual(prDateLabel({ updatedAt: '2026-07-06T03:10:28Z' }).prefix, 'updated');
});

test('prDateLabel: a row with no dates at all yields null, not a broken label (issue #281)', () => {
	assert.strictEqual(prDateLabel({}), null);
	assert.strictEqual(prDateLabel(null), null);
	assert.strictEqual(prDateLabel({ commitDate: '', updatedAt: '' }), null);
});
