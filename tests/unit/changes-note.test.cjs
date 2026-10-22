// The changes note's words and placement, and the discard guards. All the
// branching lives in changes-note.cjs so this suite can reach it without a
// DOM; index.jsx only fills in the sentence's two link buttons, or draws the
// card's notice from its parts.
const test = require('node:test');
const assert = require('node:assert/strict');

const {
	changesNoteParts,
	discardLabel,
	discardOutcome,
	noteAfterDiscard,
	noteAfterProbe,
	discardBlocked,
	discardDisabledReason,
	discardQuestion,
	discardYourChangesQuestion,
	ownEditCount,
	discardToast
} = require('../../src/renderer/changes-note.cjs');
const { WORK_ITEM_BRANCH_PREFIXES } = require('../../src/ticket-branches.js');

test('changesNoteParts says nothing about a clean tree', () => {
	assert.equal(changesNoteParts({ dirty: false, changedCount: 0, tracTicket: null }), null);
	assert.equal(changesNoteParts({ dirty: false, changedCount: 3, tracTicket: '12345' }), null);
	assert.equal(changesNoteParts({}), null);
	assert.equal(changesNoteParts(), null);
});

// The sentence carries its two links as markup the component fills in; the
// words a reader sees are the sentence with the tags taken out.
const plain = (sentence) => sentence.replace(/<\/?(?:review|discard)>/g, '');

test('changesNoteParts places an unticketed note by the buttons', () => {
	const parts = changesNoteParts({ dirty: true, changedCount: 3, tracTicket: null });
	assert.equal(parts.placement, 'buttons');
	assert.equal(parts.sentence, 'You have 3 changes not assigned to any ticket. You can <review>create and save a patch</review> or <discard>discard your changes</discard>.');
});

test('changesNoteParts places a ticketed note in the ticket card and names the ticket', () => {
	const parts = changesNoteParts({ dirty: true, changedCount: 3, tracTicket: '12345' });
	assert.equal(parts.placement, 'ticket');
	assert.equal(parts.title, '3 unsubmitted changes for ticket #12345');
	assert.equal(parts.review, 'Review and submit');
});

test('changesNoteParts attributes work on a PR checkout to the PR, not the linked ticket', () => {
	const parts = changesNoteParts({ dirty: true, changedCount: 2, tracTicket: '12345', pullRequest: { number: 7701 } });
	assert.equal(parts.placement, 'ticket');
	assert.equal(parts.title, '2 changes on top of PR #7701');
	assert.equal(parts.body, 'They stay with this pull request\'s local copy when you revert this PR.');
	assert.equal(parts.review, 'Review changes');
	assert.doesNotMatch(parts.body, /Unlinking/, 'a PR\'s changes are not the ticket\'s to keep');
	assert.equal(changesNoteParts({ dirty: true, changedCount: 1, tracTicket: '12345', pullRequest: { number: 7701 } }).title, '1 change on top of PR #7701');
	assert.equal(changesNoteParts({ dirty: true, tracTicket: '12345', pullRequest: { number: 7701 } }).title, 'Changes on top of PR #7701');
	// Reached from trunk, the same work is news for the buttons, as a sentence.
	assert.equal(
		plain(changesNoteParts({ dirty: true, changedCount: 1, pullRequest: { number: 7701, returnTo: 'trunk' } }).sentence),
		'You have 1 change on top of PR #7701. You can review them or discard your changes. They stay with this pull request\'s local copy when you revert this PR.'
	);
});

// The note's regex cannot import the list (ticket-branches.js reaches for
// Git), so this walks the list against it: a namespace the app writes that the
// note did not know would leave a Gutenberg site's changes by the buttons
// instead of in its work-item card.
test('changesNoteParts places a PR that returns to any work-item namespace in the card (#251)', () => {
	for (const prefix of WORK_ITEM_BRANCH_PREFIXES) {
		const parts = changesNoteParts({ dirty: true, changedCount: 1, tracTicket: '71234', pullRequest: { number: 7701, returnTo: `${prefix}71234` } });
		assert.equal(parts.placement, 'ticket', `${prefix}: a PR returning there belongs to the card`);
	}
});

test('changesNoteParts keeps work on a PR reached from trunk visible by the site controls', () => {
	const parts = changesNoteParts({ dirty: true, changedCount: 1, pullRequest: { number: 7701, returnTo: 'trunk' } });
	assert.equal(parts.placement, 'buttons');
	assert.match(parts.sentence, /when you revert this PR\.$/);
	assert.doesNotMatch(parts.sentence, /ticket/);
});

test('changesNoteParts follows a PR return redirected to trunk even while the old ticket is linked', () => {
	const parts = changesNoteParts({ dirty: true, changedCount: 1, tracTicket: '12345', pullRequest: { number: 7701, returnTo: 'trunk' } });
	assert.equal(parts.placement, 'buttons');
	assert.match(parts.sentence, /when you revert this PR\.$/);
	assert.doesNotMatch(parts.sentence, /your ticket/);
});

test('changesNoteParts names the modal in the ticket card and the patch by the buttons', () => {
	// The ticket sentence already says where the changes go, so its link
	// borrows the modal's own name; by the buttons the link says what it
	// produces instead.
	assert.equal(changesNoteParts({ dirty: true, tracTicket: '12345' }).review, 'Review and submit');
	assert.match(changesNoteParts({ dirty: true, tracTicket: null }).sentence, /<review>create and save a patch<\/review>/);
});

test('changesNoteParts reassures about Unlink only where Unlink is', () => {
	const ticket = changesNoteParts({ dirty: true, changedCount: 1, tracTicket: '12345' });
	assert.equal(
		ticket.body,
		'Unlinking this ticket doesn\'t affect your local changes for this ticket — they remain attached to it in this site, ready for when you link it again.'
	);
	assert.equal(changesNoteParts({ dirty: true, changedCount: 1, tracTicket: null }).body, undefined);
});

test('changesNoteParts uses the singular for one change', () => {
	assert.equal(
		plain(changesNoteParts({ dirty: true, changedCount: 1, tracTicket: null }).sentence),
		'You have 1 change not assigned to any ticket. You can create and save a patch or discard your changes.'
	);
	assert.equal(changesNoteParts({ dirty: true, changedCount: 1, tracTicket: '12345' }).title, '1 unsubmitted change for ticket #12345');
});

test('changesNoteParts stays true when the count is missing', () => {
	// A dirty answer can arrive without a usable count; "changes" is still
	// accurate where "0 changes" would be a lie next to a discard link.
	for (const changedCount of [undefined, 0, -1, 2.5]) {
		assert.equal(
			plain(changesNoteParts({ dirty: true, changedCount, tracTicket: null }).sentence),
			'You have changes not assigned to any ticket. You can create and save a patch or discard your changes.'
		);
	}
	assert.equal(changesNoteParts({ dirty: true, tracTicket: '12345' }).title, 'Unsubmitted changes for ticket #12345');
});

test('changesNoteParts always offers a discard, in the same words', () => {
	// By the buttons the discard is a link in the sentence; in the card it is
	// a button, saying what its question's own button says. Its question is
	// the one that keeps an applied patch or a pull request (#669).
	for (const state of [{ tracTicket: null }, { pullRequest: { number: 7 } }, { tracTicket: null, workItemNoun: 'issue' }]) {
		for (const changedCount of [undefined, 1, 2]) {
			const parts = changesNoteParts({ dirty: true, changedCount, ...state });
			assert.equal(parts.placement, 'buttons');
			assert.match(parts.sentence, / or <discard>discard your changes<\/discard>\./, JSON.stringify(state));
		}
	}
	assert.equal(discardLabel(), 'Discard changes');
	assert.equal(discardLabel(), discardYourChangesQuestion().confirm);
});

test('the question before a discard asks it, and its button says what it does', () => {
	assert.deepEqual(discardQuestion(), {
		title: 'Discard all local changes?',
		description: 'This can’t be undone.',
		confirm: 'Discard changes'
	});
});

// "Discard your changes" (#669) says what goes and what stays: the
// contributor's edits go, the applied patch or checked-out PR stays, and a
// patch the app cannot put back is named as going too.
test('the question before discarding your changes names what stays', () => {
	assert.deepEqual(discardYourChangesQuestion({ editedCount: 3, appliedPatch: { label: '23602.diff', kept: true } }), {
		title: 'Discard your changes?',
		description: 'Your edits to 3 files are removed. The patch 23602.diff stays applied. This can’t be undone.',
		confirm: 'Discard changes'
	});
	assert.equal(
		discardYourChangesQuestion({ editedCount: 1, pullRequest: { number: 7 } }).description,
		'Your edits to 1 file are removed. PR #7 stays checked out. This can’t be undone.'
	);
	assert.equal(
		discardYourChangesQuestion({ editedCount: 2 }).description,
		'Your edits to 2 files are removed. This can’t be undone.'
	);
});

test('the question before discarding your changes warns when the patch cannot be put back', () => {
	assert.equal(
		discardYourChangesQuestion({ editedCount: 1, appliedPatch: { label: 'big.diff', kept: false } }).description,
		'Your edits to 1 file are removed. The applied patch big.diff is removed too, because the app can’t put it back. This can’t be undone.'
	);
});

// The list may still be loading when the link is pressed; the question goes
// without a count rather than guessing one.
test('the question before discarding your changes leaves out a count it does not have', () => {
	assert.equal(
		discardYourChangesQuestion({ editedCount: null, appliedPatch: { label: '23602.diff', kept: true } }).description,
		'The patch 23602.diff stays applied. This can’t be undone.'
	);
});

// What "Your edits to N files" counts (#669): the files under "Your
// changes", and the patch's or PR's own that were edited since. Unknown
// while the list has not been walked.
test('ownEditCount counts the contributor\'s files and the change\'s they edited', () => {
	const groups = {
		change: { label: 'From the patch', files: [{ path: 'a.php', alsoEdited: true }, { path: 'b.php', alsoEdited: false }] },
		yours: [{ path: 'c.php', added: true }]
	};
	assert.equal(ownEditCount(groups, { entries: [] }), 2);
	assert.equal(ownEditCount({ change: null, yours: [] }, { entries: [] }), 0);
	assert.equal(ownEditCount(groups, null), null);
});

test('discardToast says only the contributor\'s changes went when the patch or PR stayed', () => {
	assert.equal(discardToast({ ok: true, keptPatch: 'x.diff' }, {}), 'Your changes were discarded.');
	assert.equal(discardToast({ ok: true }, { pullRequest: { number: 7 } }), 'Your changes were discarded.');
	// The patch could not be put back: the red line says so, and "all" would
	// read as if that was the plan.
	assert.equal(discardToast({ ok: true, removedPatch: 'x.diff', patchLost: true }, {}), 'Your changes were discarded.');
	assert.equal(discardToast({ ok: true, removedPatch: 'x.diff' }, {}), 'All changes discarded.');
	assert.equal(discardToast({ ok: true }, {}), 'All changes discarded.');
});

// With the patch or PR staying and none of the contributor's work left, a
// discard would reset and re-apply to remove nothing (#669).
test('discardDisabledReason says when there is nothing of yours to discard', () => {
	assert.equal(
		discardDisabledReason({ patchHasChanges: true, nothingOfYours: true }),
		'There are no edits of yours to discard.'
	);
	assert.equal(discardDisabledReason({ patchHasChanges: true, nothingOfYours: false }), null);
});

test('discardOutcome carries what happened to the applied patch (#669)', () => {
	assert.deepEqual(
		discardOutcome({ ok: true, dirty: true, changedCount: 1, keptPatch: 'x.diff' }),
		{ ok: true, dirty: true, changedCount: 1, keptPatch: 'x.diff' }
	);
	assert.deepEqual(
		discardOutcome({ ok: true, removedPatch: 'x.diff', patchLost: true }),
		{ ok: true, removedPatch: 'x.diff', patchLost: true }
	);
});

test('discardOutcome passes a success through', () => {
	assert.deepEqual(discardOutcome({ ok: true }), { ok: true });
});

test('discardOutcome carries the recount of what survived the discard (#239)', () => {
	// On a ticket branch the parked work survives a discard, and the reply
	// says how much. Dropping that here would leave the card marking the tree
	// clean over work that is still there — the silence #239 is about.
	assert.deepEqual(
		discardOutcome({ ok: true, dirty: true, changedCount: 2 }),
		{ ok: true, dirty: true, changedCount: 2 }
	);
	assert.deepEqual(
		discardOutcome({ ok: true, dirty: false, changedCount: 0 }),
		{ ok: true, dirty: false, changedCount: 0 }
	);
});

test('discardOutcome always carries a message on failure', () => {
	assert.deepEqual(discardOutcome({ ok: false, error: 'EACCES' }), {
		ok: false,
		message: 'Failed to discard changes: EACCES'
	});
	assert.deepEqual(discardOutcome({ ok: false }), {
		ok: false,
		message: 'Failed to discard changes: Unknown error'
	});
	assert.deepEqual(discardOutcome(null), {
		ok: false,
		message: 'Failed to discard changes: Unknown error'
	});
});

test('noteAfterDiscard keeps the note over work the discard did not take (#239)', () => {
	// The case the recount exists for: on a ticket branch the parked WIP
	// survives the reset, so the card must not go quiet over it.
	assert.deepEqual(
		noteAfterDiscard({ ok: true, dirty: true, changedCount: 2 }),
		{ dirty: true, changedCount: 2 }
	);
	assert.deepEqual(
		noteAfterDiscard({ ok: true, dirty: false, changedCount: 0 }),
		{ dirty: false, changedCount: 0 }
	);
});

test('noteAfterDiscard falls back to clean when the reply carries no recount (#239)', () => {
	// What the old markTreeClean asserted unconditionally. A reply without a
	// recount — the count itself failed — must not invent a dirty note; the
	// next probe is what corrects it either way.
	assert.deepEqual(noteAfterDiscard({ ok: true }), { dirty: false, changedCount: 0 });
	assert.deepEqual(noteAfterDiscard({ ok: false, message: 'EACCES' }), { dirty: false, changedCount: 0 });
	assert.deepEqual(noteAfterDiscard(undefined), { dirty: false, changedCount: 0 });
	// A count that arrives unusable next to a true `dirty` still leaves the
	// note honest — "you have changes", with no number (see changesNoteParts).
	assert.deepEqual(
		noteAfterDiscard({ ok: true, dirty: true, changedCount: undefined }),
		{ dirty: true, changedCount: 0 }
	);
});

test('noteAfterProbe clears an old count when the base cannot be measured (#308)', () => {
	assert.deepEqual(
		noteAfterProbe({ dirty: true, changedCount: 4 }, { ok: false, error: 'Unknown ticket base' }),
		null
	);
	assert.deepEqual(
		noteAfterProbe(null, { ok: true, dirty: true, changedCount: 2 }),
		{ dirty: true, changedCount: 2 }
	);
});
test('discardBlocked holds the discard while anything is rewriting the tree', () => {
	// The same states that block starting a trunk update: a force checkout
	// under a running install, build or dev server corrupts both.
	assert.equal(discardBlocked({}), false);
	assert.equal(discardBlocked(), false);
	for (const flag of ['isUpdating', 'installing', 'building', 'devServerActive', 'discarding']) {
		assert.equal(discardBlocked({ [flag]: true }), true, flag);
	}
});

test('discardDisabledReason explains every state that makes discard unavailable', () => {
	assert.equal(discardDisabledReason({ patchLoading: true, patchHasChanges: true }), 'Wait for your changes to finish loading.');
	assert.equal(discardDisabledReason({ patchLoadFailed: true, patchHasChanges: false }), 'Changes could not be loaded.');
	assert.equal(discardDisabledReason({ patchHasChanges: false }), 'There are no changes to discard.');
	assert.equal(discardDisabledReason({ patchHasChanges: true, discarding: true }), 'Changes are already being discarded.');
	assert.equal(discardDisabledReason({ patchHasChanges: true, isUpdating: true }), 'Wait for the trunk update to finish before discarding changes.');
	assert.equal(discardDisabledReason({ patchHasChanges: true, installing: true }), 'Wait for the installation to finish before discarding changes.');
	assert.equal(discardDisabledReason({ patchHasChanges: true, building: true }), 'Wait for the build to finish before discarding changes.');
	assert.equal(discardDisabledReason({ patchHasChanges: true, testsRunning: true }), 'Wait for the PHP unit tests to finish before discarding changes.');
	assert.equal(discardDisabledReason({ patchHasChanges: true, devServerActive: true }), 'Stop the dev server before discarding changes.');
	assert.equal(discardDisabledReason({ patchHasChanges: true }), null);
});

test('discardDisabledReason reports the operation in progress before secondary blockers', () => {
	assert.equal(
		discardDisabledReason({ patchLoading: true, patchHasChanges: false, discarding: true, devServerActive: true }),
		'Changes are already being discarded.'
	);
});

 test('review context names the PR base instead of trunk or the ticket', () => {
	const { patchReviewContext } = require('../../src/renderer/changes-note.cjs');
	const pr = patchReviewContext({ pullRequest: { number: 7 }, tracTicket: 123 });
	assert.match(pr.heading, /PR #7/);
	assert.match(pr.description, /original PR commits/);
	assert.doesNotMatch(pr.empty, /trunk/);
	assert.match(patchReviewContext({ tracTicket: 123 }).heading, /ticket #123/);
	assert.equal(patchReviewContext().heading, 'Your changes');
});

// The note says what the site calls its work item (#251).
test('changesNoteParts speaks of an issue when told the site\'s noun', () => {
	const linked = changesNoteParts({ dirty: true, changedCount: 2, tracTicket: '71234', workItemNoun: 'issue' });
	assert.equal(linked.placement, 'ticket');
	assert.equal(linked.title, '2 unsubmitted changes for issue #71234');
	assert.match(linked.body, /Unlinking this issue/);
	assert.doesNotMatch(linked.title + linked.body, /ticket/);
	assert.equal(changesNoteParts({ dirty: true, tracTicket: '71234', workItemNoun: 'issue' }).title, 'Unsubmitted changes for issue #71234');
	const loose = changesNoteParts({ dirty: true, changedCount: 1, tracTicket: null, workItemNoun: 'issue' });
	assert.match(loose.sentence, /^You have 1 change not assigned to any issue\. /);
	assert.match(changesNoteParts({ dirty: true, tracTicket: null, workItemNoun: 'issue' }).sentence, /^You have changes not assigned to any issue\. /);
});

test('patchReviewContext names the work item by the site\'s noun (#251)', () => {
	const { patchReviewContext } = require('../../src/renderer/changes-note.cjs');
	assert.equal(patchReviewContext({ tracTicket: 71234, workItemNoun: 'issue' }).heading, 'Your changes for issue #71234');
});
