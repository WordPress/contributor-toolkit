'use strict';

// The Group field suggests the named groups core's tests are tagged with, read
// from the checkout's own test files.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { groupsInSource, listTestGroups } = require('../../src/phpunit-groups.cjs');

test('groupsInSource reads the names after @group and leaves out ticket numbers', () => {
	const source = `<?php
/**
 * @group ajax
 * @group 12345
 */
class Tests_Ajax_Foo extends WP_Ajax_UnitTestCase {
	/** @group html-api */
	public function test_bar() {}
}`;
	assert.deepEqual(groupsInSource(source), ['ajax', 'html-api']);
});

test('listTestGroups lists each named group in the checkout\'s tests once, sorted, from nested folders too', async (t) => {
	const site = fs.mkdtempSync(path.join(os.tmpdir(), 'phpunit-groups-'));
	t.after(() => fs.rmSync(site, { recursive: true, force: true }));
	const tests = path.join(site, 'tests', 'phpunit', 'tests');
	fs.mkdirSync(path.join(tests, 'rest-api'), { recursive: true });
	fs.writeFileSync(path.join(tests, 'formatting.php'), '<?php /** @group formatting @group ajax */');
	fs.writeFileSync(path.join(tests, 'rest-api', 'posts.php'), '<?php /** @group restapi\n * @group ajax */');
	fs.writeFileSync(path.join(tests, 'notes.txt'), '@group not-php');

	assert.deepEqual(await listTestGroups(site), ['ajax', 'formatting', 'restapi']);
});

test('listTestGroups finds none in a checkout with no tests folder', async (t) => {
	const site = fs.mkdtempSync(path.join(os.tmpdir(), 'phpunit-groups-'));
	t.after(() => fs.rmSync(site, { recursive: true, force: true }));

	assert.deepEqual(await listTestGroups(site), []);
});
