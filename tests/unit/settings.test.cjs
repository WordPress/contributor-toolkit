'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { SETTINGS, readSettings, acceptSetting } = require('../../src/settings.cjs');

// What the disk says, as the test decides it.
const disk = (folders) => ({ isAbsolute: path.posix.isAbsolute, isDirectory: (p) => folders.includes(p) });
const languages = (tags) => ({ isLanguage: (tag) => tags.includes(tag) });
const php = (versions) => ({ isPhpVersion: (version) => versions.includes(version) });

test('readSettings falls back for a store with nothing in it, and for values of the wrong kind', () => {
	const fallbacks = { locale: null, phpVersion: '8.3', wpDebug: true, scriptDebug: true, autoStartServer: false, autoStartWatch: false, quitBehavior: 'stop', theme: 'system', newSiteLocation: null };
	assert.deepEqual(readSettings(), fallbacks);
	assert.deepEqual(readSettings(undefined), fallbacks);
	assert.deepEqual(readSettings({}), fallbacks);
	assert.deepEqual(readSettings({ newSiteLocation: 42, locale: ['de'], phpVersion: 8.4, wpDebug: 'false', scriptDebug: 0, autoStartServer: 'yes', autoStartWatch: 1, quitBehavior: 'leave', theme: 'custom' }), fallbacks);
	assert.deepEqual(readSettings({ newSiteLocation: '', locale: '', phpVersion: '', wpDebug: null, scriptDebug: null }), fallbacks);
	assert.deepEqual(readSettings('not an object'), fallbacks);
});

test('readSettings gives back a stored folder without asking the disk about it', () => {
	assert.deepEqual(
		readSettings({ newSiteLocation: '/Users/jane/sites', locale: 'de', phpVersion: '8.4', wpDebug: false, scriptDebug: false, autoStartServer: true, autoStartWatch: true, quitBehavior: 'restart', theme: 'dark' }),
		{ locale: 'de', phpVersion: '8.4', wpDebug: false, scriptDebug: false, autoStartServer: true, autoStartWatch: true, quitBehavior: 'restart', theme: 'dark', newSiteLocation: '/Users/jane/sites' }
	);
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
	const result = acceptSetting('editor', 'vim', { isAbsolute: () => { asked++; return true; }, isDirectory: () => { asked++; return true; } });
	assert.equal(result.ok, false);
	assert.equal(asked, 0);
});

test('a language is kept when the app has it, English included, and nothing means the system\'s', () => {
	assert.deepEqual(acceptSetting('locale', 'de', languages(['de', 'en'])), { ok: true, value: 'de' });
	assert.deepEqual(acceptSetting('locale', 'en', languages(['de', 'en'])), { ok: true, value: 'en' });
	for (const value of [null, undefined, '']) {
		assert.deepEqual(acceptSetting('locale', value, languages([])), { ok: true, value: null }, String(value));
	}
});

test('a language the app has no catalog for is refused, and so is anything that is not a tag', () => {
	assert.deepEqual(acceptSetting('locale', 'fr', languages(['de', 'en'])), { ok: false, error: 'The app has no translation for that language.' });
	assert.equal(acceptSetting('locale', ['de'], languages(['de'])).ok, false);
	assert.equal(acceptSetting('locale', 42, languages(['de'])).ok, false);
});

test('a PHP version the bundled Playground has is kept, nothing means the fallback, and any other is refused', () => {
	assert.deepEqual(acceptSetting('phpVersion', '8.4', php(['8.5', '8.4', '8.3'])), { ok: true, value: '8.4' });
	for (const value of [null, undefined, '']) {
		assert.deepEqual(acceptSetting('phpVersion', value, php([])), { ok: true, value: null }, String(value));
	}
	assert.deepEqual(acceptSetting('phpVersion', '7.4', php(['8.5', '8.4', '8.3'])), { ok: false, error: 'The app does not have that PHP version.' });
	assert.equal(acceptSetting('phpVersion', 8.4, php(['8.4'])).ok, false);
});

test('a debug flag is on or off, nothing means the fallback, and a string is refused', () => {
	for (const key of ['wpDebug', 'scriptDebug', 'autoStartServer', 'autoStartWatch']) {
		assert.deepEqual(acceptSetting(key, false, {}), { ok: true, value: false }, key);
		assert.deepEqual(acceptSetting(key, true, {}), { ok: true, value: true }, key);
		assert.deepEqual(acceptSetting(key, null, {}), { ok: true, value: null }, key);
		assert.deepEqual(acceptSetting(key, 'false', {}), { ok: false, error: 'Choose on or off.' }, key);
	}
});

test('the theme is light, dark or system, nothing means the system\'s, and the prototype\'s custom is refused (#560)', () => {
	for (const theme of ['light', 'dark', 'system']) assert.deepEqual(acceptSetting('theme', theme, {}), { ok: true, value: theme });
	assert.deepEqual(acceptSetting('theme', null, {}), { ok: true, value: null });
	assert.deepEqual(acceptSetting('theme', '', {}), { ok: true, value: null });
	assert.deepEqual(acceptSetting('theme', 'custom', {}), { ok: false, error: 'Choose light, dark, or your system’s theme.' });
	assert.equal(acceptSetting('theme', 'Dark', {}).ok, false);
	assert.equal(acceptSetting('theme', true, {}).ok, false);
});

test('what happens on quit is stop or restart, nothing means the fallback, and anything else is refused', () => {
	assert.deepEqual(acceptSetting('quitBehavior', 'restart', {}), { ok: true, value: 'restart' });
	assert.deepEqual(acceptSetting('quitBehavior', 'stop', {}), { ok: true, value: 'stop' });
	assert.deepEqual(acceptSetting('quitBehavior', null, {}), { ok: true, value: null });
	// The prototype's third answer, leaving servers running past the quit,
	// is not one the app gives: the quit sweep ends every child it started.
	assert.equal(acceptSetting('quitBehavior', 'leave', {}).ok, false);
	assert.equal(acceptSetting('quitBehavior', true, {}).ok, false);
});
