'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { githubAccountLine, newSiteLocationNote, languageItems, languageChanged, SYSTEM_LANGUAGE } = require('../../src/renderer/settings-view.cjs');

test('the GitHub line says the account is still being read, and offers no sign-out, until it is', () => {
	assert.deepEqual(githubAccountLine(null), { text: 'Reading…', canSignOut: false });
	assert.deepEqual(githubAccountLine(undefined), { text: 'Reading…', canSignOut: false });
});

test('the GitHub line names the account that is signed in, and only then offers to sign out', () => {
	assert.deepEqual(githubAccountLine({ login: 'janedoe', configured: true }), { text: 'Signed in as janedoe.', canSignOut: true });
	assert.deepEqual(githubAccountLine({ login: null, configured: true }), {
		text: 'Not signed in. The app asks you to sign in when you open a pull request.',
		canSignOut: false
	});
});

test('the GitHub line says when sign-in is not set up in this build, whatever else the account says', () => {
	assert.deepEqual(githubAccountLine({ login: 'janedoe', configured: false }), { text: 'Sign-in is not set up in this build.', canSignOut: false });
});

test('the folder note says the settings are still being read until they are, and then that none is set', () => {
	assert.equal(newSiteLocationNote(null), 'Reading…');
	assert.equal(newSiteLocationNote(undefined), 'Reading…');
	assert.equal(newSiteLocationNote({ newSiteLocation: null }), 'Not set: the create-site dialog asks each time.');
});

test('the language entries are the system\'s first, then what the app has, and the one set if it is none of them', () => {
	const languages = [{ tag: 'de', label: 'Deutsch' }, { tag: 'en', label: 'English' }];
	assert.deepEqual(languageItems(languages, null), [
		{ value: SYSTEM_LANGUAGE, label: 'Your system’s language' },
		{ value: 'de', label: 'Deutsch' },
		{ value: 'en', label: 'English' }
	]);
	assert.deepEqual(languageItems(languages, 'de').map((item) => item.value), [SYSTEM_LANGUAGE, 'de', 'en']);
	assert.deepEqual(languageItems(languages, 'fr').at(-1), { value: 'fr', label: 'fr' });
	assert.deepEqual(languageItems(null, 'en-XA').map((item) => item.value), [SYSTEM_LANGUAGE, 'en-XA']);
});

test('the language has changed when what is set is no longer what the window started in', () => {
	assert.equal(languageChanged(null, null), false);
	assert.equal(languageChanged({ locale: 'de' }, null), false);
	assert.equal(languageChanged({ locale: null }, { locale: null }), false);
	assert.equal(languageChanged({ locale: 'de' }, { locale: 'de' }), false);
	assert.equal(languageChanged({ locale: 'de' }, { locale: null }), true);
	assert.equal(languageChanged({ locale: null }, { locale: 'de' }), true);
});
