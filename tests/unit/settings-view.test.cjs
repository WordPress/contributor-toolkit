'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { githubAccountLine } = require('../../src/renderer/settings-view.cjs');

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
