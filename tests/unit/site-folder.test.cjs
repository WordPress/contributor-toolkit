// The Create site modal's path arithmetic, which decides where a site is
// cloned before anything is cloned. Both platforms are exercised from one
// machine: nothing here reads `process.platform`, the separator is chosen from
// the shape of the root string, so a macOS run covers the Windows branch too.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	sanitizeSiteFolder,
	resolveTargetDir,
	FALLBACK_FOLDER
} = require('../../src/renderer/site-folder.cjs');

test('sanitizeSiteFolder replaces characters Windows refuses in a folder name', () => {
	assert.equal(sanitizeSiteFolder('feature/45678'), 'feature-45678');
	assert.equal(sanitizeSiteFolder('trac:45678'), 'trac-45678');
	assert.equal(sanitizeSiteFolder('a\\b*c?d"e<f>g|h'), 'a-b-c-d-e-f-g-h');
});

test('sanitizeSiteFolder collapses whitespace and trims the dashes it created', () => {
	assert.equal(sanitizeSiteFolder('My Site'), 'My-Site');
	assert.equal(sanitizeSiteFolder('  My   Site  '), 'My-Site');
	assert.equal(sanitizeSiteFolder('-already-dashed-'), 'already-dashed');
});

test('sanitizeSiteFolder falls back rather than returning an empty folder name', () => {
	// An empty result would join to the root itself, cloning WordPress straight
	// into the directory the contributor picked.
	assert.equal(sanitizeSiteFolder('///'), FALLBACK_FOLDER);
	assert.equal(sanitizeSiteFolder('   '), FALLBACK_FOLDER);
	assert.equal(sanitizeSiteFolder(''), FALLBACK_FOLDER);
	assert.equal(sanitizeSiteFolder(null), FALLBACK_FOLDER);
	assert.equal(sanitizeSiteFolder(undefined), FALLBACK_FOLDER);
});

test('resolveTargetDir keeps a Windows root on backslashes', () => {
	assert.equal(resolveTargetDir('C:\\Users\\me\\sites', 'my-site'), 'C:\\Users\\me\\sites\\my-site');
	assert.equal(resolveTargetDir('C:\\Users\\me\\sites\\', 'my-site'), 'C:\\Users\\me\\sites\\my-site');
});

test('resolveTargetDir keeps a POSIX root on forward slashes', () => {
	assert.equal(resolveTargetDir('/Users/me/sites', 'my-site'), '/Users/me/sites/my-site');
	assert.equal(resolveTargetDir('/Users/me/sites///', 'my-site'), '/Users/me/sites/my-site');
});

test('resolveTargetDir uses a forward slash for a mixed root', () => {
	// Windows accepts both, so the only thing this must not do is guess wrong
	// about a path that already contains a forward slash and produce neither.
	assert.equal(resolveTargetDir('C:/Users/me\\sites', 'my-site'), 'C:/Users/me\\sites/my-site');
});

test('resolveTargetDir at a Windows drive root produces an absolute path', () => {
	// Stripping the trailing separator off `C:\` leaves `C:`, which has no
	// backslash left to detect — so this takes the forward-slash branch. The
	// result is still absolute on Windows, which is what matters; `C:my-site`
	// would have been drive-relative and landed somewhere else entirely.
	assert.equal(resolveTargetDir('C:\\', 'my-site'), 'C:/my-site');
});

test('resolveTargetDir with no root is the folder name alone', () => {
	// The modal blocks submitting without a directory, so this is a guard, not
	// a path a contributor reaches.
	assert.equal(resolveTargetDir('', 'my-site'), 'my-site');
	assert.equal(resolveTargetDir(null, 'my-site'), 'my-site');
});
