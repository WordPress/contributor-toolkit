'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { prStageLabel } = require('../../src/renderer/pr-stage.cjs');

// The slow step names the repository it forks, which is the site's (#251).
test('the forking stage names the site’s repository', () => {
	assert.strictEqual(prStageLabel('forking', 'wordpress-develop'), 'Creating your fork of wordpress-develop…');
	assert.strictEqual(prStageLabel('forking', 'gutenberg'), 'Creating your fork of gutenberg…');
});

test('every other stage has a label, and an unknown one still says something', () => {
	assert.strictEqual(prStageLabel('syncing', 'gutenberg'), 'Bringing your fork up to date…');
	assert.strictEqual(prStageLabel('committing', 'gutenberg'), 'Uploading your changes…');
	assert.strictEqual(prStageLabel('opening', 'gutenberg'), 'Opening the pull request…');
	assert.strictEqual(prStageLabel('', 'gutenberg'), 'Working…');
});
