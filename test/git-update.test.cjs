'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	isDirtyFromStatusMatrix,
	staleStagedPaths,
	lockfileChangedFromBlobOids
} = require('../src/git-update.cjs');

test('isDirtyFromStatusMatrix: clean tree (issue #94)', () => {
	const matrix = [
		['a.php', 1, 1, 1],
		['b.php', 1, 1, 1]
	];
	assert.deepStrictEqual(isDirtyFromStatusMatrix(matrix), { dirty: false, changedCount: 0 });
});

test('isDirtyFromStatusMatrix: modified, deleted and untracked files are dirty (issue #94)', () => {
	assert.strictEqual(isDirtyFromStatusMatrix([['m.php', 1, 2, 1]]).dirty, true); // modified
	assert.strictEqual(isDirtyFromStatusMatrix([['d.php', 1, 0, 1]]).dirty, true); // deleted
	assert.strictEqual(isDirtyFromStatusMatrix([['u.php', 0, 2, 0]]).dirty, true); // untracked
});

test('isDirtyFromStatusMatrix: staged-but-identical to HEAD is clean — no patch hunks would result (issue #94)', () => {
	assert.deepStrictEqual(isDirtyFromStatusMatrix([['s.php', 1, 1, 3]]), { dirty: false, changedCount: 0 });
});

test('isDirtyFromStatusMatrix: untracked file staged by a prior patch generation is dirty (issue #94)', () => {
	assert.strictEqual(isDirtyFromStatusMatrix([['new.php', 0, 2, 2]]).dirty, true);
});

test('isDirtyFromStatusMatrix: empty or missing matrix is clean (issue #94)', () => {
	assert.deepStrictEqual(isDirtyFromStatusMatrix([]), { dirty: false, changedCount: 0 });
	assert.deepStrictEqual(isDirtyFromStatusMatrix(undefined), { dirty: false, changedCount: 0 });
});

test('staleStagedPaths: picks only staged files absent from HEAD (issue #94)', () => {
	const matrix = [
		['tracked.php', 1, 2, 3],
		['staged-untracked.php', 0, 2, 2],
		['plain-untracked.php', 0, 2, 0],
		['staged-then-deleted.php', 0, 0, 3]
	];
	assert.deepStrictEqual(staleStagedPaths(matrix), ['staged-untracked.php', 'staged-then-deleted.php']);
});

test('lockfileChangedFromBlobOids: both absent -> unchanged (issue #94)', () => {
	assert.strictEqual(lockfileChangedFromBlobOids(null, null), false);
});

test('lockfileChangedFromBlobOids: presence differing -> changed (issue #94)', () => {
	assert.strictEqual(lockfileChangedFromBlobOids('abc', null), true);
	assert.strictEqual(lockfileChangedFromBlobOids(null, 'abc'), true);
});

test('lockfileChangedFromBlobOids: same oid -> unchanged, different oid -> changed (issue #94)', () => {
	assert.strictEqual(lockfileChangedFromBlobOids('abc', 'abc'), false);
	assert.strictEqual(lockfileChangedFromBlobOids('abc', 'def'), true);
});
