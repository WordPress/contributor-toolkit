'use strict';

// The row for a site that is being created, while it is being created.
//
// The window has to show one before it can know where the site will be: the
// contributor picked a parent directory and typed a name, and that is all there
// is until the main process answers. So it guesses — and the guess is wrong
// whenever the folder name is already taken, because main appends `-2`.
//
// That mattered once the guards started keying on the real directory (#180):
// the row was sending a path the app had never created, and being refused for
// it. Main reports the real one on its first status event, so the row adopts it
// and the guess stops existing.
//
// The three moves live here rather than inline in the component because there
// were three divergent copies of them, and the discard branch was written when
// the swap could only happen at the very end. Adopting earlier is exactly what
// makes a stale discard possible.

const test = require('node:test');
const assert = require('node:assert/strict');

const { beginSetup, adoptSetupPath, discardSetup, rowPathAfterStatus } = require('../src/renderer/pending-setup.cjs');

const GUESS = '/Users/dev/sites/demo';
const REAL = '/Users/dev/sites/demo-2';
const CREATED_AT = '2026-08-09T10:00:00.000Z';

function started(state = { sites: [], siteMeta: {} }) {
	return beginSetup(state, { path: GUESS, label: 'Demo', createdAt: CREATED_AT });
}

test('a site being created gets a row before there is anything on disk', () => {
	const next = started();

	assert.deepEqual(next.sites, [GUESS]);
	assert.equal(next.siteMeta[GUESS].label, 'Demo');
	assert.equal(next.siteMeta[GUESS].createdAt, CREATED_AT);
	assert.equal(next.siteMeta[GUESS].initialized, false);
});

test('starting a setup leaves the other sites alone', () => {
	const other = '/Users/dev/sites/other';
	const next = beginSetup(
		{ sites: [other], siteMeta: { [other]: { label: 'Other' } } },
		{ path: GUESS, label: 'Demo', createdAt: CREATED_AT }
	);

	assert.deepEqual(next.sites, [other, GUESS]);
	assert.equal(next.siteMeta[other].label, 'Other');
});

test('adopting the real path replaces the guess rather than adding a second row', () => {
	const next = adoptSetupPath(started(), { from: GUESS, to: REAL });

	assert.deepEqual(next.sites, [REAL], 'the guess must not linger beside the real one');
	assert.equal(next.siteMeta[GUESS], undefined);
});

test('what the contributor typed survives the adoption', () => {
	const next = adoptSetupPath(started(), { from: GUESS, to: REAL });

	assert.equal(next.siteMeta[REAL].label, 'Demo');
	assert.equal(next.siteMeta[REAL].createdAt, CREATED_AT, 'the row must not jump in the sidebar order');
	assert.equal(next.siteMeta[REAL].initialized, false);
});

// Main sends `cloning` and then resolves with the same path, so the swap runs
// twice for one setup. The second must be a no-op rather than a second row.
test('adopting twice is a no-op', () => {
	const once = adoptSetupPath(started(), { from: GUESS, to: REAL });
	const twice = adoptSetupPath(once, { from: REAL, to: REAL });

	assert.deepEqual(twice.sites, [REAL]);
	assert.equal(twice.siteMeta[REAL].label, 'Demo');
});

test('adopting a path that was never guessed leaves the state alone', () => {
	const state = started();

	assert.equal(adoptSetupPath(state, { from: '/Users/dev/sites/unrelated', to: REAL }), state);
});

// The trap this module exists to close. The discard branch used to filter the
// guessed path, which was safe only because the swap could not have happened
// yet. Adopting on the first status event breaks that assumption, and a discard
// that still filtered the guess would strand a row for a directory whose setup
// failed.
test('discarding after an adoption removes the adopted row, not the guess', () => {
	const adopted = adoptSetupPath(started(), { from: GUESS, to: REAL });

	const next = discardSetup(adopted, REAL);

	assert.deepEqual(next.sites, []);
	assert.deepEqual(next.siteMeta, {});
});

test('discarding before any adoption removes the guess', () => {
	const next = discardSetup(started(), GUESS);

	assert.deepEqual(next.sites, []);
	assert.deepEqual(next.siteMeta, {});
});

test('discarding leaves every other site untouched', () => {
	const other = '/Users/dev/sites/other';
	const state = beginSetup(
		{ sites: [other], siteMeta: { [other]: { label: 'Other' } } },
		{ path: GUESS, label: 'Demo', createdAt: CREATED_AT }
	);

	const next = discardSetup(state, GUESS);

	assert.deepEqual(next.sites, [other]);
	assert.deepEqual(Object.keys(next.siteMeta), [other]);
});

test('none of the three mutate what they were given', () => {
	const state = { sites: [], siteMeta: {} };
	const begun = beginSetup(state, { path: GUESS, label: 'Demo', createdAt: CREATED_AT });
	assert.deepEqual(state, { sites: [], siteMeta: {} });

	const adopted = adoptSetupPath(begun, { from: GUESS, to: REAL });
	assert.deepEqual(begun.sites, [GUESS]);
	assert.equal(begun.siteMeta[GUESS].label, 'Demo');

	discardSetup(adopted, REAL);
	assert.deepEqual(adopted.sites, [REAL]);
});

// --- which event moves the row -------------------------------------------
//
// The decision the subscription used to make inline, and the one that was
// actually wrong: a first version moved the row for any status whose target
// differed from it, which is fine until a second setup exists.

const CLONING = { phase: 'cloning', target: REAL };

test('the cloning status is what moves the row', () => {
	assert.equal(rowPathAfterStatus(GUESS, CLONING), REAL);
});

test('a row already on the real path does not move again', () => {
	assert.equal(rowPathAfterStatus(REAL, CLONING), null);
});

// The concurrency failure, stated. With two setups running, the first one's
// `done` names its own directory — which is not where the second one's row
// belongs, and adopting it would drag that row onto a finished site, carrying
// its label and its log with it.
test('no other phase moves the row, however different its target', () => {
	for (const phase of ['done', 'installing', undefined]) {
		assert.equal(rowPathAfterStatus(GUESS, { phase, target: '/Users/dev/sites/someone-else' }), null, String(phase));
	}
});

test('nothing being created means nothing to move', () => {
	assert.equal(rowPathAfterStatus(null, CLONING), null);
	assert.equal(rowPathAfterStatus('', CLONING), null);
});

test('a status with nothing usable in it moves nothing', () => {
	for (const status of [null, undefined, {}, { phase: 'cloning' }, { phase: 'cloning', target: '' }]) {
		assert.equal(rowPathAfterStatus(GUESS, status), null, JSON.stringify(status));
	}
});
