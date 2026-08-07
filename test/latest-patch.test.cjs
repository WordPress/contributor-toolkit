'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { attachmentDateMs, pickLatest } = require('../src/latest-patch.cjs');

const pr = (number, updatedAt) => ({ number, updatedAt });
const att = (filename, dateText, applyable = true) => ({ filename, url: `https://core.trac.wordpress.org/raw-attachment/ticket/1/${filename}`, dateText, applyable });

test('attachmentDateMs: a US-format absolute date parses, a relative one does not (issue #11)', () => {
	assert.ok(Number.isFinite(attachmentDateMs(att('a.diff', '05/15/2025 01:11:28 PM'))));
	assert.ok(Number.isNaN(attachmentDateMs(att('a.diff', '15 months ago'))));
	assert.ok(Number.isNaN(attachmentDateMs(att('a.diff', ''))));
});

// Anchored to UTC by hand, so the result does not depend on the machine's
// timezone — two contributors must agree on which patch is latest. PM/AM and
// the 12 o'clock edge are the parts most likely to be got wrong.
test('attachmentDateMs: parses to a fixed UTC instant, timezone-independent (issue #11)', () => {
	assert.strictEqual(attachmentDateMs(att('a.diff', '05/15/2025 01:11:28 PM')), Date.UTC(2025, 4, 15, 13, 11, 28));
	assert.strictEqual(attachmentDateMs(att('a.diff', '05/15/2025 12:00:00 AM')), Date.UTC(2025, 4, 15, 0, 0, 0));
	assert.strictEqual(attachmentDateMs(att('a.diff', '05/15/2025 12:30:00 PM')), Date.UTC(2025, 4, 15, 12, 30, 0));
	assert.strictEqual(attachmentDateMs(att('a.diff', '08/05/2016 01:43:44 AM')), Date.UTC(2016, 7, 5, 1, 43, 44));
});

// The common case: attachments not loaded yet, so the newest PR is the latest.
test('pickLatest: with only PRs, the most recently updated PR wins (issue #11)', () => {
	const latest = pickLatest({ prs: [pr(1, '2026-01-01T00:00:00Z'), pr(2, '2026-08-06T00:00:00Z')] });
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 2 });
});

test('pickLatest: nothing loaded yields null, not a throw (issue #11)', () => {
	assert.strictEqual(pickLatest({}), null);
	assert.strictEqual(pickLatest({ prs: [], attachments: [] }), null);
});

// Once attachments load, a newer uploaded patch wins over the PR — this is the
// case the feature exists to surface.
test('pickLatest: a newer attachment beats the PR once loaded (issue #11)', () => {
	const latest = pickLatest({
		prs: [pr(9026, '2025-01-01T00:00:00Z')],
		attachments: [att('37578-1.diff', '05/16/2025 11:00:00 AM')]
	});
	assert.strictEqual(latest.kind, 'attachment');
	assert.strictEqual(latest.key, 'https://core.trac.wordpress.org/raw-attachment/ticket/1/37578-1.diff');
});

test('pickLatest: a newer PR beats older attachments (issue #11)', () => {
	const latest = pickLatest({
		prs: [pr(9026, '2026-06-07T00:00:00Z')],
		attachments: [att('old.diff', '05/16/2025 11:00:00 AM')]
	});
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 9026 });
});

test('pickLatest: a non-patch attachment never wins, even if newest (issue #11)', () => {
	const latest = pickLatest({
		prs: [pr(9026, '2025-01-01T00:00:00Z')],
		attachments: [att('notes.txt', '08/01/2026 10:00:00 AM', false), att('fix.diff', '05/16/2025 11:00:00 AM')]
	});
	// The .txt is newer but not applyable; the .diff wins among attachments,
	// still beating the older PR.
	assert.strictEqual(latest.kind, 'attachment');
	assert.ok(String(latest.key).endsWith('fix.diff'));
});

test('pickLatest: an attachment with only a relative date cannot win (issue #11)', () => {
	const latest = pickLatest({
		prs: [pr(9026, '2025-01-01T00:00:00Z')],
		attachments: [att('fix.diff', '2 days ago')]
	});
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 9026 });
});

test('pickLatest: attachments-only (no PRs cite the ticket) still picks the newest patch (issue #11)', () => {
	const latest = pickLatest({
		prs: [],
		attachments: [att('a.diff', '01/01/2020 10:00:00 AM'), att('b.diff', '02/02/2021 10:00:00 AM')]
	});
	assert.strictEqual(latest.kind, 'attachment');
	assert.ok(String(latest.key).endsWith('b.diff'));
});
