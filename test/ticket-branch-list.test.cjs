'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { relativeTimeLabel, ticketBranchRows, ticketListCard } = require('../src/renderer/ticket-branch-list.cjs');

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

// Regression, seen in manual testing: right after "Continue working on
// #59234" the panel is linked to 59234, but the branch list on screen is
// still the one loaded on trunk — its `current` says nothing to exclude, and
// the panel offered "You also have work on #59234" while on #59234. The
// linked ticket is excluded by number, independently of `current`.
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
	assert.deepStrictEqual(rows, [{ ref: 'ticket/59234', ticketId: 59234, timeLabel: 'edited 2 days ago' }]);
});

// --- ticketListCard ---------------------------------------------------------

test('card: the heading follows the state — other tickets when linked, your tickets when not (issue #240)', () => {
	assert.deepStrictEqual(ticketListCard({ rowCount: 2, linked: true }), { heading: 'Other tickets on this site' });
	assert.deepStrictEqual(ticketListCard({ rowCount: 2, linked: false }), { heading: 'Your tickets on this site' });
});

test('card: no rows means no card, not an empty one', () => {
	assert.strictEqual(ticketListCard({ rowCount: 0, linked: true }), null);
	assert.strictEqual(ticketListCard({ rowCount: 0, linked: false }), null);
});

// The card's position is the whole point of #240, and no test renders the
// DOM, so the layout is pinned at the source: the rows render once, from a
// card of their own that sits between the Trac ticket card and the patch one.
// Reading order is a behaviour here — which ticket am I on, which of my
// tickets do I want, bring in work from elsewhere.
test('card: the list renders once, in its own card between the ticket card and the patch card (issue #240)', () => {
	const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.jsx'), 'utf8');

	// The headings come from ticketListCard, so the card cannot say one thing
	// while the tested module says another. Restated literals in index.jsx
	// would be the two-copies drift this module exists to prevent.
	assert.ok(!source.includes('Other tickets on this site'), 'index.jsx restates the linked heading instead of using ticketListCard');
	assert.ok(!source.includes('Your tickets on this site'), 'index.jsx restates the unlinked heading instead of using ticketListCard');

	// One call site. Two was the old shape — one per state of the ticket card —
	// and going back to two is the list mounting twice, or quietly moving back
	// inside the card it just left. Counted as a call rather than as the bare
	// name so that a comment naming the helper is not a red suite.
	assert.strictEqual(source.split('renderBranchRows(').length - 1, 1, 'expected exactly one renderBranchRows( call: the single card that renders the list');

	// Between the two cards it used to sit inside of and above.
	const ticketCard = source.indexOf('>Trac ticket<');
	const listCard = source.indexOf('{ticketsCard.heading}');
	const patchCard = source.indexOf('>Apply a patch or PR<');
	assert.ok(ticketCard !== -1 && listCard !== -1 && patchCard !== -1, 'one of the three card headings is missing from index.jsx');
	assert.ok(ticketCard < listCard && listCard < patchCard, 'the tickets card is not between the Trac ticket card and the patch card');
});

// --- relativeTimeLabel ------------------------------------------------------

test('time: under a minute is "just now"', () => {
	assert.strictEqual(relativeTimeLabel(ago(30 * 1000), NOW), 'edited just now');
});

test('time: minutes, with the singular form', () => {
	assert.strictEqual(relativeTimeLabel(ago(MINUTE_MS), NOW), 'edited 1 minute ago');
	assert.strictEqual(relativeTimeLabel(ago(5 * MINUTE_MS), NOW), 'edited 5 minutes ago');
});

test('time: hours', () => {
	assert.strictEqual(relativeTimeLabel(ago(HOUR_MS), NOW), 'edited 1 hour ago');
	assert.strictEqual(relativeTimeLabel(ago(3 * HOUR_MS), NOW), 'edited 3 hours ago');
});

test('time: days, up to a week', () => {
	assert.strictEqual(relativeTimeLabel(ago(DAY_MS), NOW), 'edited 1 day ago');
	assert.strictEqual(relativeTimeLabel(ago(2 * DAY_MS), NOW), 'edited 2 days ago');
	assert.strictEqual(relativeTimeLabel(ago(7 * DAY_MS - 1), NOW), 'edited 6 days ago');
});

test('time: a week or more switches to the absolute date', () => {
	// The date text is locale-dependent, so assert the shape, not the rendering.
	const label = relativeTimeLabel(ago(7 * DAY_MS), NOW);
	assert.ok(label.startsWith('edited on '), label);
	const older = relativeTimeLabel(ago(43 * DAY_MS), NOW);
	assert.ok(older.startsWith('edited on '), older);
});

test('time: no record and unparseable records produce no label, not a wrong one', () => {
	assert.strictEqual(relativeTimeLabel(null, NOW), null);
	assert.strictEqual(relativeTimeLabel(undefined, NOW), null);
	assert.strictEqual(relativeTimeLabel('not-a-date', NOW), null);
});
