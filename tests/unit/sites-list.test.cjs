const test = require('node:test');
const assert = require('node:assert/strict');

const { sitesListRows, siteAttention, serverDot, siteToOpen, rowId } = require('../../src/renderer/sites-list.cjs');

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const daysAgo = (days) => new Date(NOW - days * DAY).toISOString();

test('a row is named by the site\'s label, and by its folder when it has none', () => {
	const rows = sitesListRows({
		sites: ['/sites/one', 'C:\\sites\\two', '/sites/three'],
		siteMeta: {
			'/sites/one': { label: 'First site' },
			'C:\\sites\\two': {},
			'/sites/three': { label: '   ' }
		},
		now: NOW
	});
	assert.deepEqual(rows.map((row) => row.name), ['First site', 'two', 'three']);
	assert.deepEqual(rows.map((row) => row.path), ['/sites/one', 'C:\\sites\\two', '/sites/three']);
});

test('the rows keep the order they were given in', () => {
	const rows = sitesListRows({ sites: ['/b', '/a', '/c'], siteMeta: {}, now: NOW });
	assert.deepEqual(rows.map((row) => row.path), ['/b', '/a', '/c']);
});

test('the line under the name is the project, and an unknown project reads as Core', () => {
	const rows = sitesListRows({
		sites: ['/core', '/gutenberg', '/unknown', '/none'],
		siteMeta: {
			'/core': { projectType: 'core' },
			'/gutenberg': { projectType: 'gutenberg' },
			'/unknown': { projectType: 'something-else' }
		},
		now: NOW
	});
	assert.deepEqual(rows.map((row) => row.description), ['Core', 'Gutenberg', 'Core', 'Core']);
	assert.deepEqual(rows.map((row) => row.project), ['Core', 'Gutenberg', 'Core', 'Core']);
});

test('a site being deleted says so in place of its project, and keeps its project for the header', () => {
	const [row, other] = sitesListRows({
		sites: ['/going', '/staying'],
		siteMeta: { '/going': { projectType: 'gutenberg' } },
		deleting: ['/going'],
		now: NOW
	});
	assert.equal(row.deleting, true);
	assert.equal(row.description, 'Deleting site…');
	assert.equal(row.project, 'Gutenberg');
	assert.equal(other.deleting, false);
	assert.equal(other.description, 'Core');
});

test('a site with a recent trunk and no unfinished update has nothing to report', () => {
	assert.equal(siteAttention({ trunkDate: daysAgo(1) }, NOW), null);
	assert.equal(siteAttention({ trunkDate: daysAgo(14) }, NOW), null);
});

test('a site with no trunk date is not called old: the record is, not the checkout', () => {
	assert.equal(siteAttention({}, NOW), null);
	assert.equal(siteAttention({ trunkDate: 'not a date' }, NOW), null);
	assert.equal(siteAttention(undefined, NOW), null);
});

test('a trunk more than a fortnight old is reported, with its age', () => {
	assert.deepEqual(siteAttention({ trunkDate: daysAgo(15) }, NOW), {
		kind: 'stale',
		text: 'WordPress code is 15 days old — update to latest trunk'
	});
});

test('an unfinished update is reported, and outranks an old trunk', () => {
	const expected = { kind: 'incomplete', text: 'Update incomplete — code is new, built assets are old' };
	assert.deepEqual(siteAttention({ updateIncomplete: true, trunkDate: daysAgo(1) }, NOW), expected);
	assert.deepEqual(siteAttention({ updateIncomplete: true, trunkDate: daysAgo(40) }, NOW), expected);
});

test('each row carries what its own site has to report', () => {
	const rows = sitesListRows({
		sites: ['/fresh', '/old', '/broken'],
		siteMeta: {
			'/fresh': { trunkDate: daysAgo(2) },
			'/old': { trunkDate: daysAgo(30) },
			'/broken': { updateIncomplete: true }
		},
		now: NOW
	});
	assert.deepEqual(rows.map((row) => row.attention && row.attention.kind), [null, 'stale', 'incomplete']);
});

test('no sites, or none given, is an empty list', () => {
	assert.deepEqual(sitesListRows({ sites: [], siteMeta: {} }), []);
	assert.deepEqual(sitesListRows({ sites: null, siteMeta: null }), []);
});

test('a row\'s id has no space in it, whatever the path, and no two sites share one', () => {
	// The list points aria-labelledby at ids built from this, and that
	// attribute is split on spaces.
	const paths = ['C:\\Users\\First Last\\sites\\one', '/Users/me/My Sites/one', '/Users/me/My\tSites/one', '/Users/me/MySites/one'];
	const made = paths.map(rowId);
	for (const id of made) assert.doesNotMatch(id, /\s/);
	assert.equal(new Set(made).size, paths.length);
	assert.deepEqual(sitesListRows({ sites: paths, siteMeta: {}, now: NOW }).map((row) => row.id), made);
});

const ROWS = sitesListRows({ sites: ['/a', '/b', '/going'], siteMeta: {}, deleting: ['/going'], now: NOW });
const ids = (...paths) => paths.map(rowId);

test('clicking another site opens it, whether the list reports it alone or with the open one', () => {
	assert.equal(siteToOpen({ selection: ids('/b'), current: '/a', rows: ROWS }), '/b');
	assert.equal(siteToOpen({ selection: ids('/a', '/b'), current: '/a', rows: ROWS }), '/b');
	assert.equal(siteToOpen({ selection: ids('/b', '/a'), current: '/a', rows: ROWS }), '/b');
});

test('a report that names no other site leaves the open one open, whether it is the open site alone or nothing at all', () => {
	assert.equal(siteToOpen({ selection: [], current: '/a', rows: ROWS }), '/a');
	assert.equal(siteToOpen({ selection: ids('/a'), current: '/a', rows: ROWS }), '/a');
	assert.equal(siteToOpen({ selection: null, current: '/a', rows: ROWS }), '/a');
});

test('a site being deleted cannot be opened', () => {
	assert.equal(siteToOpen({ selection: ids('/going'), current: '/a', rows: ROWS }), '/a');
	assert.equal(siteToOpen({ selection: ids('/going', '/b'), current: '/a', rows: ROWS }), '/b');
});

test('an id the list does not hold opens nothing', () => {
	assert.equal(siteToOpen({ selection: ['/b'], current: '/a', rows: ROWS }), '/a');
	assert.equal(siteToOpen({ selection: ids('/gone'), current: '/a', rows: ROWS }), '/a');
	assert.equal(siteToOpen({ selection: ids('/b'), current: '/a', rows: null }), '/a');
});

test('with nothing open yet, the first site reported is opened', () => {
	assert.equal(siteToOpen({ selection: ids('/a'), current: null, rows: ROWS }), '/a');
	assert.equal(siteToOpen({ selection: [], current: null, rows: ROWS }), null);
});

test('each row carries what its view last said of its server, and a site whose view has said nothing is offline', () => {
	const rows = sitesListRows({
		sites: ['/quiet', '/up', '/starting', '/crashed'],
		siteMeta: {},
		servers: {
			'/up': { status: 'online', text: 'Server running' },
			'/starting': { status: 'busy', text: 'Server starting…' },
			'/crashed': { status: 'failed', text: 'The development server stopped by itself. Its last lines are in the Logs.' }
		},
		now: NOW
	});
	assert.deepEqual(rows.map((row) => row.server), [
		{ status: 'offline', text: '' },
		{ status: 'online', text: 'Server running' },
		{ status: 'busy', text: 'Server starting…' },
		{ status: 'failed', text: 'The development server stopped by itself. Its last lines are in the Logs.' }
	]);
	assert.deepEqual(sitesListRows({ sites: ['/a'], siteMeta: {}, now: NOW })[0].server, { status: 'offline', text: '' });
});

test('a stopped server says nothing after the name, whatever words came with it', () => {
	assert.deepEqual(serverDot({ status: 'offline', text: 'Server stopped' }), { status: 'offline', text: '' });
	assert.deepEqual(serverDot(null), { status: 'offline', text: '' });
	assert.deepEqual(serverDot(undefined), { status: 'offline', text: '' });
});

test('a report with a word the dot has no colour for is offline, and one without words is the colour alone', () => {
	assert.deepEqual(serverDot({ status: 'exploded', text: 'Server running' }), { status: 'offline', text: '' });
	assert.deepEqual(serverDot({ status: 'online' }), { status: 'online', text: '' });
});
