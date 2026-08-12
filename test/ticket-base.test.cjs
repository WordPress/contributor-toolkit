'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	BASE_STATUS,
	UNRECORDED_CLEAR_NOTE,
	baseIsApproximate,
	baseUnreadableMessage,
	UNRECORDED_MEASUREMENT_NOTE
} = require('../src/renderer/ticket-base.cjs');
// The preview notice these sentences end up inside is composed there (#306/#308
// name the same block), so its cases live beside the attribution they qualify.
const { describePreviewNotice } = require('../src/renderer/applied-layer.cjs');

const describeOwnWorkWarning = (preview) => {
	const notice = describePreviewNotice(preview || {});
	return notice ? { level: notice.level, text: notice.sentences.join(' ') } : null;
};

// The healthy path, and the one that must not move: a recorded base is exact,
// so the warning reads exactly as it always has (issue #308).
test('describeOwnWorkWarning: a recorded base warns without hedging (issue #308)', () => {
	const notice = describeOwnWorkWarning({
		conflicts: ['src/wp-login.php'],
		baseStatus: BASE_STATUS.RECORDED
	});
	assert.strictEqual(notice.level, 'warning');
	assert.strictEqual(
		notice.text,
		'You have your own edits to src/wp-login.php. Save a patch of your work first if you want a copy. The patch is applied on top of those changes: it succeeds if they do not overlap, and fails without touching anything if they do.'
	);
	assert.ok(!notice.text.includes('approximate'));
	assert.ok(!notice.text.includes('may hold'));
});

test('describeOwnWorkWarning: an exact base with no collisions says nothing (issue #308)', () => {
	assert.strictEqual(describeOwnWorkWarning({ conflicts: [], baseStatus: BASE_STATUS.RECORDED }), null);
	assert.strictEqual(describeOwnWorkWarning({ conflicts: [], baseStatus: BASE_STATUS.TRUNK }), null);
	// No status at all is the pre-#308 shape of the payload, and is treated as
	// exact: a preview from an older main process must not start hedging.
	assert.strictEqual(describeOwnWorkWarning({ conflicts: [] }), null);
	assert.strictEqual(describeOwnWorkWarning(), null);
});

// The list is still shown — it is the best the app has — but as a list of
// candidates, not of facts. Measured against today's trunk, it can name files
// trunk moved on rather than the contributor.
test('describeOwnWorkWarning: an unrecorded base qualifies the warning (issue #308)', () => {
	const notice = describeOwnWorkWarning({
		conflicts: ['src/wp-login.php', 'src/wp-signup.php'],
		baseStatus: BASE_STATUS.UNRECORDED
	});
	assert.strictEqual(notice.level, 'warning');
	assert.ok(notice.text.startsWith('You have your own edits to src/wp-login.php and src/wp-signup.php.'));
	assert.ok(notice.text.includes(UNRECORDED_MEASUREMENT_NOTE));
	assert.ok(notice.text.includes('today\'s trunk'));
	// The advice that follows is unchanged — the hedge qualifies the list, not
	// what applying the patch does.
	assert.ok(notice.text.includes('fails without touching anything if they do'));
});

// Silence is an answer too, and on an approximate base it is not one the app
// can stand behind: a file the contributor did edit can be missing from a list
// measured against the wrong trunk.
test('describeOwnWorkWarning: an unrecorded base with no collisions is not a clean bill of health (issue #308)', () => {
	const notice = describeOwnWorkWarning({ conflicts: [], baseStatus: BASE_STATUS.UNRECORDED });
	assert.strictEqual(notice.level, 'note');
	assert.strictEqual(notice.text, UNRECORDED_CLEAR_NOTE);
	assert.ok(notice.text.includes('approximate'));
});

test('baseIsApproximate: only an unrecorded base is (issue #308)', () => {
	assert.strictEqual(baseIsApproximate(BASE_STATUS.UNRECORDED), true);
	assert.strictEqual(baseIsApproximate(BASE_STATUS.RECORDED), false);
	assert.strictEqual(baseIsApproximate(BASE_STATUS.TRUNK), false);
	assert.strictEqual(baseIsApproximate(BASE_STATUS.UNREADABLE), false);
	assert.strictEqual(baseIsApproximate(undefined), false);
});

// One shape, several consequences: what did not happen is the half the
// contributor acts on, and it differs per surface.
test('baseUnreadableMessage: names the failure and its consequence (issue #308)', () => {
	assert.strictEqual(
		baseUnreadableMessage('no patch was created'),
		'Could not work out which trunk to compare your work against, so no patch was created.'
	);
	assert.ok(baseUnreadableMessage('nothing was discarded').endsWith('so nothing was discarded.'));
});
