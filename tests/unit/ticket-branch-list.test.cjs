'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { relativeTimeLabel, ticketBranchRows, savedPrForSwitch, ticketListCard, deleteWorkQuestion } = require('../../src/renderer/ticket-branch-list.cjs');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const NOW = Date.parse('2026-08-05T12:00:00Z');

function ago(ms) {
	return new Date(NOW - ms).toISOString();
}

function branch(ticketId, overrides = {}) {
	return {
		ref: `ticket/${ticketId}`,
		ticketId,
		baseOid: 'abc123',
		lastUsedAt: null,
		appliedPatch: false,
		...overrides
	};
}

// --- ticketBranchRows -------------------------------------------------------

test('rows: most recently used first (issue #108)', () => {
	const rows = ticketBranchRows({
		branches: [
			branch(59234, { lastUsedAt: ago(3 * DAY_MS) }),
			branch(61002, { lastUsedAt: ago(1 * HOUR_MS) }),
			branch(60000, { lastUsedAt: ago(2 * DAY_MS) })
		],
		current: 'trunk',
		now: NOW
	});
	assert.deepStrictEqual(rows.map((r) => r.ticketId), [61002, 60000, 59234]);
});

test('rows: a branch with no lastUsedAt sorts after every dated one, tickets ascending', () => {
	const rows = ticketBranchRows({
		branches: [
			branch(63000),
			branch(59234, { lastUsedAt: ago(6 * DAY_MS) }),
			branch(61002)
		],
		current: 'trunk',
		now: NOW
	});
	assert.deepStrictEqual(rows.map((r) => r.ticketId), [59234, 61002, 63000]);
});

test('rows: the checked-out branch is not offered — its ticket is the one the panel already names', () => {
	const rows = ticketBranchRows({
		branches: [branch(59234), branch(61002)],
		current: 'ticket/59234',
		now: NOW
	});
	assert.deepStrictEqual(rows.map((r) => r.ticketId), [61002]);
});

// Regression, seen in manual testing: right after going on with #59234
// from its row the panel is linked to 59234, but the branch list on screen is
// still the one loaded on trunk — its `current` says nothing to exclude, and
// the list offered a row for #59234 while on #59234. The linked ticket is
// excluded by number, independently of `current`.
test('rows: the linked ticket is excluded even when the list\'s current is stale (issue #108)', () => {
	const rows = ticketBranchRows({
		branches: [branch(59234, { lastUsedAt: ago(MINUTE_MS) }), branch(61002)],
		current: 'trunk',
		tracTicket: 59234,
		now: NOW
	});
	assert.deepStrictEqual(rows.map((r) => r.ticketId), [61002]);
});

test('rows: on trunk nothing is excluded', () => {
	const rows = ticketBranchRows({
		branches: [branch(59234), branch(61002)],
		current: 'trunk',
		now: NOW
	});
	assert.strictEqual(rows.length, 2);
});

test('rows: a null current (nothing resolves) excludes nothing', () => {
	const rows = ticketBranchRows({
		branches: [branch(59234)],
		current: null,
		now: NOW
	});
	assert.strictEqual(rows.length, 1);
});

test('rows: a hand-made branch with no ticket id is not a ticket this panel can resume', () => {
	const rows = ticketBranchRows({
		branches: [branch(59234), { ref: 'my-experiment', ticketId: null, lastUsedAt: ago(HOUR_MS) }],
		current: 'trunk',
		now: NOW
	});
	assert.deepStrictEqual(rows.map((r) => r.ref), ['ticket/59234']);
});

test('rows: empty or missing branch lists produce no rows, not a crash', () => {
	assert.deepStrictEqual(ticketBranchRows({ branches: [], current: 'trunk', now: NOW }), []);
	assert.deepStrictEqual(ticketBranchRows({ branches: undefined, current: 'trunk', now: NOW }), []);
});

test('rows: each row carries the ref to act on and the label to show', () => {
	const rows = ticketBranchRows({
		branches: [branch(59234, { lastUsedAt: ago(2 * DAY_MS) })],
		current: 'trunk',
		now: NOW
	});
	assert.deepStrictEqual(rows, [{ ref: 'ticket/59234', ticketId: 59234, number: '#59234', timeLabel: 'Edited 2 days ago' }]);
});

// --- ticketListCard ---------------------------------------------------------

test('card: the heading follows the state — other tickets when linked, your tickets when not (issue #240)', () => {
	assert.equal(ticketListCard({ rowCount: 2, linked: true }).heading, 'Other tickets on this site');
	assert.equal(ticketListCard({ rowCount: 2, linked: false }).heading, 'Your tickets on this site');
});

test('card: a row offers to switch while a ticket is linked, and to continue while none is (#557)', () => {
	assert.equal(ticketListCard({ rowCount: 1, linked: true }).action, 'Switch');
	assert.equal(ticketListCard({ rowCount: 1, linked: false }).action, 'Continue working');
	// The same two words on a site of issues: neither names the work item.
	assert.equal(ticketListCard({ rowCount: 1, linked: true, provider: 'github-issue' }).action, 'Switch');
	assert.equal(ticketListCard({ rowCount: 1, linked: false, provider: 'github-issue' }).action, 'Continue working');
});

test('card: a row\'s work can be deleted in either state, and the button says whose work it is', () => {
	for (const linked of [true, false]) {
		assert.deepStrictEqual(ticketListCard({ rowCount: 1, linked }), {
			heading: linked ? 'Other tickets on this site' : 'Your tickets on this site',
			action: linked ? 'Switch' : 'Continue working',
			remove: 'Delete this ticket’s work',
			removing: 'Deleting'
		});
		assert.equal(ticketListCard({ rowCount: 1, linked, provider: 'github-issue' }).remove, 'Delete this issue’s work');
	}
});

test('the question asked before a ticket\'s work is deleted names the ticket and says it is final', () => {
	assert.deepStrictEqual(deleteWorkQuestion(59234), {
		title: 'Delete all work on ticket #59234?',
		description: 'This will permanently delete every change made for this ticket on this site, whether or not it was submitted. This can’t be undone.',
		confirm: 'Delete this ticket’s work'
	});
	// On a site of issues it is an issue's, in each of the three.
	assert.deepStrictEqual(deleteWorkQuestion(71234, 'github-issue'), {
		title: 'Delete all work on issue #71234?',
		description: 'This will permanently delete every change made for this issue on this site, whether or not it was submitted. This can’t be undone.',
		confirm: 'Delete this issue’s work'
	});
	// What its button says is what the row's button says.
	for (const provider of ['trac', 'github-issue']) {
		assert.equal(deleteWorkQuestion(1, provider).confirm, ticketListCard({ rowCount: 1, linked: false, provider }).remove);
	}
});

test('card: no rows means no card, not an empty one', () => {
	assert.strictEqual(ticketListCard({ rowCount: 0, linked: true }), null);
	assert.strictEqual(ticketListCard({ rowCount: 0, linked: false }), null);
});

// --- relativeTimeLabel ------------------------------------------------------

test('time: under a minute is "just now"', () => {
	assert.strictEqual(relativeTimeLabel(ago(30 * 1000), NOW), 'Edited just now');
});

test('time: minutes, with the singular form', () => {
	assert.strictEqual(relativeTimeLabel(ago(MINUTE_MS), NOW), 'Edited 1 minute ago');
	assert.strictEqual(relativeTimeLabel(ago(5 * MINUTE_MS), NOW), 'Edited 5 minutes ago');
});

test('time: hours', () => {
	assert.strictEqual(relativeTimeLabel(ago(HOUR_MS), NOW), 'Edited 1 hour ago');
	assert.strictEqual(relativeTimeLabel(ago(3 * HOUR_MS), NOW), 'Edited 3 hours ago');
});

test('time: days, up to a week', () => {
	assert.strictEqual(relativeTimeLabel(ago(DAY_MS), NOW), 'Edited 1 day ago');
	assert.strictEqual(relativeTimeLabel(ago(2 * DAY_MS), NOW), 'Edited 2 days ago');
	assert.strictEqual(relativeTimeLabel(ago(7 * DAY_MS - 1), NOW), 'Edited 6 days ago');
});

test('time: a week or more switches to the absolute date', () => {
	// The date text is locale-dependent, so assert the shape, not the rendering.
	const label = relativeTimeLabel(ago(7 * DAY_MS), NOW);
	assert.ok(label.startsWith('Edited on '), label);
	const older = relativeTimeLabel(ago(43 * DAY_MS), NOW);
	assert.ok(older.startsWith('Edited on '), older);
});

test('time: no record and unparseable records produce no label, not a wrong one', () => {
	assert.strictEqual(relativeTimeLabel(null, NOW), null);
	assert.strictEqual(relativeTimeLabel(undefined, NOW), null);
	assert.strictEqual(relativeTimeLabel('not-a-date', NOW), null);
});

// The card's heading says what the site calls its work item (#251).
test('ticketListCard: the heading names the site\'s work item, a ticket unless told it is an issue', () => {
	assert.equal(ticketListCard({ rowCount: 1, linked: false }).heading, 'Your tickets on this site');
	assert.equal(ticketListCard({ rowCount: 1, linked: false, provider: 'trac' }).heading, 'Your tickets on this site');
	assert.equal(ticketListCard({ rowCount: 1, linked: true, provider: 'github-issue' }).heading, 'Other issues on this site');
	assert.equal(ticketListCard({ rowCount: 1, linked: false, provider: 'github-issue' }).heading, 'Your issues on this site');
	assert.equal(ticketListCard({ rowCount: 0, linked: true, provider: 'github-issue' }), null);
});

// #510: only a switch that puts a parked pull request back pauses the build
// watch, and the renderer has to know which switch that is before the checkout
// starts. The branch list carries the answer for every work item but the one
// in hand.
const PARKED = [
	{ ref: 'ticket/59234', ticketId: 59234, savedPr: 7 },
	{ ref: 'ticket/61002', ticketId: 61002, savedPr: null },
	{ ref: 'ticket/61003', ticketId: 61003 }
];

test('savedPrForSwitch: a work item with a pull request parked on it reports it (#510)', () => {
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: 59234 }), 7);
	// The string a text field produces is the same work item as the number.
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: '59234' }), 7);
});

test('savedPrForSwitch: a plain switch reports no pull request (#510)', () => {
	// Nothing parked, no record at all, a work item with no branch here yet,
	// an unlink, and a list that has not loaded: all the same answer, because
	// all of them only move the checkout.
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: 61002 }), null);
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: 61003 }), null);
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: 12345 }), null);
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: null }), null);
	assert.strictEqual(savedPrForSwitch({ branches: null, ticketId: 59234 }), null);
	assert.strictEqual(savedPrForSwitch(), null);
});

// The branch records its parked PR only when it is left, so the row for the
// work item in hand says nothing while you are on it. Read off the row, a
// re-link of that same item would look like leaving a pull request and pause
// the watch for a switch that moves nothing.
test('savedPrForSwitch: re-linking the work item in hand keeps the pull request it is on (#510)', () => {
	const branches = [{ ref: 'ticket/59234', ticketId: 59234, savedPr: null }];
	assert.strictEqual(savedPrForSwitch({ branches, ticketId: 59234, linkedTicket: 59234, currentPr: 7 }), 7);
	// On the same item with no pull request checked out, there is still none.
	assert.strictEqual(savedPrForSwitch({ branches, ticketId: 59234, linkedTicket: 59234, currentPr: null }), null);
	// Another item is read off the list as usual, not off what is checked out.
	assert.strictEqual(savedPrForSwitch({ branches: PARKED, ticketId: 61002, linkedTicket: 59234, currentPr: 7 }), null);
});
