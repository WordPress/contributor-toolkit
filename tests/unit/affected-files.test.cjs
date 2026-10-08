const test = require('node:test');
const assert = require('node:assert/strict');

const { affectedFiles, changedFileGroups, fileOpenTarget } = require('../../src/renderer/affected-files.cjs');

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

// --- "Changed files": the change's group and the contributor's (#669) ---------

const unsubmitted = (entries, editedSinceChange = []) => ({ entries, editedSinceChange });

test('with a patch applied, its files are one group and everything else changed is the contributor\'s', () => {
	const groups = changedFileGroups({
		appliedPatch: { label: 'x.patch', files: ['src/a.php', 'src/b.php'] },
		unsubmitted: unsubmitted(
			[{ path: 'src/a.php', added: false }, { path: 'src/b.php', added: false }, { path: 'src/mine.php', added: true }, { path: 'src/edit.php', added: false }],
			['src/b.php']
		)
	});
	assert.deepEqual(groups, {
		change: { label: 'From the patch', files: [{ path: 'src/a.php', alsoEdited: false }, { path: 'src/b.php', alsoEdited: true }] },
		yours: [{ path: 'src/mine.php', added: true }, { path: 'src/edit.php', added: false }]
	});
});

test('with a pull request checked out, its group is named after it', () => {
	const groups = changedFileGroups({
		pullRequest: { number: 7, files: ['src/a.php'] },
		unsubmitted: unsubmitted([{ path: 'src/a.php', added: false }], ['src/a.php'])
	});
	assert.deepEqual(groups.change, { label: 'From PR #7', files: [{ path: 'src/a.php', alsoEdited: true }] });
	assert.deepEqual(groups.yours, []);
});

// A fresh ticket: no change applied, so the contributor's group alone.
test('with nothing applied, there is only the contributor\'s group', () => {
	const groups = changedFileGroups({ unsubmitted: unsubmitted([{ path: 'src/mine.php', added: true }]) });
	assert.deepEqual(groups, { change: null, yours: [{ path: 'src/mine.php', added: true }] });
});

// Before the first answer about the tree arrives, the change's group still
// shows; nothing is guessed about the rest.
test('with no answer about the tree yet, the change is listed and nothing else', () => {
	const groups = changedFileGroups({ appliedPatch: { label: 'x.patch', files: ['src/a.php'] }, unsubmitted: null });
	assert.deepEqual(groups, { change: { label: 'From the patch', files: [{ path: 'src/a.php', alsoEdited: false }] }, yours: [] });
	assert.deepEqual(changedFileGroups({}), { change: null, yours: [] });
});
