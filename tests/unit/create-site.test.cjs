const test = require('node:test');
const assert = require('node:assert/strict');

const { projectChoices, projectHelp, createSiteProblem } = require('../../src/renderer/create-site.cjs');
const { PROJECT_TYPES, DEFAULT_PROJECT_TYPE } = require('../../src/project-type.cjs');

test('the dialog offers every project of the registry, by its own name, Core first', () => {
	assert.deepEqual(projectChoices(), [
		{ value: 'core', label: 'WordPress Core' },
		{ value: 'gutenberg', label: 'Gutenberg' }
	]);
	// The first is the one the dialog opens on.
	assert.equal(projectChoices()[0].value, DEFAULT_PROJECT_TYPE);
	assert.equal(projectChoices().length, Object.keys(PROJECT_TYPES).length);
});

test('under the choice it says what the chosen project is, and that the choice is for good', () => {
	assert.deepEqual(projectHelp('core'), {
		about: 'The wordpress-develop repository: Trac tickets, patches and pull requests.',
		lasting: 'A site’s project cannot be changed later.'
	});
	assert.equal(projectHelp('gutenberg').about, PROJECT_TYPES.gutenberg.description);
	assert.notEqual(projectHelp('gutenberg').about, projectHelp('core').about);
	assert.equal(projectHelp('gutenberg').lasting, projectHelp('core').lasting);
});

test('a project it does not know is described as Core, which is what such a site is', () => {
	assert.deepEqual(projectHelp('nope'), projectHelp('core'));
	assert.deepEqual(projectHelp(undefined), projectHelp('core'));
});

test('a missing name is said first, and a name of spaces is no name', () => {
	assert.equal(createSiteProblem({ name: '', dir: '' }), 'Please provide a site name.');
	assert.equal(createSiteProblem({ name: '   ', dir: '/sites' }), 'Please provide a site name.');
	assert.equal(createSiteProblem(), 'Please provide a site name.');
});

test('with a name, a missing folder is said', () => {
	assert.equal(createSiteProblem({ name: 'My site', dir: '' }), 'Please choose where to create the site.');
	assert.equal(createSiteProblem({ name: 'My site' }), 'Please choose where to create the site.');
});

test('with both there is nothing to say', () => {
	assert.equal(createSiteProblem({ name: 'My site', dir: '/sites' }), '');
	assert.equal(createSiteProblem({ name: '  My site  ', dir: 'C:\\sites' }), '');
});
