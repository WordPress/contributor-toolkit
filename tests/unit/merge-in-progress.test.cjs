'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { mergeInProgressNotice, mergeInProgressError, mergeCheckFailedError } = require('../../src/renderer/merge-in-progress.cjs');
const { addFilter, removeFilter } = require('@wordpress/hooks');
const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');

test('mergeInProgressNotice names the operation, the files and both ways out (#352)', () => {
	const notice = mergeInProgressNotice({ mergeInProgress: { kind: 'merge', paths: ['src/wp-login.php', 'src/doomed.php'] } });
	assert.equal(notice.title, 'A merge started outside the app is in progress.');
	assert.match(notice.body, /conflicts in src\/wp-login\.php and src\/doomed\.php\./);
	assert.match(notice.body, /Finish it from a terminal \(resolve the files, then git add them and run git commit\)/);
	assert.match(notice.body, /abandon it \(git merge --abort\)/);
	assert.match(notice.body, /linking tickets, applying patches, discarding changes and updating trunk are refused/);
});

test('mergeInProgressNotice words each kind with its own commands (#352)', () => {
	const cases = [
		['rebase', 'A rebase', 'git rebase --continue', 'git rebase --abort'],
		['cherry-pick', 'A cherry-pick', 'git cherry-pick --continue', 'git cherry-pick --abort'],
		['revert', 'A revert', 'git revert --continue', 'git revert --abort'],
		['apply', 'A three-way patch apply', 'git add them', 'git restore --staged --worktree']
	];
	for (const [kind, name, finish, abandon] of cases) {
		const notice = mergeInProgressNotice({ mergeInProgress: { kind, paths: ['a.php'] } });
		assert.ok(notice.title.startsWith(name), kind);
		assert.ok(notice.body.includes(finish), `${kind}: ${notice.body}`);
		assert.ok(notice.body.includes(abandon), kind);
	}
	// A kind this module has no words for is still a refusal, worded as a merge.
	assert.match(mergeInProgressNotice({ mergeInProgress: { kind: 'bisect', paths: ['a.php'] } }).body, /git merge --abort/);
});

test('a merge resolved in an editor but not committed is still in progress, with the finishing step alone (#352)', () => {
	const notice = mergeInProgressNotice({ mergeInProgress: { kind: 'merge', paths: [] } });
	assert.match(notice.body, /^Its conflicts are resolved but it is not finished\. Finish it from a terminal \(git commit\) or abandon it \(git merge --abort\)/);
	assert.doesNotMatch(notice.body, /conflicts in/);
});

test('the file list is capped, and one file reads as one (#352)', () => {
	const many = mergeInProgressNotice({ mergeInProgress: { kind: 'merge', paths: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } });
	assert.match(many.body, /conflicts in a, b, c, d, e and 2 more files\./);
	const six = mergeInProgressNotice({ mergeInProgress: { kind: 'merge', paths: ['a', 'b', 'c', 'd', 'e', 'f'] } });
	assert.match(six.body, /and 1 more file\./);
	assert.match(mergeInProgressNotice({ mergeInProgress: { kind: 'merge', paths: ['only.php'] } }).body, /conflicts in only\.php\./);
});

test('mergeInProgressNotice stays silent for every other checkout (#352)', () => {
	assert.equal(mergeInProgressNotice({ mergeInProgress: null }), null);
	assert.equal(mergeInProgressNotice({}), null);
	assert.equal(mergeInProgressNotice(), null);
});

test('the refusal main returns is the notice as one sentence, with no em dash (#352)', () => {
	const state = { kind: 'merge', paths: ['src/wp-login.php'] };
	const notice = mergeInProgressNotice({ mergeInProgress: state });
	assert.equal(mergeInProgressError(state), `${notice.title} ${notice.body}`);
	assert.doesNotMatch(mergeInProgressError(state), /—/);
});

test('a read that failed refuses the write and says nothing changed (#352)', () => {
	const error = mergeCheckFailedError(new Error('index.lock exists'));
	assert.match(error, /could not check whether a merge is in progress/);
	assert.match(error, /nothing was changed/);
	assert.match(error, /\(index\.lock exists\)$/);
	assert.doesNotMatch(mergeCheckFailedError(null), /\(/);
});

// Main returns this refusal, so it is said in the locale main applied: the
// title for the kind, the file count's plural, and Git's commands as they are.
test('the refusal is said in the locale applied, with Git\'s commands left as they are (#629)', (t) => {
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	addFilter('i18n.ngettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => {
		removeFilter('i18n.gettext', 'test/pseudo-locale');
		removeFilter('i18n.ngettext', 'test/pseudo-locale');
	});

	const state = { kind: 'apply', paths: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] };
	const notice = mergeInProgressNotice({ mergeInProgress: state });
	assert.equal(notice.title, pseudoLocalize('A three-way patch apply started outside the app is in progress.'));
	const body = pseudoLocalize('It has conflicts in %1$s. Finish it from a terminal (%2$s) or abandon it (%3$s) before using the app on this site. Until then, linking tickets, applying patches, discarding changes and updating trunk are refused here.')
		.replace('%1$s', pseudoLocalize('%1$s and %2$d more files').replace('%1$s', 'a, b, c, d, e').replace('%2$d', '2'))
		.replace('%2$s', pseudoLocalize('resolve the files, then git add them'))
		.replace('%3$s', `git restore --staged --worktree -- <${pseudoLocalize('every file the patch touched, not only the ones in conflict')}>`);
	assert.equal(notice.body, body);
	assert.equal(mergeInProgressError(state), `${notice.title} ${notice.body}`);
	assert.equal(mergeCheckFailedError(new Error('index.lock exists')), pseudoLocalize('The app could not check whether a merge is in progress in this checkout, so nothing was changed. If a Git command is running in it from a terminal, let it finish, then try again. (%s)').replace('%s', 'index.lock exists'));
});
