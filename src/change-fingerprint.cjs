// Which of a patch's or pull request's files the contributor has changed
// since (#669), for the "also edited" mark under "Changed files".
//
// A pull request is its branch's base, so that is a question the unsubmitted
// list already answers. A patch is an uncommitted layer: every file it wrote
// is in that list whoever touched it last, so each one's content is
// fingerprinted when the patch is applied and compared with the disk later.
// Pure: main reads the files and hands over their fingerprints.
'use strict';

const crypto = require('crypto');
const { normalizeEolBuffer } = require('./git-update.cjs');

/**
 * A file's content, as a SHA-256 hex digest, or null for a file that is not
 * there. Line endings are normalised first, byte by byte, so a CRLF checkout
 * is not an edit and a file in another encoding is hashed as it is.
 *
 * @param {?Buffer} buf
 * @return {?string}
 */
function fingerprint(buf) {
	if (!buf) return null;
	return crypto.createHash('sha256').update(normalizeEolBuffer(buf)).digest('hex');
}

/**
 * The change's files the contributor has changed since it arrived, in the
 * change's order.
 *
 * For a patch, `fingerprints` (what it wrote, recorded at apply) against
 * `now` (the same paths' fingerprints read now). A patch recorded before
 * fingerprints were has none, and nothing is marked rather than everything.
 * For a pull request, its files that are among the `unsubmitted` changes.
 *
 * @param {Object}   root0
 * @param {?Object}  [root0.fingerprints] Path → fingerprint or null, from the patch's record.
 * @param {Object}   [root0.now]          Path → fingerprint or null, read now.
 * @param {string[]} [root0.prFiles]      The pull request's files.
 * @param {string[]} [root0.unsubmitted]  Every path changed from the branch's base.
 * @return {string[]}
 */
function editedSinceChange({ fingerprints = null, now = {}, prFiles = null, unsubmitted = [] } = {}) {
	if (fingerprints) {
		return Object.keys(fingerprints).filter((file) => (now[file] ?? null) !== fingerprints[file]);
	}
	if (Array.isArray(prFiles)) {
		const changed = new Set(unsubmitted);
		return prFiles.filter((file) => changed.has(file));
	}
	return [];
}

module.exports = { fingerprint, editedSinceChange };
