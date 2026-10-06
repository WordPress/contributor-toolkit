'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describePrCheckout, describePrPreview, prSubmissionRefusal, prSubmissionBlocked, prCheckoutRefusal } = require('../../src/renderer/pr-checkout.cjs');

test('PR checkout names the return ticket and explains where edits stay', () => {
	const result = describePrCheckout({ returnTo: 'ticket/62010', hasEdits: true });
	assert.equal(result.backLabel, 'Revert this PR');
	assert.equal(result.body, 'Your ticket changes are saved separately and return when you revert this PR.');
	assert.match(result.edits, /stay with your local copy of the PR/);
});

test('a PR tried from trunk names trunk and has no edits notice', () => {
	const result = describePrCheckout({ returnTo: 'trunk' });
	assert.equal(result.backLabel, 'Revert this PR');
	assert.match(result.body, /returns to trunk/);
	assert.match(result.edits, /stay with your local copy of the PR/);
});

test('submission refusal explains ownership and how to get back to your work', () => {
	assert.match(prSubmissionRefusal(7, 'ticket/62010'), /PR #7.*author's commits.*Revert this PR/);
});

test('submission refusal does not invent a ticket when the PR came from trunk', () => {
	assert.match(prSubmissionRefusal(7, 'trunk'), /Revert this PR/);
	assert.doesNotMatch(prSubmissionRefusal(7, 'trunk'), /your ticket/);
});

test('the pull request card submits a checkout that is all the contributor\'s own', () => {
	assert.equal(prSubmissionBlocked({ pullRequest: null, appliedPatch: null, appliedPatchLabel: '' }), '');
});

test('an applied patch blocks the pull request card, named the way the app names it', () => {
	assert.equal(
		prSubmissionBlocked({ pullRequest: null, appliedPatch: { label: '62010.diff' }, appliedPatchLabel: '62010.diff' }),
		'Revert 62010.diff before opening a pull request from this checkout.'
	);
});

test('an applied patch with no name blocks the card in a sentence of its own, not one with a phrase put in', () => {
	assert.equal(
		prSubmissionBlocked({ pullRequest: null, appliedPatch: {}, appliedPatchLabel: '' }),
		'Revert the patch you applied before opening a pull request from this checkout.'
	);
});

test('a checked-out pull request blocks the card with its own refusal, ahead of a patch applied on top', () => {
	const refusal = prSubmissionRefusal(7);
	assert.equal(prSubmissionBlocked({ pullRequest: { number: 7 }, appliedPatch: null, appliedPatchLabel: '' }), refusal);
	assert.equal(prSubmissionBlocked({ pullRequest: { number: 7 }, appliedPatch: { label: '62010.diff' }, appliedPatchLabel: '62010.diff' }), refusal);
});

for (const [code, sentence] of [
	['pr-has-edits', /PR #7.*edits.*Discard/],
	['pr-branch-exists', /pr\/7.*did not make.*terminal/],
	['already-checked-out', /PR #7.*Revert it/],
	['bad-pr-number', /positive whole/],
	['not-on-pr', /No pull request/],
	['no-pr-head', /cannot safely save.*Save a patch/]
]) {
	test(`PR refusal explains ${code}`, () => {
		assert.match(prCheckoutRefusal({ code, number: 7 }), sentence);
	});
}

test('guard and Git errors keep their diagnostic sentence', () => {
	assert.equal(prCheckoutRefusal({ code: 'merge-in-progress', error: 'Finish the merge.' }), 'Finish the merge.');
	assert.match(prCheckoutRefusal({}), /Check the log/);
});

test('PR preview names its files and the install the checkout needs', () => {
	const result = describePrPreview({ number: 7, files: [{ path: 'a.php' }, { path: 'b.php' }], needsInstall: true });
	assert.equal(result.headline, 'PR #7 changes 2 files.');
	assert.match(result.installNote, /package-lock\.json.*installed/);
});

test('PR preview distinguishes a saved copy, a moved head and edits on the old head', () => {
	assert.match(describePrPreview({ number: 7, exists: true }).headline, /already on this site.*local copy/);
	assert.match(describePrPreview({ number: 7, exists: true, moved: true }).headline, /moved on GitHub.*will be updated/);
	const edited = describePrPreview({ number: 7, exists: true, moved: true, hasEdits: true });
	assert.match(edited.headline, /moved on GitHub.*edits on top/);
	assert.equal(edited.actionLabel, 'Return to saved copy');
});

test('a closed PR is still available for investigation', () => {
	assert.match(describePrPreview({ number: 7, state: 'closed' }).closedNote, /closed.*still check out/);
	assert.equal(describePrPreview({ number: 7, state: 'open' }).closedNote, '');
});

// A Gutenberg site returns to an issue/ branch (#251): the box must say the
// work is kept, not that reverting goes to trunk, and call it an issue.
test('a PR checked out from an issue branch says the issue work returns on revert', () => {
	const result = describePrCheckout({ returnTo: 'issue/71234', noun: 'issue' });
	assert.equal(result.body, 'Your issue changes are saved separately and return when you revert this PR.');
	assert.doesNotMatch(result.body, /trunk/);
	// The namespace alone is not enough to change the noun; a site says it.
	assert.match(describePrCheckout({ returnTo: 'issue/71234' }).body, /Your ticket changes/);
});

// Main words a refusal with these too, for the terminal and the done event,
// so they are read here rather than through a journey, which stubs main.
test('a checkout\'s sentences are said in the locale: one per kind of work item, and the plural by count (#628)', (t) => {
	const { addFilter, removeFilter } = require('@wordpress/hooks');
	const { sprintf } = require('@wordpress/i18n');
	const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	addFilter('i18n.ngettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => {
		removeFilter('i18n.gettext', 'test/pseudo-locale');
		removeFilter('i18n.ngettext', 'test/pseudo-locale');
	});
	const pseudo = (format, ...args) => sprintf(pseudoLocalize(format), ...args);

	assert.deepEqual(describePrCheckout({ returnTo: 'issue/71234', noun: 'issue' }), {
		body: pseudoLocalize('Your issue changes are saved separately and return when you revert this PR.'),
		edits: pseudoLocalize('Edits you make here stay with your local copy of the PR.'),
		backLabel: pseudoLocalize('Revert this PR')
	});
	assert.equal(describePrCheckout({ returnTo: 'ticket/1', noun: 'ticket' }).body, pseudoLocalize('Your ticket changes are saved separately and return when you revert this PR.'));
	assert.equal(prCheckoutRefusal({ code: 'pr-branch-exists', number: 7 }), pseudo('This site already has a branch named pr/%d that the app did not make. Rename or delete that branch from a terminal before trying again.', 7));
	assert.equal(prCheckoutRefusal({}), pseudoLocalize('Could not switch this pull request. Check the log and try again.'));
	// An error main already worded comes back as it is.
	assert.equal(prCheckoutRefusal({ code: 'merge-in-progress', error: 'worded in main' }), 'worded in main');

	const preview = describePrPreview({ number: 7, files: [{ path: 'a.php' }, { path: 'b.php' }], needsInstall: true, state: 'closed' });
	assert.equal(preview.headline, pseudo('PR #%1$d changes %2$d files.', 7, 2));
	assert.equal(preview.installNote, pseudoLocalize('It changes package-lock.json, so dependencies will be installed before the rebuild.'));
	assert.equal(describePrPreview({ number: 7, files: [{ path: 'a.php' }] }).headline, pseudo('PR #%1$d changes %2$d file.', 7, 1));
	assert.equal(describePrPreview({ number: 7, exists: true, moved: true, hasEdits: true }).actionLabel, pseudoLocalize('Return to saved copy'));
});
