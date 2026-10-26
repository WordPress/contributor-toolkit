'use strict';

// The Tests section's decisions (tests-section.cjs), which its JSX only calls.

const test = require('node:test');
const assert = require('node:assert/strict');

const { picksTests, groupFieldHint, outcomeNotice, listsTestGroups, groupsFromAnswer } = require('../../src/renderer/tests-section.cjs');

test('the fields pick tests when either has something in it, and none when both are blank', () => {
	assert.equal(picksTests({ filter: 'wpAutop', group: '' }), true);
	assert.equal(picksTests({ filter: '', group: 'ajax' }), true);
	// Blank, or only spaces, would be the whole suite: "Run all" already is.
	assert.equal(picksTests({ filter: '', group: '' }), false);
	assert.equal(picksTests({ filter: '  ', group: ' ' }), false);
});

test('the Group hint names the linked ticket\'s number, and gives examples without one', () => {
	assert.equal(groupFieldHint(65252), 'A group such as ajax or restapi, or a ticket number, such as 65252 for this ticket.');
	assert.equal(groupFieldHint(null), 'A group such as ajax or restapi, or a ticket number.');
});

test('a finished run is a Pass, a Fail or a Notice, and one with no outcome yet is no notice', () => {
	assert.deepEqual(outcomeNotice('pass'), { intent: 'success', title: 'Pass' });
	assert.deepEqual(outcomeNotice('fail'), { intent: 'error', title: 'Fail' });
	assert.deepEqual(outcomeNotice('notice'), { intent: 'warning', title: 'Notice' });
	assert.equal(outcomeNotice('none'), null);
	assert.equal(outcomeNotice('running'), null);
});

test('only the site on screen lists its test groups, and only once its branch is known', () => {
	assert.equal(listsTestGroups({ showsTests: true, isActive: true, branch: 'trunk' }), true);
	// Every site's view stays mounted: one not on screen reads nothing.
	assert.equal(listsTestGroups({ showsTests: true, isActive: false, branch: 'trunk' }), false);
	// Before the branch arrives, a read would be repeated once it does.
	assert.equal(listsTestGroups({ showsTests: true, isActive: true, branch: null }), false);
	// A site with no Tests section (Gutenberg, or not set up) has none to list.
	assert.equal(listsTestGroups({ showsTests: false, isActive: true, branch: 'trunk' }), false);
});

test('main\'s groups are the suggestions, and a refusal or a stray answer is none', () => {
	assert.deepEqual(groupsFromAnswer({ ok: true, groups: ['ajax', 'restapi'] }), ['ajax', 'restapi']);
	assert.deepEqual(groupsFromAnswer({ ok: false, error: 'Site is not registered' }), []);
	assert.deepEqual(groupsFromAnswer({ ok: true }), []);
	assert.deepEqual(groupsFromAnswer(undefined), []);
});
