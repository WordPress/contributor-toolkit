'use strict';

// The project-type registry (src/project-type.cjs) is the one place the
// per-target facts live, and every consumer reaches them through getProjectType
// / projectTypeForSite. These tests pin the two things those consumers rely on:
// the default-to-Core seam (an unknown or missing type is Core, with no throw),
// and that both known types carry the full shape a consumer will read.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	PROJECT_TYPES,
	DEFAULT_PROJECT_TYPE,
	getProjectType,
	projectTypeForSite,
	isProjectTypeId,
	normalizeProjectType
} = require('../../src/project-type.cjs');

test('the default project type is core', () => {
	assert.equal(DEFAULT_PROJECT_TYPE, 'core');
	assert.equal(getProjectType(DEFAULT_PROJECT_TYPE).id, 'core');
});

test('getProjectType returns the named type when it is known', () => {
	assert.equal(getProjectType('core').id, 'core');
	assert.equal(getProjectType('gutenberg').id, 'gutenberg');
});

// The seam the whole feature rests on: anything that is not a known id resolves
// to Core rather than throwing or returning undefined. A site made before the
// field existed (undefined), a typo, a hostile value, all Core.
test('getProjectType falls back to core for unknown or missing ids', () => {
	// The last three are inherited keys of a plain object: without an
	// own-property check they resolve to Object.prototype and to functions.
	for (const bad of [undefined, null, '', 'GUTENBERG', 'core ', 'plugin', 42, {}, '__proto__', 'constructor', 'toString']) {
		assert.equal(getProjectType(bad).id, 'core', `expected core for ${JSON.stringify(bad)}`);
	}
});

test('projectTypeForSite reads the id straight off a site meta record', () => {
	assert.equal(projectTypeForSite({ projectType: 'gutenberg' }).id, 'gutenberg');
	// Absent field, empty meta, and no meta at all all mean Core.
	assert.equal(projectTypeForSite({}).id, 'core');
	assert.equal(projectTypeForSite(undefined).id, 'core');
	assert.equal(projectTypeForSite(null).id, 'core');
});

test('isProjectTypeId is true only for defined ids', () => {
	assert.equal(isProjectTypeId('core'), true);
	assert.equal(isProjectTypeId('gutenberg'), true);
	assert.equal(isProjectTypeId('nope'), false);
	assert.equal(isProjectTypeId(undefined), false);
});

test('normalizeProjectType passes known ids through and coerces the rest to core', () => {
	assert.equal(normalizeProjectType('gutenberg'), 'gutenberg');
	assert.equal(normalizeProjectType('core'), 'core');
	assert.equal(normalizeProjectType('bogus'), 'core');
	assert.equal(normalizeProjectType(undefined), 'core');
});

// Consumers in later PRs read cfg.clone.url, cfg.upstream.repo, the built-check
// path, the watch command, the serve strategy, etc. If a type is missing one of
// these, that consumer breaks only for that type and only at runtime, so assert
// the shape here where it is cheap to catch.
test('every project type carries the full shape consumers depend on', () => {
	for (const [id, cfg] of Object.entries(PROJECT_TYPES)) {
		assert.equal(cfg.id, id, `${id}: id must match its key`);
		assert.equal(typeof cfg.label, 'string');
		assert.equal(typeof cfg.wizardLabel, 'string');
		assert.equal(typeof cfg.workItemNoun, 'string');

		assert.equal(typeof cfg.clone.url, 'string');
		assert.match(cfg.clone.url, /^https:\/\/github\.com\/.+\.git$/);
		assert.equal(typeof cfg.clone.ref, 'string');
		assert.match(cfg.defaultFolderName, /^[a-z0-9-]+$/, `${id}: the default folder name must already be a safe file name`);

		assert.equal(typeof cfg.upstream.owner, 'string');
		assert.equal(typeof cfg.upstream.repo, 'string');
		assert.equal(typeof cfg.upstream.base, 'string');

		assert.ok(Array.isArray(cfg.build.builtCheckRelPath) && cfg.build.builtCheckRelPath.length > 0);
		assert.equal(typeof cfg.build.watch.script, 'string');
		assert.ok(Array.isArray(cfg.build.watch.args));
		assert.ok(Array.isArray(cfg.build.allowedScripts) && cfg.build.allowedScripts.length > 0);

		for (const key of ['cloneLabel', 'cloneDescription', 'buildDescription', 'builtDescription', 'serverDescription']) {
			assert.equal(typeof cfg.setup[key], 'string', `${id}: setup.${key}`);
		}
		assert.equal(typeof cfg.cards.applyHeading, 'string', `${id}: cards.applyHeading`);
		assert.equal(typeof cfg.cards.applyDescription, 'string', `${id}: cards.applyDescription`);
		assert.equal(typeof cfg.cards.patchFiles, 'boolean', `${id}: cards.patchFiles`);
		// A target whose work item is not a Trac ticket says what stands in for
		// the ticket card; the Trac target has the card itself.
		assert.equal(cfg.cards.workItemPlaceholder === null, cfg.workItem.provider === 'trac', `${id}: cards.workItemPlaceholder`);
		assert.equal(cfg.cards.patchFiles, cfg.workItem.provider === 'trac', `${id}: patch files go with Trac`);
		assert.ok(['docroot', 'plugin-mount'].includes(cfg.serve.strategy));
		assert.ok(['src-layout', 'repo-relative'].includes(cfg.patch.layout));
		assert.ok(['trac', 'github-issue'].includes(cfg.workItem.provider));

		assert.equal(typeof cfg.pr.branchPrefix, 'string');
		assert.equal(typeof cfg.pr.bodyLine, 'function');
	}
});

// Where a site reads its own build from. Core's marker is the one site:status
// always checked; Gutenberg's follows its current build layout (see the
// registry comment for when it moved).
test('the built marker names a file the build actually writes', () => {
	assert.deepEqual(getProjectType('core').build.builtCheckRelPath, ['build', 'wp-includes', 'js', 'dist']);
	assert.deepEqual(getProjectType('gutenberg').build.builtCheckRelPath, ['build', 'scripts', 'block-library', 'index.min.js']);
});

// The two concrete targets, spelled out so a wrong-repo regression is caught
// here rather than by a contributor whose PR lands in the wrong project.
test('core and gutenberg point at their real repositories', () => {
	assert.equal(getProjectType('core').clone.url, 'https://github.com/WordPress/wordpress-develop.git');
	assert.deepEqual(
		{ ...getProjectType('core').upstream },
		{ owner: 'WordPress', repo: 'wordpress-develop', base: 'trunk' }
	);

	assert.equal(getProjectType('gutenberg').clone.url, 'https://github.com/WordPress/gutenberg.git');
	assert.deepEqual(
		{ ...getProjectType('gutenberg').upstream },
		{ owner: 'WordPress', repo: 'gutenberg', base: 'trunk' }
	);
});

// The pull-request body line is where the two work-item worlds show through:
// Core cites a Trac URL, Gutenberg closes a GitHub issue by number.
test('the PR body line matches each project’s work-item convention', () => {
	assert.equal(
		getProjectType('core').pr.bodyLine(62281, 'https://core.trac.wordpress.org/ticket/62281'),
		'Trac ticket: https://core.trac.wordpress.org/ticket/62281'
	);
	assert.equal(getProjectType('gutenberg').pr.bodyLine(12345), 'Fixes #12345');
});
