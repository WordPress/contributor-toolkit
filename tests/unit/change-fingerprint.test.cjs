const test = require('node:test');
const assert = require('node:assert/strict');

const { fingerprint, editedSinceChange } = require('../../src/change-fingerprint.cjs');

// Line endings do not count: a CRLF checkout (native Git on Windows) writing
// the patch's bytes back is the same content, not an edit.
test('a fingerprint is the same for the same content, whatever its line endings', () => {
	assert.equal(fingerprint(Buffer.from('<?php\r\necho 1;\r\n')), fingerprint(Buffer.from('<?php\necho 1;\n')));
	assert.notEqual(fingerprint(Buffer.from('<?php echo 1;\n')), fingerprint(Buffer.from('<?php echo 2;\n')));
	assert.match(fingerprint(Buffer.from('x')), /^[0-9a-f]{64}$/);
});

// A file that is not there has no content to fingerprint.
test('a file that is not there has no fingerprint', () => {
	assert.equal(fingerprint(null), null);
});

// A patch: each file it wrote against what is on disk now. Edited back to
// how it was before the patch counts too, though the file then drops out of
// the unsubmitted list: it is no longer what the patch wrote.
test('a patched file whose content no longer matches what the patch wrote is edited since', () => {
	const fingerprints = { 'src/a.php': 'aaa', 'src/b.php': 'bbb', 'src/gone.php': null, 'src/back.php': null };
	const now = { 'src/a.php': 'aaa', 'src/b.php': 'changed', 'src/gone.php': null, 'src/back.php': 'restored' };
	assert.deepEqual(editedSinceChange({ fingerprints, now }), ['src/b.php', 'src/back.php']);
});

// Recorded before fingerprints were: nothing can be said, so nothing is.
test('a patch with no fingerprints marks nothing', () => {
	assert.deepEqual(editedSinceChange({ fingerprints: null, now: {} }), []);
	assert.deepEqual(editedSinceChange({}), []);
});

// A pull request is its branch's base, so any of its files that is changed
// at all was changed by the contributor.
test('a pull request file that is among the unsubmitted changes is edited since', () => {
	assert.deepEqual(
		editedSinceChange({ prFiles: ['src/a.php', 'src/b.php'], unsubmitted: ['src/b.php', 'src/mine.php'] }),
		['src/b.php']
	);
});
