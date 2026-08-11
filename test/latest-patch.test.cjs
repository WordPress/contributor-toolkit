'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { attachmentDateMs, pickLatest } = require('../src/latest-patch.cjs');

// A PR is dated by its newest commit (#281). `updatedAt` rides along because
// the real object carries it and the row falls back to it, but nothing here may
// rank by it.
const pr = (number, commitDate, updatedAt = '2026-07-06T03:10:00Z') => ({ number, commitDate, updatedAt });
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
test('pickLatest: with only PRs, the one with the newest commit wins (issue #11)', () => {
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

// --- ranking by commit, and refusing to guess (issue #281) ---------------

// Trac #62064, as it shipped: one force-push upstream restamped both PRs 19
// seconds apart, and the app crowned the November 2024 patch — which no longer
// applies — over the April 2026 one, which does.
test('pickLatest: the force-push stamps do not decide it; the newest commit does (issue #281)', () => {
	const latest = pickLatest({
		prs: [
			pr(7382, '2024-11-19T09:00:00Z', '2026-07-06T03:10:47Z'),
			pr(8455, '2026-04-12T11:30:00Z', '2026-07-06T03:10:28Z')
		],
		prRankComplete: true
	});
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 8455 });
});

test('pickLatest: a walk that broke shows nothing rather than a guess (issue #281)', () => {
	const prs = [pr(1, '2026-04-12T11:30:00Z'), pr(2, '2024-11-19T09:00:00Z')];
	assert.strictEqual(pickLatest({ prs, prRankComplete: false }), null);
	assert.ok(pickLatest({ prs, prRankComplete: true }), 'the same list ranks fine once the walk finished');
});

// The regression this rule was rewritten for: the walk leaves a ruled-out row
// undated on purpose, and treating that as "unknown, so no answer" removed the
// pill from the ordinary one-lookup ticket the walk exists to serve.
test('pickLatest: a PR the walk ruled out does not cost the pill (issue #281)', () => {
	const latest = pickLatest({
		prs: [pr(8455, '2026-07-19T00:00:00Z', '2026-07-20T00:00:00Z'), { number: 7382, updatedAt: '2024-11-19T00:00:00Z' }],
		prRankComplete: true
	});
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 8455 });
});

// The other side of the same comparison: a row the walk never reached carries
// the stamp that has not been ruled out, and in a force-push sweep that stamp
// sits at or above the winner — so it suppresses the pill on its own, with no
// flag needed. This is the shape of a cache written before commit dates existed.
test('pickLatest: an unreached PR whose stamp beats the winner suppresses the pill (issue #281)', () => {
	const prs = [pr(1, '2026-04-12T11:30:00Z', '2026-07-06T03:10:47Z'), { number: 2, updatedAt: '2026-07-06T03:10:28Z' }];
	assert.strictEqual(pickLatest({ prs, prRankComplete: true }), null);
	assert.strictEqual(pickLatest({ prs }), null, 'a caller that passes no flag gets the same answer');
});

// A PR with neither a commit date nor a usable stamp is unbounded — nothing
// says it is not the newest fix on the ticket, so nothing can be crowned.
test('pickLatest: a PR with no date at all takes the answer with it (issue #281)', () => {
	assert.strictEqual(pickLatest({ prs: [pr(1, '2026-04-12T11:30:00Z'), { number: 2 }], prRankComplete: true }), null);
});

// An unreached PR is unknown next to an attachment too: it could be the newer
// fix, so the attachment cannot be crowned either.
test('pickLatest: an unreached PR blocks an attachment from winning too (issue #281)', () => {
	const latest = pickLatest({
		prs: [{ number: 2, updatedAt: '2026-08-01T00:00:00Z' }],
		attachments: [att('fix.diff', '05/16/2025 11:00:00 AM')]
	});
	assert.strictEqual(latest, null);
});

// And the mirror: an attachment genuinely newer than a ruled-out PR's stamp
// still wins, so the bound does not become a blanket veto.
test('pickLatest: an attachment beats a PR whose stamp is older than it (issue #281)', () => {
	const latest = pickLatest({
		prs: [{ number: 2, updatedAt: '2020-01-01T00:00:00Z' }],
		attachments: [att('fix.diff', '05/16/2025 11:00:00 AM')]
	});
	assert.strictEqual(latest.kind, 'attachment');
});

test('pickLatest: two patches within the hour are not a ranking (issue #281)', () => {
	const near = pickLatest({
		prs: [pr(1, '2026-04-12T11:30:00Z'), pr(2, '2026-04-12T11:55:00Z')],
		prRankComplete: true
	});
	assert.strictEqual(near, null, '25 minutes apart is one piece of work, not a newer and an older fix');

	const clear = pickLatest({
		prs: [pr(1, '2026-04-12T11:30:00Z'), pr(2, '2026-04-12T14:30:00Z')],
		prRankComplete: true
	});
	assert.deepStrictEqual({ kind: clear.kind, key: clear.key }, { kind: 'pr', key: 2 });
});

// The near-tie rule reads the runner-up wherever it is, not just the previous
// winner: three candidates must not let an early loser hide a close second.
test('pickLatest: the near-tie is measured against the true runner-up (issue #281)', () => {
	const latest = pickLatest({
		prs: [pr(1, '2020-01-01T00:00:00Z'), pr(2, '2026-04-12T14:30:00Z'), pr(3, '2026-04-12T14:20:00Z')],
		prRankComplete: true
	});
	assert.strictEqual(latest, null);
});

test('pickLatest: a single PR still gets the pill (issue #281)', () => {
	const latest = pickLatest({ prs: [pr(9026, '2026-04-12T11:30:00Z')], prRankComplete: true });
	assert.deepStrictEqual({ kind: latest.kind, key: latest.key }, { kind: 'pr', key: 9026 });
});
