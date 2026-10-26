'use strict';

// Each site's PHP unit test files live in one folder of their own, which the
// runner writes and deleting the site removes: both have to name the same one.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { phpunitSiteFolder } = require('../../src/phpunit-folder.cjs');

test('a site\'s folder is one of its own, under the toolkit directory, the same however its path is written', () => {
	const toolkit = path.resolve('/data/php-tests');
	const site = path.resolve('/sites/core');
	const folder = phpunitSiteFolder(toolkit, site);
	assert.equal(path.dirname(folder), toolkit);
	assert.match(path.basename(folder), /^[0-9a-f]{16}$/);
	assert.equal(phpunitSiteFolder(toolkit, `${site}${path.sep}`), folder);
	assert.notEqual(phpunitSiteFolder(toolkit, path.resolve('/sites/other')), folder);
});
