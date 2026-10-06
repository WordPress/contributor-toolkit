'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { SETTINGS, readSettings, acceptSetting } = require('../../src/settings.cjs');

// What the disk says, as the test decides it.
const disk = (folders) => ({ isAbsolute: path.posix.isAbsolute, isDirectory: (p) => folders.includes(p) });

test('readSettings falls back for a store with nothing in it, and for values of the wrong kind', () => {
	assert.deepEqual(readSettings(), { newSiteLocation: null });
	assert.deepEqual(readSettings(undefined), { newSiteLocation: null });
	assert.deepEqual(readSettings({}), { newSiteLocation: null });
	assert.deepEqual(readSettings({ newSiteLocation: 42 }), { newSiteLocation: null });
	assert.deepEqual(readSettings({ newSiteLocation: '' }), { newSiteLocation: null });
	assert.deepEqual(readSettings('not an object'), { newSiteLocation: null });
});

test('readSettings gives back a stored folder without asking the disk about it', () => {
	assert.deepEqual(readSettings({ newSiteLocation: '/Users/jane/sites' }), { newSiteLocation: '/Users/jane/sites' });
});

test('readSettings answers for every setting there is', () => {
	assert.deepEqual(Object.keys(readSettings({})).sort(), Object.keys(SETTINGS).sort());
});

test('a folder that exists is stored by its full path, as it was given', () => {
	assert.deepEqual(acceptSetting('newSiteLocation', '/Users/jane/sites', disk(['/Users/jane/sites'])), { ok: true, value: '/Users/jane/sites' });
	// A name that ends in a space is that folder's, and is not another's.
	assert.deepEqual(acceptSetting('newSiteLocation', '/Users/jane/sites ', disk(['/Users/jane/sites '])), { ok: true, value: '/Users/jane/sites ' });
	assert.equal(acceptSetting('newSiteLocation', '/Users/jane/sites ', disk(['/Users/jane/sites'])).ok, false);
});

test('nothing, or an empty string, forgets the folder', () => {
	for (const value of [null, undefined, '', '   ']) {
		assert.deepEqual(acceptSetting('newSiteLocation', value, disk([])), { ok: true, value: null }, String(value));
	}
});

test('a folder is refused when it is not a string, not a full path, or not on the disk', () => {
	assert.equal(acceptSetting('newSiteLocation', 42, disk([])).ok, false);
	assert.equal(acceptSetting('newSiteLocation', ['/Users/jane'], disk(['/Users/jane'])).ok, false);
	assert.deepEqual(acceptSetting('newSiteLocation', 'sites', disk(['sites'])), { ok: false, error: 'Choose a folder by its full path.' });
	assert.deepEqual(acceptSetting('newSiteLocation', '/Users/jane/gone', disk([])), { ok: false, error: 'That folder does not exist.' });
});

test('a key that is not a setting is refused, and nothing is asked of the disk', () => {
	let asked = 0;
	const result = acceptSetting('theme', 'dark', { isAbsolute: () => { asked++; return true; }, isDirectory: () => { asked++; return true; } });
	assert.equal(result.ok, false);
	assert.equal(asked, 0);
});
