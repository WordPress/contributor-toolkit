'use strict';

// The applied patch as a layer with a name (#306): who owns which file, and
// which of the banner's faces the checkout has earned. Pure — the module holds
// the branching so the component does not, which is what makes this reachable.

const test = require('node:test');
const assert = require('node:assert');
const { attributeConflicts, describeAppliedLayer, layerExitFailure, listOf } = require('../src/renderer/applied-layer.cjs');
const { describeApplyFailure } = require('../src/renderer/apply-conflict.cjs');

const FOO = 'src/wp-login.php';
const BAR = 'src/wp-admin/edit.php';

const layer = (over = {}) => ({
	label: 'PR #123',
	appliedAt: '2026-08-12T10:00:00.000Z',
	files: [FOO],
	kept: true,
	revertable: true,
	...over
});

// --- attribution ----------------------------------------------------------

test('attributeConflicts: a layer file is named without excluding later contributor edits (#306)', () => {
	const { yours, fromLayer, sentences } = attributeConflicts({
		conflicts: [FOO],
		appliedPatch: layer()
	});

	assert.deepStrictEqual(yours, []);
	assert.deepStrictEqual(fromLayer, [FOO]);
	// The warning does not go quiet — the file is still named, just attributed.
	assert.ok(sentences.some((s) => s.includes(FOO) && s.includes('PR #123')));
	assert.ok(sentences.some((s) => /includes changes from/.test(s)));
	assert.ok(!sentences.some((s) => /not by you/.test(s)));
	assert.ok(!sentences.some((s) => s.startsWith('You have your own edits')));
});

test('attributeConflicts: the two owners are named separately, not merged (#306)', () => {
	const { yours, fromLayer, sentences } = attributeConflicts({
		conflicts: [FOO, BAR],
		appliedPatch: layer()
	});

	assert.deepStrictEqual(yours, [BAR]);
	assert.deepStrictEqual(fromLayer, [FOO]);
	assert.strictEqual(sentences.length, 3);
	assert.ok(sentences[0].includes(BAR) && !sentences[0].includes(FOO));
	assert.ok(sentences[1].includes(FOO) && !sentences[1].includes(BAR));
});

test('attributeConflicts: with no patch applied every file is the contributor\'s (#306)', () => {
	const { yours, fromLayer, sentences } = attributeConflicts({ conflicts: [FOO, BAR], appliedPatch: null });

	assert.deepStrictEqual(yours, [FOO, BAR]);
	assert.deepStrictEqual(fromLayer, []);
	assert.ok(sentences[0].startsWith('You have your own edits'));
});

test('attributeConflicts: a clean tree says nothing at all (#306)', () => {
	assert.deepStrictEqual(attributeConflicts({ conflicts: [], appliedPatch: layer() }).sentences, []);
	assert.deepStrictEqual(attributeConflicts().sentences, []);
});

test('describeApplyFailure: an applied-layer-only conflict keeps ownership uncertain (#306)', () => {
	const notice = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [{ path: FOO, total: 1, regions: [{ index: 0, line: 7, status: 'moved' }] }]
	}, {
		prUrl: 'https://example.invalid/pr/456',
		prState: 'open',
		ownWorkPaths: [FOO],
		appliedPatch: layer()
	});

	assert.match(notice.headline, /includes changes from PR #123/);
	assert.match(notice.headline, /may also contain your own edits/);
	assert.doesNotMatch(notice.headline, /Your own work is also in/);
});

test('describeApplyFailure: already-present layer changes are not claimed as trunk (#306)', () => {
	const notice = describeApplyFailure({
		ok: false,
		failures: [`${FOO} looks already applied`],
		conflicts: [{ path: FOO, total: 1, regions: [{ index: 0, line: 7, status: 'already-applied' }] }]
	}, {
		prUrl: 'https://example.invalid/pr/456',
		prState: 'open',
		ownWorkPaths: [FOO],
		appliedPatch: layer()
	});

	assert.match(notice.headline, /already in your checkout/);
	assert.doesNotMatch(notice.headline, /already in trunk/);
	assert.equal(notice.prButton, 'Open the pull request');
});

test('listOf: reads as a sentence rather than a join (#306)', () => {
	assert.strictEqual(listOf([]), '');
	assert.strictEqual(listOf(['a']), 'a');
	assert.strictEqual(listOf(['a', 'b']), 'a and b');
	assert.strictEqual(listOf(['a', 'b', 'c']), 'a, b and c');
});

// --- the banner's faces ---------------------------------------------------

test('describeAppliedLayer: nothing applied, nothing to say (#306)', () => {
	assert.strictEqual(describeAppliedLayer(null), null);
});

test('describeAppliedLayer: while it still comes out, Revert is the only offer (#306)', () => {
	const face = describeAppliedLayer(layer(), { when: '12/08/2026' });

	assert.strictEqual(face.canRevert, true);
	assert.strictEqual(face.offerCopy, false);
	assert.strictEqual(face.explanation, '');
	assert.strictEqual(face.summary, 'is applied — 1 file, 12/08/2026.');
});

// Discarding is a recommendable step here, not an admission of failure — the
// wording is the point, so it is asserted rather than left to drift.
test('describeAppliedLayer: the exit is worded as a normal way forward (#306)', () => {
	const face = describeAppliedLayer(layer({ kept: false, revertable: false }));

	assert.ok(/not a lost afternoon/.test(face.note));
	assert.ok(/Save a copy of your work/.test(face.note));
});

test('describeAppliedLayer: a patch too large to keep offers the disposable-ticket exit (#306)', () => {
	const face = describeAppliedLayer(layer({ kept: false, revertable: false }));

	assert.strictEqual(face.canRevert, false);
	assert.strictEqual(face.offerCopy, true);
	assert.ok(/too large to keep a copy of/.test(face.explanation));
	assert.deepStrictEqual(face.detail, []);
});

// A record written before this change carries `revertable` and no `kept`.
test('describeAppliedLayer: an older record without `kept` still reads correctly (#306)', () => {
	assert.strictEqual(describeAppliedLayer({ label: 'x', files: [FOO], revertable: true }).canRevert, true);
	assert.strictEqual(describeAppliedLayer({ label: 'x', files: [FOO], revertable: false }).canRevert, false);
});

// --- the revert failure's narration ---------------------------------------

const revertFailure = {
	ok: false,
	failures: [`${FOO} has moved on since the patch was written, so none of its 3 changes still fits`],
	conflicts: [{
		path: FOO,
		error: `${FOO} has moved on since the patch was written, so none of its 3 changes still fits`,
		total: 3,
		regions: [
			{ index: 0, line: 10, status: 'moved', anchor: 'a', lines: [] },
			{ index: 1, line: 20, status: 'moved', anchor: 'b', lines: [] },
			{ index: 2, line: 30, status: 'moved', anchor: 'c', lines: [] }
		]
	}]
};

test('describeApplyFailure: a failed revert blames the contributor\'s own edits, not the author (#306)', () => {
	const notice = describeApplyFailure(revertFailure, { reverting: 'PR #123', prUrl: 'https://example.invalid/pr/1', prState: 'open' });

	assert.ok(notice.headline.startsWith('PR #123 cannot be lifted back out on its own'));
	assert.ok(/your own edits are on 3 of its 3 changes/.test(notice.headline));
	// The pull request's author has nothing to do with a revert.
	assert.strictEqual(notice.prUrl, null);
	assert.strictEqual(notice.prButton, null);
	assert.ok(!/rebase/.test(notice.advice));
});

test('describeApplyFailure: a failed revert offers the copy-and-discard exit, not another patch (#306)', () => {
	const notice = describeApplyFailure(revertFailure, { reverting: 'PR #123', otherPatchCount: 4 });

	assert.strictEqual(notice.offerDiscardToBase, true);
	assert.strictEqual(notice.offerOtherPatches, false);
	assert.ok(/Undoing your edits on those lines brings Revert back/.test(notice.advice));
	assert.ok(/not a lost afternoon/.test(notice.advice));
	// The contributor owns these lines, so the per-region detail is theirs to see.
	assert.strictEqual(notice.items[0].regions.length, 3);
});

test('describeApplyFailure: a forward apply is unaffected by the revert framing (#306)', () => {
	const notice = describeApplyFailure(revertFailure, { prUrl: 'https://example.invalid/pr/1', prState: 'open', otherPatchCount: 2 });

	assert.strictEqual(notice.offerDiscardToBase, false);
	assert.strictEqual(notice.offerOtherPatches, true);
	assert.strictEqual(notice.prUrl, 'https://example.invalid/pr/1');
	assert.ok(/author/.test(notice.advice));
});

// `already-applied` is derived by testing the inverse of what is being applied,
// so on a revert it means the opposite of what it means going forwards. Reading
// the forward wording out loud there contradicts the headline above it.
test('describeApplyFailure: a revert reads `already-applied` backwards (#306)', () => {
	const withApplied = {
		...revertFailure,
		conflicts: [{ ...revertFailure.conflicts[0], regions: [{ index: 0, line: 10, status: 'already-applied', anchor: 'a', lines: [] }] }]
	};

	const reverting = describeApplyFailure(withApplied, { reverting: 'PR #123' });
	assert.strictEqual(reverting.items[0].regions[0].reason, 'looks like that change is not in your checkout any more');

	const forward = describeApplyFailure(withApplied, {});
	assert.strictEqual(forward.items[0].regions[0].reason, 'looks like it is already in your checkout');
});

// --- the exits' own failures ---------------------------------------------

test('layerExitFailure: silence when neither exit has failed (#306)', () => {
	assert.strictEqual(layerExitFailure().message, '');
	assert.strictEqual(layerExitFailure({ patchSaveError: '', discardError: '' }).message, '');
});

test('layerExitFailure: the save is the failure that must not be missed (#306)', () => {
	const both = layerExitFailure({ patchSaveError: 'EACCES', discardError: 'could not reset' });
	assert.ok(both.message.includes('EACCES'));
	assert.ok(!both.message.includes('could not reset'));

	assert.strictEqual(layerExitFailure({ discardError: 'could not reset' }).message, 'could not reset');
});
