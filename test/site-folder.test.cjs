// The Create site modal's path arithmetic, which decides where a site is
// cloned before anything is cloned. Both platforms are exercised from one
// machine: nothing here reads `process.platform`, the separator is chosen from
// the shape of the root string, so a macOS run covers the Windows branch too.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	sanitizeSiteFolder,
	resolveTargetDir,
	directoryFromFileEntry,
	FALLBACK_FOLDER
} = require('../src/renderer/site-folder.cjs');

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

// What follows pins what this function does with the entries it actually gets,
// which is not the same as what it was written for. The `path` property it
// prefers was removed from `File` in Electron 32, this app pins Electron 43,
// and no `webUtils` bridge replaces it — so every real entry takes the
// fallback. Asserting the `path` shapes would be green and prove nothing.
//
// The only route that reaches this at all is dropping a folder on the control,
// which the app deliberately does not support — #228, closed as not planned.
// So these record where an unsupported route ends, and are the tests a change
// of mind would have to rewrite.

test('directoryFromFileEntry gets nothing from a real dropped entry', () => {
	// A File in Electron 43. No `path`, and `webkitRelativePath` alone carries
	// no absolute part to cut it off.
	assert.equal(directoryFromFileEntry({ webkitRelativePath: 'sites/inner/file.txt' }, ''), '');
	assert.equal(directoryFromFileEntry({}, ''), '');
	assert.equal(directoryFromFileEntry(null, ''), '');
	assert.equal(directoryFromFileEntry(undefined, undefined), '');
});

test('directoryFromFileEntry passes C:\\fakepath through — #228', () => {
	// Recorded, not endorsed. A file input's `value` is either empty or this
	// literal prefix on every platform, browsers substituting it for the real
	// path, so the fallback's "typed path" is a fiction. The modal shows this
	// as the chosen folder and submit hands it to setup.
	assert.equal(directoryFromFileEntry({}, 'C:\\fakepath\\my-folder'), 'C:\\fakepath');
});

test('directoryFromFileEntry returns nothing rather than a wrong directory', () => {
	// '' is what the caller checks before it clears the chosen directory — a
	// bare segment is not a directory anyone chose.
	assert.equal(directoryFromFileEntry({}, 'file.txt'), '');
	assert.equal(directoryFromFileEntry({}, ''), '');
});
