'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { describePrCheckout, describePrPreview, prSubmissionRefusal, prCheckoutRefusal } = require('../../src/renderer/pr-checkout.cjs');

test('the dirty-trunk PR retry publishes only the callback from a committed render (#458)', () => {
	const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'index.jsx'), 'utf8');
	const assignment = 'retryPrSwitchRef.current = runPrSwitch;';
	assert.equal(source.split(assignment).length - 1, 1, 'expected one retry callback assignment');
	const committedEffect = [...source.matchAll(/useLayoutEffect\(\(\) => \{([\s\S]*?)\n  \}\);/g)]
		.find((match) => match[1].includes(assignment));
	assert.ok(committedEffect, 'retry callback assignment must run in a layout effect, after React commits the render');
});
const rendererSource = fs.readFileSync(path.join(__dirname, '../../src/renderer/index.jsx'), 'utf8');

test('PR checkout names the return ticket and explains where edits stay', () => {
	const result = describePrCheckout({ number: 7, returnTo: 'ticket/62010', hasEdits: true });
	assert.equal(result.title, 'PR #7 is applied.');
	assert.equal(result.backLabel, 'Revert this PR');
	assert.equal(result.body, 'Your ticket changes are saved separately and return when you revert this PR.');
	assert.match(result.edits, /stay with your local copy of the PR/);
});

test('a PR tried from trunk names trunk and has no edits notice', () => {
	const result = describePrCheckout({ number: 7, returnTo: 'trunk' });
	assert.equal(result.title, 'PR #7 is applied.');
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

test('the active PR is one site-level context instead of duplicated Apply-panel actions', () => {
	assert.equal(rendererSource.match(/runPrSwitch\(\{ leaving: true \}\)/g)?.length, 1);
	assert.ok(rendererSource.indexOf("cueProps('link-ticket')") < rendererSource.indexOf("cueProps('pr-checkout')"));
	assert.ok(rendererSource.indexOf("cueProps('pr-checkout')") < rendererSource.indexOf('>Linked pull requests<'));
	assert.match(rendererSource, />Apply PR<\/Button>/);
	assert.doesNotMatch(rendererSource, /Apply a patch file on top of PR #/);
});
