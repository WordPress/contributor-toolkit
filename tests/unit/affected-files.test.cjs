const test = require('node:test');
const assert = require('node:assert/strict');

const { affectedFiles, changedFileGroups, fileOpenTarget, revertFileQuestion, revertOutcome } = require('../../src/renderer/affected-files.cjs');

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
		appliedPatch: { label: 'x.patch', files: ['src/a.php', 'src/b.php'], kept: true },
		unsubmitted: unsubmitted(
			[{ path: 'src/a.php', added: false }, { path: 'src/b.php', added: false }, { path: 'src/mine.php', added: true }, { path: 'src/edit.php', added: false }],
			['src/b.php']
		)
	});
	assert.deepEqual(groups, {
		change: { label: 'From the patch', files: [{ path: 'src/a.php', alsoEdited: false, canRevert: false }, { path: 'src/b.php', alsoEdited: true, canRevert: true }] },
		yours: [{ path: 'src/mine.php', added: true, canRevert: true }, { path: 'src/edit.php', added: false, canRevert: true }]
	});
});

test('with a pull request checked out, its group is named after it', () => {
	const groups = changedFileGroups({
		pullRequest: { number: 7, files: ['src/a.php'] },
		unsubmitted: unsubmitted([{ path: 'src/a.php', added: false }], ['src/a.php'])
	});
	assert.deepEqual(groups.change, { label: 'From PR #7', files: [{ path: 'src/a.php', alsoEdited: true, canRevert: true }] });
	assert.deepEqual(groups.yours, []);
});

// A fresh ticket: no change applied, so the contributor's group alone.
test('with nothing applied, there is only the contributor\'s group', () => {
	const groups = changedFileGroups({ unsubmitted: unsubmitted([{ path: 'src/mine.php', added: true }]) });
	assert.deepEqual(groups, { change: null, yours: [{ path: 'src/mine.php', added: true, canRevert: true }] });
});

// Before the first answer about the tree arrives, the change's group still
// shows; nothing is guessed about the rest.
test('with no answer about the tree yet, the change is listed and nothing else', () => {
	const groups = changedFileGroups({ appliedPatch: { label: 'x.patch', files: ['src/a.php'] }, unsubmitted: null });
	assert.deepEqual(groups, { change: { label: 'From the patch', files: [{ path: 'src/a.php', alsoEdited: false, canRevert: false }] }, yours: [] });
	assert.deepEqual(changedFileGroups({}), { change: null, yours: [] });
});

// A patch file the contributor edited goes back to the patch's version, which
// needs the patch's text (#669); without it there is nothing to go back to.
test('an edited patch file cannot be reverted when the patch\'s text was not kept', () => {
	const groups = changedFileGroups({
		appliedPatch: { label: 'big.patch', files: ['src/a.php'], kept: false },
		unsubmitted: unsubmitted([{ path: 'src/a.php', added: false }], ['src/a.php'])
	});
	assert.deepEqual(groups.change.files, [{ path: 'src/a.php', alsoEdited: true, canRevert: false }]);
});

// What the revert button asks first (#669): what the file goes back to, or
// that it goes, for one the contributor created.
test('the question before reverting a file says what it goes back to', () => {
	assert.deepEqual(revertFileQuestion({ path: 'src/a.php', added: false }), {
		title: 'Revert src/a.php?',
		description: 'Your changes to it are removed. This can’t be undone.',
		confirm: 'Revert file',
		done: 'src/a.php reverted.'
	});
	assert.deepEqual(revertFileQuestion({ path: 'src/new.php', added: true }), {
		title: 'Delete src/new.php?',
		description: 'You created this file. This can’t be undone.',
		confirm: 'Delete file',
		done: 'src/new.php deleted.'
	});
	assert.equal(
		revertFileQuestion({ path: 'src/a.php', alsoEdited: true }, { fromChange: true }).description,
		'Your edits to it are removed, and it goes back to how the patch left it. This can’t be undone.'
	);
	assert.equal(
		revertFileQuestion({ path: 'src/a.php', alsoEdited: true }, { fromChange: true, pullRequest: { number: 7 } }).description,
		'Your edits to it are removed, and it goes back to how PR #7 has it. This can’t be undone.'
	);
});

// Either end of a file the patch renames goes back only with the whole patch
// (#669), so neither has a button, whichever group it lands in.
test('neither end of a renamed file can be reverted on its own', () => {
	const groups = changedFileGroups({
		appliedPatch: { label: 'x.patch', files: ['src/b.php'], kept: true },
		unsubmitted: { entries: [{ path: 'src/a.php', added: false }, { path: 'src/b.php', added: true }], editedSinceChange: ['src/b.php'], renamedByChange: ['src/a.php', 'src/b.php'] }
	});
	assert.deepEqual(groups.change.files, [{ path: 'src/b.php', alsoEdited: true, canRevert: false }]);
	assert.deepEqual(groups.yours, [{ path: 'src/a.php', added: false, canRevert: false }]);
});

test('revertOutcome carries the recount, and the handler\'s own sentence on failure', () => {
	assert.deepEqual(revertOutcome({ ok: true, dirty: true, changedCount: 1 }), { ok: true, dirty: true, changedCount: 1 });
	assert.deepEqual(revertOutcome({ ok: true }), { ok: true });
	assert.deepEqual(revertOutcome({ ok: false, code: 'failed', error: 'Could not revert src/a.php, so it was left as it was: x' }), { ok: false, message: 'Could not revert src/a.php, so it was left as it was: x' });
	assert.deepEqual(revertOutcome(null), { ok: false, message: 'Could not revert the file: Unknown error' });
});
