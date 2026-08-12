'use strict';

// What the panel says when a patch will not apply (#282).
//
// The failure it exists for: "this file has moved on" read the same whether one
// region of twenty missed or all twenty did, and only the first failing file
// ever reached the screen. Both of those are decisions the contributor makes
// differently — rescue the patch by hand, or abandon it — so both are asserted
// here rather than left to the panel.

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeApplyFailure, otherPatchCount, REASONS } = require('../src/renderer/apply-conflict.cjs');

const FOO = 'src/wp-includes/foo.php';
const BAR = 'src/wp-includes/bar.php';

function conflict(path, total, regions) {
	return { path, error: `${path} has moved on`, total, regions };
}

// --- nothing to explain --------------------------------------------------

test('describeApplyFailure: a success has nothing to say (issue #282)', () => {
	assert.equal(describeApplyFailure({ ok: true, applied: [FOO] }), null);
	assert.equal(describeApplyFailure(null), null);
});

// A failure with no structured detail is every refusal that is not a conflict —
// a parse error, a rolled-back write, main declining. The panel already renders
// `error` for those, and inventing a second empty banner beside it would be
// noise, so this stands down rather than returning an itemless shell.
test('describeApplyFailure: a failure with no detail leaves the plain error alone (issue #282)', () => {
	assert.equal(describeApplyFailure({ ok: false, error: 'The patch does not change any files.' }), null);
});

// --- the count that changes the decision ---------------------------------

test('describeApplyFailure: a mostly-fitting patch says so, in counts (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 20, [
			{ index: 0, line: 40, status: 'moved', lines: ['-a', '+b'] },
			{ index: 1, line: 58, status: 'moved' }
		])]
	});

	// The whole point of the issue: 2 of 20 is a patch worth ten minutes, and
	// "it no longer applies" is one that gets thrown away.
	assert.match(result.headline, /2 of this patch's 20 changes/);
	assert.match(result.headline, /the other 18 do/);
	assert.equal(result.items.length, 1);
	assert.equal(result.items[0].failed, 2);
	assert.equal(result.items[0].total, 20);
});

test('describeApplyFailure: a patch that misses everywhere does not claim a salvageable remainder (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 2, [
			{ index: 0, line: 1, status: 'moved' },
			{ index: 1, line: 9, status: 'moved' }
		])]
	});

	assert.match(result.headline, /None of this patch's 2 changes/);
	assert.doesNotMatch(result.headline, /the other/);
});

test('describeApplyFailure: counts span every failing file (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`, `${BAR} has moved on`],
		conflicts: [
			conflict(FOO, 5, [{ index: 0, line: 3, status: 'moved' }]),
			conflict(BAR, 5, [{ index: 0, line: 7, status: 'moved' }])
		]
	});

	assert.match(result.headline, /2 of this patch's 10 changes across 2 files/);
	assert.equal(result.items.length, 2);
});

// A patch whose changes are all in the tree fails every region, and a headline
// counting fits ("none still fit") over rows saying "already in your checkout"
// would be the banner contradicting itself — with the headline being the half
// that decides whether the patch gets thrown away (issue #226).
test('describeApplyFailure: an all-already-applied patch is not announced as dead (issue #226)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 2, [
			{ index: 0, line: 4, status: 'already-applied' },
			{ index: 1, line: 19, status: 'already-applied' }
		])]
	});

	assert.match(result.headline, /All 2 of this patch's changes look like they are already in your checkout/);
	assert.doesNotMatch(result.headline, /still fit your checkout/);
});

test('describeApplyFailure: a partly-applied patch says both halves (issue #226)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 5, [
			{ index: 0, line: 4, status: 'already-applied' }
		])]
	});

	assert.match(result.headline, /1 of this patch's 5 changes look like they are already in your checkout/);
	assert.match(result.headline, /the other 4 still fit/);
});

// One region genuinely moved keeps the plain counting headline: "already in
// your checkout" as a summary would be wrong about that region.
test('describeApplyFailure: mixed reasons keep the counting headline (issue #226)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 5, [
			{ index: 0, line: 4, status: 'already-applied' },
			{ index: 1, line: 19, status: 'moved' }
		])]
	});

	assert.match(result.headline, /2 of this patch's 5 changes no longer fit/);
});

// A concatenated patch can fail the same file twice with the identical
// sentence. A lookup by sentence would render one breakdown twice and lose the
// other from the counts; matching consumes each conflict once instead.
test('describeApplyFailure: two identical failure sentences get their own breakdowns (issue #282)', () => {
	const sentence = `${FOO} has moved on`;
	const result = describeApplyFailure({
		ok: false,
		failures: [sentence, sentence],
		conflicts: [
			conflict(FOO, 3, [{ index: 0, line: 1, status: 'moved' }]),
			conflict(FOO, 4, [{ index: 0, line: 9, status: 'moved' }])
		]
	});

	assert.equal(result.items.length, 2);
	assert.deepEqual(result.items.map((i) => i.total), [3, 4]);
});

// --- every failure reaches the screen, not just the first ----------------

test('describeApplyFailure: a second failing file is not dropped (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		error: `${FOO} has moved on`,
		failures: [`${FOO} has moved on`, `${BAR} is not in this checkout`],
		conflicts: [conflict(FOO, 3, [{ index: 0, line: 1, status: 'moved' }])]
	});

	assert.equal(result.items.length, 2);
	// Mixed reasons stay one list, in the order they were reported: a file whose
	// regions drifted, then one that is simply absent and has no regions at all.
	assert.equal(result.items[0].kind, 'conflict');
	assert.deepEqual(result.items[1], { kind: 'note', text: `${BAR} is not in this checkout` });
});

// --- why it failed (issue #226) ------------------------------------------

test('describeApplyFailure: tells "already there" apart from "the code moved" (issue #226)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 4, [
			{ index: 0, line: 40, status: 'already-applied' },
			{ index: 1, line: 58, status: 'moved' }
		])]
	});

	const [redundant, drifted] = result.items[0].regions;
	assert.equal(redundant.reason, REASONS['already-applied']);
	assert.equal(drifted.reason, REASONS.moved);
	// Hedged, because matching searches for a fit and can find one in the wrong
	// place. A sentence that sounds certain here would be the app overstating
	// evidence it cannot have.
	assert.match(redundant.reason, /looks like/);
});

test('describeApplyFailure: an unknown status still gets a sentence (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 1, [{ index: 0, line: 2, status: 'something-new' }])]
	});

	assert.equal(result.items[0].regions[0].reason, 'it no longer fits');
});

// --- what the region was trying to do ------------------------------------

test('describeApplyFailure: carries the lines a region wanted to change (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 1, [
			{ index: 0, line: 40, status: 'moved', lines: ['-return $out;', '+return apply_filters( $out );'], more: 4 }
		])]
	});

	const region = result.items[0].regions[0];
	assert.deepEqual(region.lines, ['-return $out;', '+return apply_filters( $out );']);
	assert.equal(region.more, 4);
});

test('describeApplyFailure: carries the anchor, and falls back to the patch line without one (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 2, [
			{ index: 0, line: 40, status: 'moved', anchor: 'return $out;' },
			{ index: 1, line: 90, status: 'moved' }
		])]
	});

	const [anchored, bare] = result.items[0].regions;
	assert.equal(anchored.anchor, 'return $out;');
	// The fallback is empty-string, not undefined: the panel branches on it to
	// decide between "near `…`" and the patch's own line number.
	assert.equal(bare.anchor, '');
	assert.equal(bare.line, 90);
});

test('describeApplyFailure: a region with no lines renders as an empty list, not undefined (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 9, [{ index: 8, line: 300, status: 'moved' }])]
	});

	assert.deepEqual(result.items[0].regions[0].lines, []);
	assert.equal(result.items[0].regions[0].more, 0);
});

// --- the ways out --------------------------------------------------------

test('describeApplyFailure: offers the other patches only when there are some (issue #282)', () => {
	const payload = {
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 1, [{ index: 0, line: 1, status: 'moved' }])]
	};

	assert.equal(describeApplyFailure(payload, { otherPatchCount: 1 }).offerOtherPatches, true);
	// The only patch on the ticket is the one that just failed: a button back to
	// the same list is a click that teaches the contributor nothing.
	assert.equal(describeApplyFailure(payload, { otherPatchCount: 0 }).offerOtherPatches, false);
	assert.equal(describeApplyFailure(payload).offerOtherPatches, false);
});

// --- the pull-request framing --------------------------------------------
//
// The regions belong to whoever updates the pull request — its author. The
// contributor gets the situation, the scale, and their one real act: telling
// the author. Line-level detail is for patches with nobody behind them.

const PR_URL = 'https://github.com/WordPress/wordpress-develop/pull/7871';

test('describeApplyFailure: a pull request failure names the stale side and the scale, not the lines (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 24, [
			{ index: 0, line: 18, status: 'moved', lines: ['-a', '+b'] },
			{ index: 1, line: 69, status: 'moved' }
		])]
	}, { prUrl: PR_URL, otherPatchCount: 1 });

	// The stale side is the pull request, said outright — not "your checkout".
	assert.match(result.headline, /written against an older trunk/);
	// The scale, so the contributor can size it: places and files.
	assert.match(result.headline, /2 of its 24 changes, in 1 file/);
	// Whose work the fix is, and what the contributor can actually do.
	assert.match(result.advice, /author's work/);
	assert.match(result.advice, /comment on the pull request/);
	// The file row survives for the summary; the regions do not.
	assert.equal(result.items[0].failed, 2);
	assert.deepEqual(result.items[0].regions, []);
});

// A closed pull request has no author coming back to it. Asking for a rebase
// would send the contributor's one act into the void — and in wordpress-develop
// "closed" is also what landing looks like, since core commits via SVN.
test('describeApplyFailure: a closed pull request is not offered a rebase (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 3, [{ index: 0, line: 7, status: 'moved' }])]
	}, { prUrl: PR_URL, prState: 'closed' });

	assert.match(result.headline, /closed and was written against an older trunk/);
	assert.doesNotMatch(result.advice, /rebase/);
	assert.match(result.advice, /Nobody is coming back/);
	// The PR is still worth opening — its discussion says why it ended — but
	// the button says that, not "ask for a rebase".
	assert.equal(result.prButton, 'See why it was closed');
	assert.equal(result.prUrl, PR_URL);
});

test('describeApplyFailure: a closed PR already in trunk reads as landed, not dead (issue #226)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 2, [
			{ index: 0, line: 4, status: 'already-applied' },
			{ index: 1, line: 9, status: 'already-applied' }
		])]
	}, { prUrl: PR_URL, prState: 'closed' });

	// Core lands through SVN and closes the PR; the regions reading back as
	// already-present is what that looks like from the checkout.
	assert.match(result.headline, /likely committed to core/);
	assert.equal(result.prButton, null);
	assert.equal(result.prUrl, null, 'no button, no url — nothing to do with the PR');
});

test('describeApplyFailure: an unknown PR state keeps the open framing (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 3, [{ index: 0, line: 7, status: 'moved' }])]
	}, { prUrl: PR_URL });

	// A PR pasted by number carries no state; assuming open keeps the rebase
	// path available rather than withholding it on missing data.
	assert.equal(result.prButton, 'Ask its author for a rebase');
});

test('describeApplyFailure: a pull request already in trunk asks for nothing (issue #226)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 2, [
			{ index: 0, line: 4, status: 'already-applied' },
			{ index: 1, line: 9, status: 'already-applied' }
		])]
	}, { prUrl: PR_URL });

	assert.match(result.headline, /already in trunk — there is nothing left to apply/);
	// No rebase to ask for: the advice line stands down.
	assert.equal(result.advice, '');
});

test('describeApplyFailure: a loose patch keeps the full breakdown — there is no author to send to (issue #282)', () => {
	const result = describeApplyFailure({
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 3, [
			{ index: 0, line: 7, status: 'moved', lines: ['-x', '+y'] }
		])]
	});

	assert.equal(result.items[0].regions.length, 1);
	assert.deepEqual(result.items[0].regions[0].lines, ['-x', '+y']);
	assert.equal(result.advice, '');
});

// The count feeding offerOtherPatches, as its own unit: it lives here rather
// than in index.jsx so the label-matching (a failed PR by `PR #n`, a failed
// attachment — or the same file picked from disk — by filename) is testable.
test('otherPatchCount: excludes the failed patch from either list (issue #282)', () => {
	const prs = [{ number: 7871 }, { number: 11517 }];
	const attachments = [{ filename: '62064.diff' }];

	assert.equal(otherPatchCount({ label: 'PR #7871', prs, attachments }), 2);
	assert.equal(otherPatchCount({ label: '62064.diff', prs, attachments }), 2);
	// The same attachment picked from disk carries its filename as the label,
	// so it is excluded the same way as one applied from the list.
	assert.equal(otherPatchCount({ label: '62064.diff', prs: [], attachments }), 0);
	assert.equal(otherPatchCount({ label: 'unrelated.diff', prs, attachments }), 3);
	assert.equal(otherPatchCount({}), 0);
});

test('describeApplyFailure: carries the pull request only when the patch came from one (issue #282)', () => {
	const payload = {
		ok: false,
		failures: [`${FOO} has moved on`],
		conflicts: [conflict(FOO, 1, [{ index: 0, line: 1, status: 'moved' }])]
	};

	const url = 'https://github.com/WordPress/wordpress-develop/pull/1234';
	assert.equal(describeApplyFailure(payload, { prUrl: url }).prUrl, url);
	// A .diff chosen off disk has no pull request to ask for a rebase on.
	assert.equal(describeApplyFailure(payload).prUrl, null);
});
