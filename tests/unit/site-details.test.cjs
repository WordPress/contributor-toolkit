const test = require('node:test');
const assert = require('node:assert/strict');

const { siteDetailsRows } = require('../../src/renderer/site-details.cjs');

const ids = (rows) => rows.map((row) => row.id);
const BASE = { path: '/sites/one', checkout: 'WordPress Core' };
const fresh = { known: true, stale: false, ageDays: 2, dateLabel: 'Sep 30, 2026' };
const old = { known: true, stale: true, ageDays: 30, dateLabel: 'Sep 2, 2026' };

test('a site with everything known says it all, in order', () => {
	const rows = siteDetailsRows({ ...BASE, initialized: true, created: '10/1/2026, 9:00:00 AM', trunk: fresh });
	assert.deepEqual(rows, [
		{ id: 'setup', label: 'Setup', value: 'Initialized' },
		{ id: 'created', label: 'Created', value: '10/1/2026, 9:00:00 AM' },
		{ id: 'trunk', label: 'Trunk as of', value: 'Sep 30, 2026' },
		{ id: 'path', label: 'Local path', value: '/sites/one', copyable: true },
		{ id: 'checkout', label: 'Checkout', value: 'WordPress Core' }
	]);
});

test('a site whose setup has not finished says so', () => {
	assert.equal(siteDetailsRows({ ...BASE, initialized: false })[0].value, 'Uninitialized');
	assert.equal(siteDetailsRows({ ...BASE })[0].value, 'Uninitialized');
	assert.equal(siteDetailsRows({ ...BASE, initialized: true })[0].value, 'Initialized');
});

test('an old trunk says how old under its date, and a recent one says nothing more', () => {
	const stale = siteDetailsRows({ ...BASE, trunk: old }).find((row) => row.id === 'trunk');
	assert.deepEqual(stale, { id: 'trunk', label: 'Trunk as of', value: 'Sep 2, 2026', note: '30 days old' });
	const recent = siteDetailsRows({ ...BASE, trunk: fresh }).find((row) => row.id === 'trunk');
	assert.ok(!('note' in recent));
});

test('one day is a day, not days', () => {
	const row = siteDetailsRows({ ...BASE, trunk: { ...old, ageDays: 1 } }).find((r) => r.id === 'trunk');
	assert.equal(row.note, '1 day old');
});

test('what is not known is left out, not shown empty', () => {
	assert.deepEqual(ids(siteDetailsRows({ ...BASE })), ['setup', 'path', 'checkout']);
	assert.deepEqual(ids(siteDetailsRows({ ...BASE, created: '', trunk: { known: false, stale: false, ageDays: null, dateLabel: '' } })), ['setup', 'path', 'checkout']);
	assert.deepEqual(ids(siteDetailsRows({ ...BASE, trunk: null })), ['setup', 'path', 'checkout']);
});

test('only the path can be copied', () => {
	const rows = siteDetailsRows({ ...BASE, initialized: true, created: 'then', trunk: old });
	assert.deepEqual(rows.filter((row) => row.copyable).map((row) => row.id), ['path']);
});

// What the settings hold for a server (#559), where the window has read them.
test('the checkout names the PHP a server starts on, and a Debugging row says which constants are on', () => {
	const rows = siteDetailsRows({ ...BASE, phpVersion: '8.4', debug: { wpDebug: true, scriptDebug: true } });
	assert.deepEqual(rows.slice(-2), [
		{ id: 'checkout', label: 'Checkout', value: 'WordPress Core · PHP 8.4' },
		{ id: 'debugging', label: 'Debugging', value: 'WP_DEBUG · SCRIPT_DEBUG' }
	]);
	assert.equal(siteDetailsRows({ ...BASE, debug: { wpDebug: false, scriptDebug: true } }).at(-1).value, 'SCRIPT_DEBUG');
	assert.equal(siteDetailsRows({ ...BASE, debug: { wpDebug: true, scriptDebug: false } }).at(-1).value, 'WP_DEBUG');
	assert.equal(siteDetailsRows({ ...BASE, debug: { wpDebug: false, scriptDebug: false } }).at(-1).value, 'Off');
});

test('until the settings are read, the checkout is named alone and there is no Debugging row', () => {
	const rows = siteDetailsRows({ ...BASE });
	assert.deepEqual(rows.at(-1), { id: 'checkout', label: 'Checkout', value: 'WordPress Core' });
	assert.deepEqual(ids(siteDetailsRows({ ...BASE, phpVersion: null, debug: null })), ['setup', 'path', 'checkout']);
});
