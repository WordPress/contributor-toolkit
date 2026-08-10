'use strict';

// The sentence the window shows when a folder will not open.
//
// It exists as its own module because there were two of them. The editor menu
// grew a real one in #209 — a branch per reason, each saying what to do next —
// while revealing the folder in the file manager kept the string it shipped
// with: the `error` field, or the words "unknown error" when there was none.
//
// A refusal is exactly the case with no `error` field. So the one failure the
// app understands best — it declined on purpose, and knows why — was the one it
// described as unknown (#180).

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeOpenFailure, noticeForOpenResult } = require('../src/renderer/open-failure.cjs');
const { REFUSAL_REASONS } = require('../src/editor-launch.js');
const { REVEAL_REASONS } = require('../src/site-registry.js');

// The two the guard modules cannot list: `cancelled` is the file dialog
// closing, returned by the `editor:open` handler itself (src/main.js), and
// `unavailable` is synthesised in the renderer when the invoke rejects.
const REASONS_FROM_ELSEWHERE = ['cancelled', 'unavailable'];

// Everything `editor:open` and `dir:show` can answer with has to have a
// sentence here, and a hand-kept copy of that list is the kind that goes stale
// in the direction of the generic fallback — which is the failure this whole
// module exists to stop. So the list is the guard modules' own exports, which
// their answers are built from, plus the two above.
function reasonsInGuardModules() {
	return [...new Set([
		...Object.values(REFUSAL_REASONS),
		...Object.values(REVEAL_REASONS)
	])];
}

// --- the whole notice ----------------------------------------------------
//
// `noticeForOpenResult` is the unit the window actually uses, and it is the
// unit deliberately: the sentence was never the broken part. #209 already
// described 'unregistered-site' correctly, and revealing the folder still
// printed "unknown error", because that call site built its own string instead
// of asking. Testing the describer alone would have passed on the old code.
//
// So everything the caller used to decide inline — whether there is a notice at
// all, what it says, and whether "Choose application…" is a way out of it —
// lives here, and the window is left with an assignment.

test('a refusal to reveal says the app has no record of the folder', () => {
	const notice = noticeForOpenResult({ ok: false, reason: 'unregistered-site' });

	assert.match(notice.message, /no record/);
	assert.doesNotMatch(notice.message, /unknown error/);
});

test('a success is not a notice', () => {
	assert.equal(noticeForOpenResult({ ok: true }), null);
});

// Closing the dialog is an answer, not a failure — saying something about it
// would be the app arguing with a decision the contributor just made.
test('a cancelled dialog is not a notice either', () => {
	assert.equal(noticeForOpenResult({ ok: false, reason: 'cancelled' }), null);
});

// "Choose application…" answers "that editor did not work". It is not an answer
// to a refusal the application had nothing to do with: `openSiteInEditor`
// checks the folder before it looks at the editor, so picking another one comes
// back with the identical sentence.
test('the picker is only offered where picking another application would help', () => {
	const helps = ['unlaunchable-editor', 'unknown-editor', 'spawn-failed'];
	const doesNot = ['unregistered-site', 'open-failed', 'unavailable'];

	for (const reason of helps) {
		assert.equal(noticeForOpenResult({ ok: false, reason }).offerPicker, true, reason);
	}
	for (const reason of doesNot) {
		assert.equal(noticeForOpenResult({ ok: false, reason }).offerPicker, false, reason);
	}

	// The two lists above are a judgement per reason, so a new refusal must be
	// judged rather than defaulting to "no way forward" unnoticed.
	const judged = new Set([...helps, ...doesNot, 'cancelled']);
	for (const reason of [...reasonsInGuardModules(), ...REASONS_FROM_ELSEWHERE]) {
		assert.ok(judged.has(reason), `${reason} has no decision about the picker`);
	}
});

// --- the sentence --------------------------------------------------------

// The half that is easy to lose in the move. `revealRegisteredSite` returns
// 'open-failed' *with* the OS's own message, and the string this replaces did
// surface it. A branch that fell through to the generic sentence would be a
// regression dressed as a cleanup.
test('an OS failure keeps the message the OS gave', () => {
	const sentence = describeOpenFailure({ ok: false, reason: 'open-failed', error: 'no application' });

	assert.match(sentence, /would not open/);
	assert.match(sentence, /no application/);
});

test('an OS failure with nothing to quote still names the failure', () => {
	const sentence = describeOpenFailure({ ok: false, reason: 'open-failed' });

	assert.match(sentence, /would not open/);
	assert.doesNotMatch(sentence, /undefined/);
});

// Read from the guard modules' own exports rather than listed here, so a
// refusal added to either one fails this instead of silently arriving as
// "Could not open the folder." — the generic sentence is a fallback, not a
// destination.
test('every reason the main process can refuse with has its own sentence', () => {
	const generic = describeOpenFailure({ ok: false });

	for (const reason of [...reasonsInGuardModules(), ...REASONS_FROM_ELSEWHERE]) {
		if (reason === 'cancelled') continue; // Not a failure; noticeForOpenResult drops it.
		assert.notEqual(describeOpenFailure({ ok: false, reason }), generic, reason);
	}
});

test('a message the app could not read does not reach the window as "undefined"', () => {
	for (const error of [undefined, null, '   ', 42]) {
		const sentence = describeOpenFailure({ ok: false, reason: 'spawn-failed', error });
		assert.doesNotMatch(sentence, /undefined|null|42/);
	}
});

// Carried over from #209 rather than invented here: 'unlaunchable-editor' is two
// different situations, and only the caller knows which it asked for.
test('an application that will not launch reads differently for a picked one', () => {
	const detected = describeOpenFailure({ ok: false, reason: 'unlaunchable-editor' }, { picked: false });
	const picked = describeOpenFailure({ ok: false, reason: 'unlaunchable-editor' }, { picked: true });

	assert.notEqual(detected, picked);
	assert.match(detected, /no longer where it was/);
	assert.match(picked, /not an application/);
});

test('a failure with no reason at all still says something', () => {
	const sentence = describeOpenFailure({ ok: false });

	assert.ok(sentence.length > 0);
	assert.doesNotMatch(sentence, /undefined/);
});
