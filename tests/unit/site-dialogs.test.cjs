const test = require('node:test');
const assert = require('node:assert/strict');

const { renameProblem, deleteSiteQuestion } = require('../../src/renderer/site-dialogs.cjs');

test('a site cannot be given a name of nothing, and a name of spaces is nothing', () => {
	assert.equal(renameProblem(''), 'Site name cannot be empty.');
	assert.equal(renameProblem('   '), 'Site name cannot be empty.');
	assert.equal(renameProblem(undefined), 'Site name cannot be empty.');
	assert.equal(renameProblem(null), 'Site name cannot be empty.');
});

test('any other name can be given, spaces around it or not', () => {
	assert.equal(renameProblem('second-name'), '');
	assert.equal(renameProblem('  second name  '), '');
});

test('the question before a site is deleted names the site, says what goes and that it is for good', () => {
	assert.deepEqual(deleteSiteQuestion('My Gutenberg fix'), {
		title: 'Delete My Gutenberg fix?',
		description: 'This will permanently delete the site and all of its files from your computer. This can’t be undone.',
		confirm: 'Delete site'
	});
});

test('a name with a percent sign in it is said as it is', () => {
	assert.equal(deleteSiteQuestion('100% done').title, 'Delete 100% done?');
	assert.equal(deleteSiteQuestion('%s').title, 'Delete %s?');
});
