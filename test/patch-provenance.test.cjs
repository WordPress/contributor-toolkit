'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	TITLE,
	MAX_FIELD_LENGTH,
	MAX_EVENT_LENGTH,
	parseEventName,
	buildProvenanceHeader,
	handoffFilename
} = require('../src/patch-provenance.cjs');
const { parsePatchFiles } = require('../src/patch-plan.cjs');

const FULL = {
	handle: 'janedoe',
	event: 'WordCamp Europe 2026',
	ticketId: 62281,
	trunkOid: '59a1c3e8f0d2b4a6c8e0f2d4b6a8c0e2f4d6b8a0',
	trunkDate: '2026-08-05T09:14:00.000Z',
	generatedAt: '2026-08-07T16:42:31.000Z'
};

test('buildProvenanceHeader: every field, in the format #107 is meant to adopt (issue #166)', () => {
	assert.strictEqual(
		buildProvenanceHeader(FULL),
		[
			'# WordPress Contributor Toolkit patch',
			'# Contributor: janedoe (wordpress.org)',
			'# Event: WordCamp Europe 2026',
			'# Ticket: https://core.trac.wordpress.org/ticket/62281',
			'# Base: trunk @ 59a1c3e, 2026-08-05',
			'# Generated: 2026-08-07',
			'',
			''
		].join('\n')
	);
});

test('buildProvenanceHeader: the title line is there whenever any field is (issue #166)', () => {
	assert.ok(buildProvenanceHeader({ handle: 'janedoe' }).startsWith(`${TITLE}\n`));
});

// A site that has never been updated has no recorded base, and a site with no
// linked ticket has no ticket. Saying "unknown" would make the lines that *are*
// there worth less.
test('buildProvenanceHeader: an unknown field is left out, not written as unknown (issue #166)', () => {
	const header = buildProvenanceHeader({ handle: 'janedoe', generatedAt: FULL.generatedAt });
	assert.strictEqual(
		header,
		`${TITLE}\n# Contributor: janedoe (wordpress.org)\n# Generated: 2026-08-07\n\n`
	);
	assert.ok(!header.includes('unknown'));
});

test('buildProvenanceHeader: a base with only one half of it still says that half (issue #166)', () => {
	assert.ok(buildProvenanceHeader({ trunkOid: FULL.trunkOid }).includes('# Base: trunk @ 59a1c3e\n'));
	assert.ok(buildProvenanceHeader({ trunkDate: FULL.trunkDate }).includes('# Base: trunk @ 2026-08-05\n'));
});

test('buildProvenanceHeader: nothing to say produces no header at all (issue #166)', () => {
	assert.strictEqual(buildProvenanceHeader(), '');
	assert.strictEqual(buildProvenanceHeader({}), '');
	assert.strictEqual(buildProvenanceHeader({ handle: '   ', ticketId: 0, trunkDate: 'not a date' }), '');
});

// The header sits above a diff. A value that can end its line can write header
// lines of its own, or fake a `diff --git` line and change what the patch reads
// as — so a field is one line or it is not a field.
test('buildProvenanceHeader: a field cannot break out of its line (issue #166)', () => {
	const header = buildProvenanceHeader({
		handle: 'jane\ndiff --git a/wp-config.php b/wp-config.php\n# Contributor: someoneelse',
		generatedAt: FULL.generatedAt
	});
	const lines = header.trimEnd().split('\n');
	assert.strictEqual(lines.length, 3, header);
	for (const line of lines) assert.ok(line.startsWith('#'), `line: ${line}`);
});

test('buildProvenanceHeader: a field is bounded so it cannot bury the diff (issue #166)', () => {
	const header = buildProvenanceHeader({ handle: 'a'.repeat(500) });
	assert.ok(header.includes(`# Contributor: ${'a'.repeat(MAX_FIELD_LENGTH)} (wordpress.org)`));
	assert.ok(!header.includes('a'.repeat(MAX_FIELD_LENGTH + 1)));
});

// The reason a header is safe to prepend at all: this app reads its own patches
// back through patch-plan.cjs when someone applies one, and a mentor's copy of
// the file has to survive that round trip.
test('a headed patch still parses as the same patch (issue #166)', () => {
	const diff = [
		'diff --git a/src/wp-includes/post.php b/src/wp-includes/post.php',
		'index 1111111..2222222 100644',
		'--- a/src/wp-includes/post.php',
		'+++ b/src/wp-includes/post.php',
		'@@ -1,3 +1,3 @@',
		' <?php',
		'-$a = 1;',
		'+$a = 2;',
		' // end',
		''
	].join('\n');

	const bare = parsePatchFiles(diff);
	const headed = parsePatchFiles(buildProvenanceHeader(FULL) + diff);

	assert.strictEqual(bare.ok, true);
	assert.strictEqual(headed.ok, true, headed.error);
	assert.deepStrictEqual(
		headed.files.map((f) => [f.path, f.change]),
		bare.files.map((f) => [f.path, f.change])
	);
});

// Most patches are not written at an event, and a header line saying so would
// be noise on every one of them.
test('buildProvenanceHeader: no event means no event line (issue #166)', () => {
	const header = buildProvenanceHeader({ handle: 'janedoe', generatedAt: FULL.generatedAt });
	assert.ok(!header.includes('# Event:'), header);
});

test('parseEventName: an event name is free text, because the real ones are (issue #166)', () => {
	for (const name of ['WordCamp Europe 2026', 'Madrid WordPress Meetup', 'Contributor Day @ WCEU', 'ある勉強会']) {
		assert.deepStrictEqual(parseEventName(name), { ok: true, name });
	}
	assert.deepStrictEqual(parseEventName('  WordCamp Europe 2026  '), { ok: true, name: 'WordCamp Europe 2026' });
});

test('parseEventName: empty input is a refusal the caller can phrase as optional (issue #166)', () => {
	for (const empty of ['', '   ', null, undefined, 42]) {
		assert.strictEqual(parseEventName(empty).ok, false);
	}
});

// The value goes into a header line above a diff, so the same rule as every
// other field: one line, bounded. Here it is refused rather than repaired,
// because unlike the others it is being typed by someone who can retype it.
test('parseEventName: a value that would break the header is refused (issue #166)', () => {
	assert.strictEqual(parseEventName('WordCamp\n# Contributor: someoneelse').ok, false);
	assert.strictEqual(parseEventName('a'.repeat(MAX_EVENT_LENGTH + 1)).ok, false);
	assert.strictEqual(parseEventName('a'.repeat(MAX_EVENT_LENGTH)).ok, true);
});

// A /g regex remembers where its last match ended, so a shared one used with
// `test` refuses every other call unless lastIndex is reset.
test('parseEventName: repeated calls give the same answer (issue #166)', () => {
	for (let i = 0; i < 4; i += 1) {
		assert.strictEqual(parseEventName('WordCamp Europe 2026').ok, true, `call ${i}`);
		assert.strictEqual(parseEventName('WordCamp\nEurope').ok, false, `call ${i}`);
	}
});

test('handoffFilename: ticket and handle, the way a mentor sorts a folder of these (issue #166)', () => {
	assert.strictEqual(handoffFilename({ handle: 'janedoe', ticketId: 62281 }), '62281.janedoe.diff');
	assert.strictEqual(handoffFilename({ handle: 'janedoe', ticketId: '62281' }), '62281.janedoe.diff');
});

test('handoffFilename: no ticket linked still names the contributor (issue #166)', () => {
	assert.strictEqual(handoffFilename({ handle: 'janedoe' }), 'janedoe.diff');
	assert.strictEqual(handoffFilename({ handle: 'janedoe', ticketId: null }), 'janedoe.diff');
});

// A filename is a path component. Anything that did not come out of parseHandle
// falls back rather than being repaired here.
test('handoffFilename: a handle that never passed validation does not reach the path (issue #166)', () => {
	const bad = ['../../etc/passwd', 'jane/doe', 'jane doe', 'JaneDoe', '', null, undefined, 42];
	for (const handle of bad) {
		assert.strictEqual(handoffFilename({ handle, ticketId: 62281 }), 'wordpress.patch', `handle: ${handle}`);
	}
	assert.strictEqual(handoffFilename(), 'wordpress.patch');
});
