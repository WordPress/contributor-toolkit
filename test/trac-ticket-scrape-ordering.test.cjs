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
// "Reading ticket..." spinner stuck. The fix bumps the generation
// synchronously, ahead of the auto-triggered scrape, in the same effect.
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

	// A second useEffect bumping the generation, declared after the
	// auto-scrape effect, is exactly the ordering bug: same-component
	// passive effects run in declaration order, so a later effect cannot
	// beat an earlier one's synchronous body.
	assert.strictEqual(
		source.split('scrapeGenRef.current += 1').length - 1,
		1,
		'expected exactly one scrapeGenRef bump; a separate effect duplicating it reintroduces the ordering race (#299)'
	);
});
