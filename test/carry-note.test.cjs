'use strict';

// What the app says about a ticket left on an older trunk (#305). Pure copy,
// so this asserts the sentences a contributor reads — not that a function was
// called. The three things it must always do: stay quiet when there is nothing
// to say, name the consequence of staying behind, and refuse before anything
// moves when a file cannot come across.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	CARRY_STATE,
	REFUSAL,
	WHY_NOT_STAY,
	NOTHING_MOVES_YET,
	refusalSentences,
	describeCarryNote,
	describeCarryOffer
} = require('../src/renderer/carry-note.cjs');

// --- the card's note -------------------------------------------------------

test('a ticket that is current, or that the app cannot place, gets no note (issue #305)', () => {
	assert.equal(describeCarryNote({ state: CARRY_STATE.CURRENT }), null);
	assert.equal(describeCarryNote({ state: CARRY_STATE.UNKNOWN }), null);
	assert.equal(describeCarryNote({}), null);
});

test('a ticket behind trunk is told what staying behind costs (issue #305)', () => {
	const note = describeCarryNote({ state: CARRY_STATE.BEHIND, since: '10 January 2026' });
	assert.match(note.text, /10 January 2026/);
	assert.ok(note.text.includes(WHY_NOT_STAY), 'the note must name the consequence, not just the fact');
	assert.equal(note.level, 'note', 'nothing is broken yet — an alert here would cry wolf');
});

test('the note still says something when the base date is unknown (issue #305)', () => {
	const note = describeCarryNote({ state: CARRY_STATE.BEHIND, since: '' });
	assert.match(note.text, /an older trunk/);
	assert.doesNotMatch(note.text, /undefined|Invalid Date/);
});

// --- the offer -------------------------------------------------------------

test('the offer counts what carries cleanly and what trunk has also changed (issue #305)', () => {
	const offer = describeCarryOffer({
		state: CARRY_STATE.BEHIND,
		wholesale: ['src/wp-login.php', 'src/notes.php'],
		merge: ['src/class-wp-query.php']
	});
	assert.equal(offer.canCarry, true);
	const text = offer.sentences.join(' ');
	assert.match(text, /3 files/);
	assert.match(text, /2 files come across exactly as they are/);
	assert.match(text, /1 file trunk has also changed/);
	assert.ok(text.includes(NOTHING_MOVES_YET), 'the offer must say nothing moves until it is accepted');
});

test('one file of each kind reads as singular (issue #305)', () => {
	const offer = describeCarryOffer({ state: CARRY_STATE.BEHIND, wholesale: ['a.php'], merge: ['b.php'] });
	const text = offer.sentences.join(' ');
	assert.match(text, /1 file comes across exactly as it is/);
	assert.match(text, /replayed onto its new version/);
});

test('a ticket with no work still gets an offer, and it says the base is all that moves (issue #305)', () => {
	const offer = describeCarryOffer({ state: CARRY_STATE.BEHIND, since: '10 January 2026' });
	assert.equal(offer.canCarry, true);
	assert.match(offer.sentences.join(' '), /no work on it yet/);
});

test('a refused file blocks the offer and is named, not counted (issue #305)', () => {
	const offer = describeCarryOffer({
		state: CARRY_STATE.BEHIND,
		wholesale: ['src/wp-login.php'],
		refused: [{ path: 'src/gone.php', reason: REFUSAL.UPSTREAM_DELETED }]
	});
	assert.equal(offer.canCarry, false);
	assert.equal(offer.blocked.length, 1);
	assert.match(offer.blocked[0], /src\/gone\.php/);
	assert.ok(
		!offer.sentences.join(' ').includes(NOTHING_MOVES_YET),
		'promising nothing moves is beside the point when the answer is that it cannot'
	);
});

test('each refusal reason gets its own sentence, in a stable order (issue #305)', () => {
	const sentences = refusalSentences([
		{ path: 'e.php', reason: REFUSAL.UNREADABLE },
		{ path: 'a.php', reason: REFUSAL.UPSTREAM_DELETED },
		{ path: 'd.png', reason: REFUSAL.BINARY_CONFLICT },
		{ path: 'c.php', reason: REFUSAL.ADDED_BOTH },
		{ path: 'b.php', reason: REFUSAL.DELETED_BUT_CHANGED }
	]);
	assert.equal(sentences.length, 5);
	assert.match(sentences[0], /Trunk has deleted a\.php/);
	assert.match(sentences[1], /This ticket deletes b\.php/);
	assert.match(sentences[2], /c\.php was added both/);
	assert.match(sentences[3], /d\.png is binary/);
	assert.match(sentences[4], /e\.php could not be read/);
});

test('a file trunk removed the same way is counted, not silently dropped (issue #305)', () => {
	const offer = describeCarryOffer({
		state: CARRY_STATE.BEHIND,
		wholesale: ['a.php'],
		settled: ['gone.php']
	});
	assert.equal(offer.canCarry, true);
	const text = offer.sentences.join(' ');
	assert.match(text, /2 files this ticket has work in/);
	assert.match(text, /1 file trunk has already removed as well/);
});

test('several files sharing a reason share one sentence (issue #305)', () => {
	const sentences = refusalSentences([
		{ path: 'a.php', reason: REFUSAL.UPSTREAM_DELETED },
		{ path: 'b.php', reason: REFUSAL.UPSTREAM_DELETED }
	]);
	assert.equal(sentences.length, 1);
	assert.match(sentences[0], /a\.php and b\.php/);
	assert.match(sentences[0], /them/, 'the plural has to agree, or the sentence reads as machine output');
});

test('an applied layer is named, and the two faces read differently (issue #305, #306)', () => {
	const liftable = describeCarryOffer({
		state: CARRY_STATE.BEHIND,
		wholesale: ['a.php'],
		appliedPatch: { label: 'Pull request #1234', revertable: true }
	});
	assert.match(liftable.sentences.join(' '), /Pull request #1234 is lifted out first/);

	const absorbed = describeCarryOffer({
		state: CARRY_STATE.BEHIND,
		wholesale: ['a.php'],
		appliedPatch: { label: 'Pull request #1234', revertable: false }
	});
	assert.match(absorbed.sentences.join(' '), /part of your changes now, so it moves with them as one/);
});

test('no offer is made for a ticket that is not behind (issue #305)', () => {
	assert.equal(describeCarryOffer({ state: CARRY_STATE.CURRENT, wholesale: ['a.php'] }), null);
	assert.equal(describeCarryOffer({ state: CARRY_STATE.UNKNOWN }), null);
});
