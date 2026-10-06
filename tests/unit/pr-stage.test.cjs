'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { prStageLabel } = require('../../src/renderer/pr-stage.cjs');
const { addFilter, removeFilter } = require('@wordpress/hooks');
const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');

// The slow step names the repository it forks: the site's, or the sandbox the
// override sends the run to (#251). Whatever it is given, it says.
test('the forking stage names the repository being forked', () => {
	assert.strictEqual(prStageLabel('forking', 'WordPress/wordpress-develop'), 'Creating your fork of WordPress/wordpress-develop…');
	assert.strictEqual(prStageLabel('forking', 'WordPress/gutenberg'), 'Creating your fork of WordPress/gutenberg…');
	assert.strictEqual(prStageLabel('forking', 'sandbox-org/pr-sandbox'), 'Creating your fork of sandbox-org/pr-sandbox…');
});

test('every other stage has a label, and an unknown one still says something', () => {
	assert.strictEqual(prStageLabel('syncing', 'WordPress/gutenberg'), 'Bringing your fork up to date…');
	assert.strictEqual(prStageLabel('committing', 'WordPress/gutenberg'), 'Uploading your changes…');
	assert.strictEqual(prStageLabel('opening', 'WordPress/gutenberg'), 'Opening the pull request…');
	assert.strictEqual(prStageLabel('', 'WordPress/gutenberg'), 'Working…');
});

test('the stage labels are translated when they are read, not when the module loads', (t) => {
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => removeFilter('i18n.gettext', 'test/pseudo-locale'));
	assert.strictEqual(prStageLabel('forking', 'WordPress/gutenberg'), pseudoLocalize('Creating your fork of %s…').replace('%s', 'WordPress/gutenberg'));
	assert.strictEqual(prStageLabel('opening', 'WordPress/gutenberg'), pseudoLocalize('Opening the pull request…'));
});
