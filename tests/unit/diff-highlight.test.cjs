'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MAX_HIGHLIGHTED_LINES, classifyLine, highlightDiff, hasDiffLines } = require('../../src/renderer/diff-highlight.cjs');

test('classifyLine: added and removed code are the two the reader is looking for (issue #166)', () => {
	assert.strictEqual(classifyLine('+\t$a = 2;'), 'add');
	assert.strictEqual(classifyLine('-\t$a = 1;'), 'del');
	assert.strictEqual(classifyLine(' \t// unchanged'), 'context');
	assert.strictEqual(classifyLine(''), 'context');
});

// The classic diff-viewer bug: `---` and `+++` name the files being compared,
// and painting them red and green puts two fake changes at the top of every
// patch.
test('classifyLine: the file-name lines are not a deletion and an addition (issue #166)', () => {
	assert.strictEqual(classifyLine('--- a/src/wp-includes/post.php'), 'meta');
	assert.strictEqual(classifyLine('+++ b/src/wp-includes/post.php'), 'meta');
});

test('classifyLine: hunk headers are their own thing (issue #166)', () => {
	assert.strictEqual(classifyLine('@@ -288,7 +288,7 @@'), 'hunk');
	assert.strictEqual(classifyLine('@@ -1 +1 @@ class Foo {'), 'hunk');
});

// Both shapes this app has to render: what it generates itself, and what it
// downloads from a pull request or a Trac attachment (#11).
test('classifyLine: the metadata of a generated and of a git patch both read as metadata (issue #166)', () => {
	const meta = [
		'===================================================================',
		'diff --git a/src/wp-includes/post.php b/src/wp-includes/post.php',
		'index 1111111..2222222 100644',
		'Index: src/wp-includes/post.php',
		'new file mode 100644',
		'deleted file mode 100644',
		'rename from src/old.php',
		'rename to src/new.php',
		'similarity index 96%',
		'Binary files a/image.png and b/image.png differ',
		'GIT binary patch'
	];
	for (const line of meta) {
		assert.strictEqual(classifyLine(line), 'meta', `line: ${line}`);
	}
});

// The provenance block this app prepends to a handed-off patch. Nothing in the
// diff proper starts at column 0 with a `#`, so the marker is unambiguous.
test('classifyLine: the provenance header is not part of the diff (issue #166)', () => {
	assert.strictEqual(classifyLine('# WordPress Contributor Toolkit patch'), 'header');
	assert.strictEqual(classifyLine('# Contributor: janedoe (wordpress.org)'), 'header');
	// A PHP comment inside the patch is a diff line first: it carries the
	// space, `+` or `-` marker, so it never reaches the header branch.
	assert.strictEqual(classifyLine('+# not a header, an added shell comment'), 'add');
	assert.strictEqual(classifyLine(' # not a header, an unchanged one'), 'context');
});

test('highlightDiff: every line comes back, in order, with its kind (issue #166)', () => {
	const patch = [
		'--- a/src/x.php',
		'+++ b/src/x.php',
		'@@ -1,2 +1,2 @@',
		' <?php',
		'-$a = 1;',
		'+$a = 2;'
	].join('\n');

	assert.deepStrictEqual(highlightDiff(patch).map((l) => l.kind), [
		'meta', 'meta', 'hunk', 'context', 'del', 'add'
	]);
	assert.deepStrictEqual(highlightDiff(patch).map((l) => l.text), patch.split('\n'));
});

// A patch big enough that one element per line stops being free is also one
// nobody is reading line by line. The caller falls back to plain text.
test('highlightDiff: a patch past the line budget is not painted at all (issue #166)', () => {
	assert.strictEqual(highlightDiff('+x\n'.repeat(MAX_HIGHLIGHTED_LINES + 1)), null);
	assert.notStrictEqual(highlightDiff('+x\n'.repeat(10)), null);
});

test('highlightDiff: nothing to paint is null, not an empty line (issue #166)', () => {
	assert.strictEqual(highlightDiff(''), null);
	assert.strictEqual(highlightDiff(null), null);
	assert.strictEqual(highlightDiff(undefined), null);
});

// A patch can now carry `#` lines that explain what is NOT in it — the
// binaries a text diff cannot represent (issue #85), and the provenance header
// on a handoff (issue #166). The panel decides whether to offer Trac and the
// other destinations from this, so commentary must not read as content.
test('hasDiffLines: commentary above an empty patch is not a change (issue #85)', () => {
	const binaryOnly = [
		'# 1 binary file is not in this patch — a text diff cannot carry it:',
		'#   src/wp-includes/images/logo.png',
		'',
		'No changes.'
	].join('\n');

	assert.strictEqual(hasDiffLines(binaryOnly), false);
	assert.strictEqual(hasDiffLines('No changes.'), false);
	assert.strictEqual(hasDiffLines(''), false);
	assert.strictEqual(hasDiffLines(null), false);
});

test('hasDiffLines: a diff under the commentary is a change (issue #85)', () => {
	const withBinaryNotice = [
		'# 1 binary file is not in this patch — a text diff cannot carry it:',
		'#   src/x.png',
		'',
		'--- a/src/post.php\t',
		'+++ b/src/post.php\t',
		'@@ -1,1 +1,1 @@',
		'-old',
		'+new'
	].join('\n');

	assert.strictEqual(hasDiffLines(withBinaryNotice), true);
	// The handoff header (issue #166) is the same shape, above a real diff.
	assert.strictEqual(hasDiffLines('# WordPress Contributor Toolkit patch\n# Contributor: janedoe\n\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b'), true);
});
