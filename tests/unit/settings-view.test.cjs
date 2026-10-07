'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { githubAccountLine, newSiteLocationNote, languageItems, languageValue, languageChanged, phpVersionChoice, quitItems, themeItems, resumeFor, SYSTEM_LANGUAGE } = require('../../src/renderer/settings-view.cjs');

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

test('the system\'s entry is kept as no choice, and a language as itself', () => {
	assert.equal(languageValue(SYSTEM_LANGUAGE), null);
	assert.equal(languageValue('de'), 'de');
	assert.equal(languageValue('en'), 'en');
});

test('the PHP version shown as chosen is the one set, the fallback when none is, and nothing until the build has answered', () => {
	const versions = ['8.5', '8.4', '8.3'];
	assert.deepEqual(phpVersionChoice({ versions: null, fallback: null, stored: '8.4' }), { value: null, note: '' });
	assert.deepEqual(phpVersionChoice({ versions, fallback: '8.3', stored: null }), { value: '8.3', note: '' });
	assert.deepEqual(phpVersionChoice({ versions, fallback: '8.3', stored: '8.4' }), { value: '8.4', note: '' });
});

test('a version set that the build no longer has shows the fallback as chosen, and says why', () => {
	assert.deepEqual(phpVersionChoice({ versions: ['8.5', '8.4', '8.3'], fallback: '8.3', stored: '7.4' }), {
		value: '8.3',
		note: 'PHP 7.4 was chosen, but this version of the app does not have it; servers start on PHP 8.3.'
	});
});

test('the quit control offers stop and restart, and not the prototype\'s leaving them running', () => {
	assert.deepEqual(quitItems().map((item) => item.value), ['stop', 'restart']);
	assert.ok(quitItems().every((item) => item.label));
});

test('the theme control offers light, dark, system and custom, in that order (#560)', () => {
	assert.deepEqual(themeItems(), [
		{ value: 'light', label: 'Light' },
		{ value: 'dark', label: 'Dark' },
		{ value: 'system', label: 'System' },
		{ value: 'custom', label: 'Custom' }
	]);
});

test('what the next launch starts for a site comes from the list the quit left', () => {
	const resume = { servers: ['/a', '/both'], watches: ['/w', '/both'] };
	assert.deepEqual(resumeFor(resume, '/a'), { server: true, watch: false });
	assert.deepEqual(resumeFor(resume, '/w'), { server: false, watch: true });
	assert.deepEqual(resumeFor(resume, '/both'), { server: true, watch: true });
	assert.equal(resumeFor(resume, '/other'), null);
	assert.equal(resumeFor(null, '/a'), null);
	assert.equal(resumeFor({}, '/a'), null);
});
