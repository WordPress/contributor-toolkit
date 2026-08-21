const test = require('node:test');
const assert = require('node:assert/strict');

const { pathBasename } = require('../../src/renderer/path-basename.cjs');

test('pathBasename handles POSIX paths', () => {
	assert.equal(pathBasename('/Users/me/wp-sites/my-site'), 'my-site');
	assert.equal(pathBasename('/Users/me/wp-sites/my-site/'), 'my-site');
});

test('pathBasename handles Windows paths', () => {
	// The bug: split('/') returned the whole path for these.
	assert.equal(pathBasename('C:\\Users\\me\\wp-sites\\my-site'), 'my-site');
	assert.equal(pathBasename('C:\\Users\\me\\wp-sites\\my-site\\'), 'my-site');
});

test('pathBasename handles mixed separators', () => {
	assert.equal(pathBasename('C:/Users/me\\wp-sites\\my-site'), 'my-site');
});

test('pathBasename falls back to the input when there is no segment', () => {
	assert.equal(pathBasename(''), '');
	assert.equal(pathBasename('/'), '/');
	assert.equal(pathBasename(null), '');
	assert.equal(pathBasename('my-site'), 'my-site');
});
