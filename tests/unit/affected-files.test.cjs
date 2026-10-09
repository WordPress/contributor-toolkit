const test = require('node:test');
const assert = require('node:assert/strict');

const { affectedFiles, fileOpenTarget } = require('../../src/renderer/affected-files.cjs');

const VSCODE = { id: 'vscode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' };
const CURSOR = { id: 'cursor', name: 'Cursor', path: '/Applications/Cursor.app' };

test('the files an applied patch changed are listed, in the order it changed them', () => {
	const appliedPatch = { label: 'ticket-1.patch', files: ['src/wp-login.php', 'src/wp-includes/user.php'] };
	assert.deepEqual(affectedFiles({ appliedPatch }), ['src/wp-login.php', 'src/wp-includes/user.php']);
});

// No patch, or a record with nothing usable in it, is no section at all
// rather than a heading over nothing.
test('with no patch applied there is nothing to list', () => {
	assert.deepEqual(affectedFiles({ appliedPatch: null }), []);
	assert.deepEqual(affectedFiles({}), []);
	assert.deepEqual(affectedFiles({ appliedPatch: { label: 'x.patch' } }), []);
	assert.deepEqual(affectedFiles({ appliedPatch: { label: 'x.patch', files: [] } }), []);
});

// A checked-out pull request lists what it changed, the same way (#669).
test('the files a checked-out pull request changed are listed', () => {
	const pullRequest = { number: 7, files: ['src/wp-login.php', 'src/old.php'] };
	assert.deepEqual(affectedFiles({ pullRequest }), ['src/wp-login.php', 'src/old.php']);
	assert.deepEqual(affectedFiles({ appliedPatch: null, pullRequest }), ['src/wp-login.php', 'src/old.php']);
});

// One checked out before the app recorded its files has none to list.
test('a pull request with no recorded files lists nothing', () => {
	assert.deepEqual(affectedFiles({ pullRequest: { number: 7, files: null } }), []);
	assert.deepEqual(affectedFiles({ pullRequest: { number: 7 } }), []);
});

// Detection's order is the site menu's order, which puts Visual Studio Code
// first where it is installed: the file opens in the editor that menu offers
// first.
test('a file opens in the first editor detection found', () => {
	assert.deepEqual(fileOpenTarget({ editors: [VSCODE, CURSOR] }), { kind: 'editor', path: VSCODE.path });
	assert.deepEqual(fileOpenTarget({ editors: [CURSOR] }), { kind: 'editor', path: CURSOR.path });
});

test('with no editor found, the file is shown in the file manager', () => {
	assert.deepEqual(fileOpenTarget({ editors: [] }), { kind: 'reveal' });
	assert.deepEqual(fileOpenTarget({}), { kind: 'reveal' });
	assert.deepEqual(fileOpenTarget({ editors: null }), { kind: 'reveal' });
});
