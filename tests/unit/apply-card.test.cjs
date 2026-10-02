const test = require('node:test');
const assert = require('node:assert/strict');

const { applyCardWords, previewWords, applyStepRows, applyFailureWords, conflictFileRows, checkoutNoticeIntent } = require('../../src/renderer/apply-card.cjs');
const { describePrPreview } = require('../../src/renderer/pr-checkout.cjs');

test('a project that takes patch files is offered a pull request and a file, each under its own tab', () => {
	const words = applyCardWords(true);
	assert.equal(words.title, 'Apply a patch or PR');
	assert.equal(words.prTab, 'Pull request');
	assert.equal(words.fileTab, 'Diff');
	assert.equal(words.fileAction, 'Choose a .diff or .patch file…');
	assert.equal(words.prLabel, 'Pull request URL or number');
	assert.equal(words.prAction, 'Apply PR');
});

test('a project that takes none is offered pull requests only, and no word about files', () => {
	const words = applyCardWords(false);
	assert.equal(words.title, 'Check out a pull request');
	assert.equal(words.prLabel, 'Pull request URL or number');
	for (const key of ['prTab', 'fileTab', 'fileLabel', 'fileAction', 'fileHelp']) assert.equal(words[key], undefined, key);
	for (const text of Object.values(words)) assert.doesNotMatch(text, /patch|\.diff/i);
});

test('both kinds of project say that a pull request is checked out, and that the contributor\'s changes are kept', () => {
	for (const words of [applyCardWords(true), applyCardWords(false)]) {
		assert.match(words.prHelp, /checked out with its author’s commits/);
		assert.match(words.description, /Your own changes are preserved\.$/);
	}
});

test('nothing to preview is nothing to say', () => {
	assert.equal(previewWords(), null);
	assert.equal(previewWords({ preview: null }), null);
});

test('a patch file\'s preview names the file, counts what it changes, and applies and rebuilds', () => {
	const one = previewWords({ preview: { kind: 'patch', label: '65933.diff', paths: ['src/wp-login.php'], unsupported: [], needsInstall: false } });
	assert.deepEqual(one, { title: 'Apply 65933.diff', headline: '65933.diff changes 1 file.', action: 'Apply and rebuild', closedNote: '', skipped: '', installNote: '' });
	const two = previewWords({ preview: { kind: 'patch', label: '65933.diff', paths: ['a.php', 'b.php'] } });
	assert.equal(two.headline, '65933.diff changes 2 files.');
});

test('a patch file with binary files in it says which are skipped, one or several', () => {
	const preview = { kind: 'patch', label: 'p.diff', paths: ['a.php'] };
	assert.equal(previewWords({ preview: { ...preview, unsupported: ['logo.png'] } }).skipped, 'logo.png is a binary file and will be skipped.');
	assert.equal(previewWords({ preview: { ...preview, unsupported: ['logo.png', 'icon.ico'] } }).skipped, 'logo.png, icon.ico are binary files and will be skipped.');
	assert.equal(previewWords({ preview }).skipped, '');
});

test('a patch file that changes the lockfile says dependencies will be installed', () => {
	const preview = { kind: 'patch', label: 'p.diff', paths: ['package-lock.json'], needsInstall: true };
	assert.match(previewWords({ preview }).installNote, /package-lock\.json, so dependencies will be installed/);
	assert.equal(previewWords({ preview: { ...preview, needsInstall: false } }).installNote, '');
});

test('a pull request\'s preview is titled by its number and says what the checkout module says of it', () => {
	const pr = describePrPreview({ number: 7, files: ['src/wp-login.php'], needsInstall: true, state: 'closed' });
	const words = previewWords({ preview: { kind: 'pr', number: 7, paths: ['src/wp-login.php'], unsupported: ['ignored.png'], needsInstall: true }, pr });
	assert.deepEqual(words, { title: 'Apply PR #7', headline: pr.headline, action: pr.actionLabel, closedNote: pr.closedNote, skipped: '', installNote: pr.installNote });
	assert.equal(words.headline, 'PR #7 changes 1 file.');
	// A copy with edits on a pull request that moved is gone back to, not
	// applied again, and the button says so.
	const moved = describePrPreview({ number: 7, files: [], exists: true, moved: true, hasEdits: true });
	assert.equal(previewWords({ preview: { kind: 'pr', number: 7, paths: [] }, pr: moved }).action, 'Return to saved copy');
});

test('a step says its name, and a skipped one says why it was skipped', () => {
	const steps = [
		{ key: 'apply', label: 'Apply the patch' },
		{ key: 'install', label: 'Install dependencies', skipMessage: 'No dependency changes' },
		{ key: 'build', label: 'Rebuild' }
	];
	assert.deepEqual(applyStepRows(steps, [{ status: 'complete' }, { status: 'skipped' }, { status: 'current' }]), [
		{ key: 'apply', label: 'Apply the patch', status: 'complete' },
		{ key: 'install', label: 'No dependency changes', status: 'skipped' },
		{ key: 'build', label: 'Rebuild', status: 'current' }
	]);
	// A step nothing is said of is still to come, and a skipped step with
	// no reason keeps its name.
	assert.deepEqual(applyStepRows(steps, []).map((row) => row.status), ['pending', 'pending', 'pending']);
	assert.equal(applyStepRows([{ key: 'build', label: 'Rebuild' }], [{ status: 'skipped' }])[0].label, 'Rebuild');
	assert.deepEqual(applyStepRows(), []);
});

test('a failed patch file says what went wrong, ended as a sentence, and that nothing was changed', () => {
	assert.deepEqual(applyFailureWords({ error: 'The patch does not fit', kind: 'patch' }), { headline: 'The patch does not fit.', untouched: 'The checkout was not changed.' });
	assert.equal(applyFailureWords({ error: 'Already a sentence.', kind: 'patch' }).headline, 'Already a sentence.');
	assert.equal(applyFailureWords({ error: '  Why?  ', kind: 'patch' }).headline, 'Why?');
});

test('a breakdown\'s headline replaces the sentence it says in counts', () => {
	assert.equal(applyFailureWords({ error: 'The patch does not fit', conflict: { headline: '2 of 5 changes could not be applied.' }, kind: 'patch' }).headline, '2 of 5 changes could not be applied.');
	// A breakdown with no headline of its own leaves the sentence.
	assert.equal(applyFailureWords({ error: 'The patch does not fit', conflict: {}, kind: 'patch' }).headline, 'The patch does not fit.');
});

test('a failed pull request does not say the checkout was left alone', () => {
	assert.deepEqual(applyFailureWords({ error: 'Could not switch', kind: 'pr' }), { headline: 'Could not switch.', untouched: '' });
	assert.deepEqual(applyFailureWords(), { headline: '', untouched: '' });
});

test('a file of the breakdown says how many of its changes failed, and where each is', () => {
	const rows = conflictFileRows({
		path: 'src/wp-login.php',
		failed: 2,
		total: 3,
		regions: [
			{ index: 0, anchor: 'function wp_login() {', line: 12, reason: 'the lines around it have changed', lines: ['-old', '+new'], more: 0 },
			{ index: 1, anchor: '', line: 40, reason: 'already applied', lines: [], more: 4 }
		]
	});
	assert.equal(rows.heading, 'src/wp-login.php — 2 of 3 changes');
	assert.deepEqual(rows.regions, [
		{ key: 0, anchor: 'function wp_login() {', where: '', reason: 'the lines around it have changed', lines: '-old\n+new', more: '' },
		{ key: 1, anchor: '', where: 'line 40 of the patch', reason: 'already applied', lines: '', more: '… 4 more lines' }
	]);
});

test('one change is "change" and one more line is "line"', () => {
	assert.equal(conflictFileRows({ path: 'a.php', failed: 1, total: 1, regions: [] }).heading, 'a.php — 1 of 1 change');
	assert.equal(conflictFileRows({ path: 'a.php', failed: 1, total: 1, regions: [{ index: 0, line: 1, more: 1 }] }).regions[0].more, '… 1 more line');
	assert.deepEqual(conflictFileRows({ path: 'a.php', failed: 1, total: 2 }).regions, []);
});

test('a checked-out pull request is green only once the site is built around it (issue #509)', () => {
	assert.equal(checkoutNoticeIntent('ready'), 'success');
	assert.equal(checkoutNoticeIntent('building'), 'warning');
	assert.equal(checkoutNoticeIntent('unbuilt'), 'error');
	assert.equal(checkoutNoticeIntent(undefined), 'success');
});
