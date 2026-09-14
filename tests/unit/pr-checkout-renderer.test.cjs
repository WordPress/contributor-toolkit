'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { describePrCheckout, prSubmissionRefusal, prCheckoutRefusal } = require('../../src/renderer/pr-checkout.cjs');

test('PR checkout names the return ticket and explains where edits stay', () => {
	const result = describePrCheckout({ number: 7, returnTo: 'ticket/62010', hasEdits: true });
	assert.equal(result.title, 'PR #7 is checked out.');
	assert.equal(result.backLabel, 'Back to ticket #62010');
	assert.match(result.body, /work on ticket #62010 is parked/);
	assert.match(result.edits, /stay on this pull request's copy/);
});

test('a PR tried from trunk names trunk and has no edits notice', () => {
	const result = describePrCheckout({ number: 7, returnTo: 'trunk' });
	assert.equal(result.backLabel, 'Back to trunk');
	assert.match(result.body, /Go back to trunk/);
	assert.equal(result.edits, '');
});

test('submission refusal explains ownership and how to get back to your work', () => {
	assert.match(prSubmissionRefusal(7), /PR #7.*author's commits.*Go back to your ticket/);
});

for (const [code, sentence] of [
	['pr-has-edits', /PR #7.*edits.*Discard/],
	['pr-branch-exists', /pr\/7.*did not make.*terminal/],
	['already-checked-out', /PR #7.*Go back first/],
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
