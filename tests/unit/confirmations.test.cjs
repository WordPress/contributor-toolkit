'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
	initialConfirmations,
	confirmationReducer,
	prConfirmationMessage,
	deleteFailureMessage,
	setupFailureMessage,
	setupStatusLine,
	setupEndMessage,
	copyButtonLabel,
	applyDoneMessage,
	patchSavedMessage,
	savedAndResetMessage,
	toastView,
	MAX_NOTICES,
	TOAST_LIFETIME_MS
} = require('../../src/renderer/confirmations.cjs');

test('a success confirmation speaks politely and clears itself (issue #253)', () => {
	const state = confirmationReducer(initialConfirmations, { type: 'add', content: 'Patch saved to my.patch' });

	assert.strictEqual(state.notices.length, 1);
	const [notice] = state.notices;
	assert.strictEqual(notice.content, 'Patch saved to my.patch');
	assert.strictEqual(notice.tone, 'success');
	assert.strictEqual(notice.politeness, 'polite', 'a confirmation must not interrupt the screen reader');
	assert.strictEqual(notice.explicitDismiss, false, 'a success must auto-dismiss');
});

test('the tone defaults to success when none is given', () => {
	const state = confirmationReducer(initialConfirmations, { type: 'add', content: 'Reverted' });

	assert.strictEqual(state.notices[0].tone, 'success');
});

test('an error confirmation speaks assertively and stays until dismissed (issue #253)', () => {
	const state = confirmationReducer(initialConfirmations, { type: 'add', content: 'Could not save', tone: 'error' });

	const [notice] = state.notices;
	assert.strictEqual(notice.tone, 'error');
	assert.strictEqual(notice.politeness, 'assertive', 'an error must be read out at once');
	assert.strictEqual(notice.explicitDismiss, true, 'an error must not vanish before it is read');
});

test('every confirmation gets a distinct id from a running counter', () => {
	let state = confirmationReducer(initialConfirmations, { type: 'add', content: 'First' });
	state = confirmationReducer(state, { type: 'add', content: 'Second' });

	assert.deepStrictEqual(state.notices.map((n) => n.id), [1, 2]);
});

test('a repeat of the confirmation already on top is ignored', () => {
	let state = confirmationReducer(initialConfirmations, { type: 'add', content: 'Up to date with trunk' });
	state = confirmationReducer(state, { type: 'add', content: 'Up to date with trunk' });

	assert.strictEqual(state.notices.length, 1, 'a double-click reads as one confirmation');
});

test('the same message with a different tone is not treated as a duplicate', () => {
	let state = confirmationReducer(initialConfirmations, { type: 'add', content: 'Saved' });
	state = confirmationReducer(state, { type: 'add', content: 'Saved', tone: 'error' });

	assert.strictEqual(state.notices.length, 2);
});

test('an empty message queues nothing', () => {
	const state = confirmationReducer(initialConfirmations, { type: 'add', content: '' });

	assert.strictEqual(state, initialConfirmations, 'the state is handed back untouched');
});

test('only the most recent confirmations are kept when a burst arrives', () => {
	let state = initialConfirmations;
	for (let i = 1; i <= MAX_NOTICES + 2; i += 1) {
		state = confirmationReducer(state, { type: 'add', content: `Step ${i}` });
	}

	assert.strictEqual(state.notices.length, MAX_NOTICES);
	assert.strictEqual(state.notices[0].content, `Step ${3}`, 'the oldest ones drop off the front');
	assert.strictEqual(state.notices[state.notices.length - 1].content, `Step ${MAX_NOTICES + 2}`);
});

test('removing a confirmation by id drops just that one', () => {
	let state = confirmationReducer(initialConfirmations, { type: 'add', content: 'First' });
	state = confirmationReducer(state, { type: 'add', content: 'Second' });
	state = confirmationReducer(state, { type: 'remove', id: 1 });

	assert.deepStrictEqual(state.notices.map((n) => n.content), ['Second']);
});

test('removing an id that matches nothing returns the same state object', () => {
	const state = confirmationReducer(initialConfirmations, { type: 'add', content: 'First' });
	const after = confirmationReducer(state, { type: 'remove', id: 999 });

	assert.strictEqual(after, state, 'no needless re-render for a no-op removal');
});

test('an opened pull request is confirmed by its number, and by the repository its URL names (issue #253, #251)', () => {
	assert.strictEqual(
		prConfirmationMessage({ ok: true, number: 42 }),
		'Opened pull request #42'
	);
	assert.strictEqual(
		prConfirmationMessage({ ok: true, number: 42, url: 'https://github.com/WordPress/gutenberg/pull/42' }),
		'Opened pull request #42 on WordPress/gutenberg'
	);
	// Where it actually went, not where the site's type says it goes: a
	// sandbox run lands elsewhere and the toast has to say so.
	assert.strictEqual(
		prConfirmationMessage({ ok: true, number: 1, url: 'https://github.com/sandbox-org/pr-sandbox/pull/1' }),
		'Opened pull request #1 on sandbox-org/pr-sandbox'
	);
});

test('a dry run says no pull request was opened rather than "#undefined" (issue #253)', () => {
	assert.strictEqual(
		prConfirmationMessage({ ok: true, dryRun: true, branch: 'fix/thing' }),
		'Dry run — branch created, no pull request opened'
	);
});

test('a failed deletion says the listed site can be retried and names the code (#414)', () => {
	assert.strictEqual(
		deleteFailureMessage({ ok: false, reason: 'remove-failed', path: '/sites/demo', code: 'EPERM' }),
		'The site is still listed because its folder could not be deleted (EPERM). Close anything using it, then try again. Folder: /sites/demo'
	);
});

test('a deletion failure without a code still reads as a sentence (#414)', () => {
	assert.strictEqual(
		deleteFailureMessage({ ok: false, reason: 'remove-failed', path: '/sites/demo' }),
		'The site is still listed because its folder could not be deleted. Close anything using it, then try again. Folder: /sites/demo'
	);
});

test('a clean deletion, a refusal, and a malformed result all stay silent (issue #381)', () => {
	assert.strictEqual(deleteFailureMessage({ ok: true }), null);
	assert.strictEqual(deleteFailureMessage({ ok: false, refused: true }), null);
	assert.strictEqual(deleteFailureMessage({}), null);
	assert.strictEqual(deleteFailureMessage(), null);
});

test('a site that could not be set up says so, and what went wrong as it was reported (#557)', () => {
	assert.strictEqual(setupFailureMessage(new Error('the clone could not reach the network')), 'The site could not be created. Error: the clone could not reach the network');
	assert.strictEqual(setupFailureMessage('ENOSPC'), 'The site could not be created. ENOSPC');
	// A percent sign in what was reported is said as it is.
	assert.strictEqual(setupFailureMessage('100% of the disk is used'), 'The site could not be created. 100% of the disk is used');
});

test('each thing the apply flow can have done is confirmed in a sentence of its own', () => {
	assert.strictEqual(applyDoneMessage('Applied', 'patch'), 'Applied the patch');
	assert.strictEqual(applyDoneMessage('Reverted', 'patch'), 'Reverted the patch');
	assert.strictEqual(applyDoneMessage('Checked out', 'pull request'), 'Checked out the pull request');
	assert.strictEqual(applyDoneMessage('Restored', 'previous branch'), 'Restored the previous branch');
	assert.strictEqual(applyDoneMessage('Restored', 'saved work'), 'Restored the saved work');
});

test('a pair it has no sentence for is still confirmed, in a word that splices nothing in', () => {
	assert.strictEqual(applyDoneMessage('Rebuilt', 'site'), 'Done');
});

test('a saved patch and edits saved before an update are confirmed by the file\'s name', () => {
	assert.strictEqual(patchSavedMessage('60001.diff'), 'Patch saved to 60001.diff');
	assert.strictEqual(savedAndResetMessage('my-edits.patch'), 'Saved your changes to my-edits.patch and reset the working tree');
	assert.strictEqual(patchSavedMessage('100%.diff'), 'Patch saved to 100%.diff');
});

test('a confirmation is a green toast that clears itself, and an error a red one that stays (#557)', () => {
	const added = (tone) => confirmationReducer(initialConfirmations, { type: 'add', content: 'x', tone }).notices[0];
	assert.deepStrictEqual(toastView(added('success')), { intent: 'success', lifetime: TOAST_LIFETIME_MS });
	assert.deepStrictEqual(toastView(added('error')), { intent: 'error', lifetime: null });
	assert.deepStrictEqual(toastView(added(undefined)), { intent: 'success', lifetime: TOAST_LIFETIME_MS });
	// As long as the snackbars before it stayed: long enough to be read, and
	// not so long as to pile up.
	assert.strictEqual(TOAST_LIFETIME_MS, 6000);
});

test('every sentence this module words goes through the translator, around what it names', (t) => {
	const i18n = require('@wordpress/i18n');
	t.after(() => i18n.resetLocaleData());
	i18n.setLocaleData({
		'Applied the patch': ['T applied'],
		'Reverted the patch': ['T reverted'],
		'Checked out the pull request': ['T checked out'],
		'Restored the previous branch': ['T restored branch'],
		'Restored the saved work': ['T restored work'],
		'an action that finished\u0004Done': ['T done'],
		'Patch saved to %s': ['T saved %s'],
		'Saved your changes to %s and reset the working tree': ['T reset %s'],
		'The site could not be created. %s': ['T not created: %s'],
		'Dry run — branch created, no pull request opened': ['T dry run'],
		'Opened pull request #%s': ['T opened %s'],
		'Opened pull request #%1$s on %2$s': ['T opened %1$s at %2$s'],
		'The site is still listed because its folder could not be deleted (%1$s). Close anything using it, then try again. Folder: %2$s': ['T kept %2$s (%1$s)'],
		'The site is still listed because its folder could not be deleted. Close anything using it, then try again. Folder: %s': ['T kept %s']
	});
	assert.deepStrictEqual([
		applyDoneMessage('Applied', 'patch'),
		applyDoneMessage('Reverted', 'patch'),
		applyDoneMessage('Checked out', 'pull request'),
		applyDoneMessage('Restored', 'previous branch'),
		applyDoneMessage('Restored', 'saved work'),
		applyDoneMessage('Rebuilt', 'site'),
		patchSavedMessage('a.diff'),
		savedAndResetMessage('a.patch'),
		setupFailureMessage('ENOSPC'),
		prConfirmationMessage({ dryRun: true }),
		prConfirmationMessage({ number: 9 }),
		prConfirmationMessage({ number: 9, url: 'https://github.com/WordPress/gutenberg/pull/9' }),
		deleteFailureMessage({ ok: false, reason: 'remove-failed', path: '/sites/demo', code: 'EBUSY' }),
		deleteFailureMessage({ ok: false, reason: 'remove-failed', path: '/sites/demo' })
	], [
		'T applied', 'T reverted', 'T checked out', 'T restored branch', 'T restored work', 'T done',
		'T saved a.diff', 'T reset a.patch', 'T not created: ENOSPC',
		'T dry run', 'T opened 9', 'T opened 9 at WordPress/gutenberg',
		'T kept /sites/demo (EBUSY)', 'T kept /sites/demo'
	]);
});

// What the setup log, the end of the setup chain and a Copy button say, moved
// out of index.jsx so they can be reached here (#627).
test('the setup lines and the Copy label keep their English and are translated when they are said (#627)', (t) => {
	assert.strictEqual(setupStatusLine('cloning'), 'Status: cloning');
	assert.strictEqual(setupStatusLine('done'), 'Status: done');
	assert.strictEqual(setupStatusLine(undefined), 'Status update');
	assert.strictEqual(setupEndMessage('failed-install'), 'npm install failed — setup stopped here. Its output is above; retry the install from the checklist.');
	assert.strictEqual(setupEndMessage('something-new'), '');
	assert.strictEqual(copyButtonLabel('copied'), 'Copied');
	assert.strictEqual(copyButtonLabel(''), 'Copy');

	const { addFilter, removeFilter } = require('@wordpress/hooks');
	const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => removeFilter('i18n.gettext', 'test/pseudo-locale'));
	assert.strictEqual(setupStatusLine('cloning'), pseudoLocalize('Status: cloning'));
	assert.strictEqual(setupEndMessage('stopped'), pseudoLocalize('Setup stopped. The remaining steps are in the checklist above — run them whenever you are ready.'));
	assert.strictEqual(copyButtonLabel('failed'), pseudoLocalize('Could not copy'));
});
