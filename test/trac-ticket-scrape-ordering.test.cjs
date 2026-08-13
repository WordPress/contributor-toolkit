'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// #299: the auto-read effect and the scrapeGenRef bump were two separate
// useEffects, both keyed off tracTicket. React runs same-component passive
// effects in declaration order, so the auto-scrape fired before the
// generation bump — loadTracAttachments captured a stale gen, and its
// finally guard (`gen === scrapeGenRef.current`) never matched, leaving the
// "Reading ticket..." spinner stuck. The fix declares the bump effect first,
// so it always runs before the auto-scrape effect a few lines below it.
test('scrape ordering: scrapeGenRef bumps before the auto-triggered scrape fires (issue #299)', () => {
	const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.jsx'), 'utf8');

	const genBumpIdx = source.indexOf('scrapeGenRef.current += 1');
	const scrapeCallIdx = source.indexOf('tracScrapeRef.current()');

	assert.ok(genBumpIdx !== -1, 'expected to find the scrapeGenRef bump in index.jsx');
	assert.ok(scrapeCallIdx !== -1, 'expected to find the auto-triggered tracScrapeRef.current() call in index.jsx');
	assert.ok(
		genBumpIdx < scrapeCallIdx,
		'scrapeGenRef must bump before the auto-scrape fires, or loadTracAttachments captures a stale generation and its loading flag never clears (#299)'
	);

	// A second bump site, or the auto-scrape effect declared before this one,
	// is exactly the ordering bug: same-component passive effects run in
	// declaration order, so a later effect cannot beat an earlier one's body.
	assert.strictEqual(
		source.split('scrapeGenRef.current += 1').length - 1,
		1,
		'expected exactly one scrapeGenRef bump; a separate effect duplicating it reintroduces the ordering race (#299)'
	);
});

// A follow-up to the fix above: the bump effect must stay keyed on
// [tracTicket] alone. Folding it into the wider auto-read effect (deps
// [tracTicket, isActive, loadTicketPatches]) makes it re-run whenever the
// contributor switches site tabs, since every SiteRow stays mounted and
// isActive flips on every switch — bumping the generation of an in-flight
// scrape that has nothing to do with a ticket change, and reproducing the
// #299 spinner through a different trigger (caught in review, not filed as
// its own issue).
test('scrape ordering: the generation bump only depends on tracTicket, not isActive (issue #299 follow-up)', () => {
	const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.jsx'), 'utf8');

	const bumpEffect = source.indexOf('useEffect(() => { scrapeGenRef.current += 1; }, [tracTicket]);');
	assert.ok(
		bumpEffect !== -1,
		'expected the generation bump on its own effect keyed only on [tracTicket] — an isActive toggle (switching site tabs) must not bump it'
	);
});
