'use strict';

/**
 * The working tree's changes, in the shape the GitHub tree API takes (#167).
 *
 * This is the second consumer of main.js's collectChangedFiles walk — the
 * first renders a `.diff` — and the two renderings must not disagree about
 * what changed. That parity is why the EOL handling here mirrors the patch
 * builder's instead of trusting the bytes on disk:
 *
 * A Windows checkout sits on disk as CRLF (`ensureAutocrlf` sets
 * core.autocrlf=true, and native-git checkouts arrive that way). Upstream's
 * blobs are LF-only. Uploading raw workdir bytes would publish a pull request
 * where every line of an edited file is rewritten — and worse, the non-UTF-8
 * files that statusMatrix's autocrlf handling misses (wordpress-develop's
 * encoding fixtures; see isCrlfOnlyChange in trunk-update.js) would appear as
 * changed files the contributor never touched. So text content is normalised
 * to LF before upload, and a file whose only difference is line endings is
 * not a change at all. Binary content — anything with a NUL byte on either
 * side — is carried byte-for-byte, which is the one thing the `.diff` cannot
 * do.
 *
 * Kept out of main.js and behind injected dependencies (platform, stat, git)
 * so both sides of the platform split below are exercised by `node --test`
 * from one machine — the house pattern, per win-spawn-patch.test.cjs.
 */

const path = require('path');
const { normalizeEolBuffer } = require('./git-update.cjs');

// The two modes a file in this repo can have. Git records nothing else for a
// blob except symlinks, which statusMatrix reports as ordinary files and
// wordpress-develop does not use.
const GIT_MODE_FILE = '100644';
const GIT_MODE_EXECUTABLE = '100755';

/**
 * The same heuristic the patch builder uses: a NUL byte means binary. Null and
 * missing buffers are not binary — they are absence.
 *
 * @param {Buffer|null} buf
 * @return {boolean}
 */
function isProbablyBinary(buf) {
	return Buffer.isBuffer(buf) && buf.includes(0);
}

/**
 * The mode git recorded for one path in one commit, read by walking that
 * path's trees rather than the whole commit: a full walk of wordpress-develop
 * is tens of thousands of entries to answer a question about five files.
 *
 * @param {Object} deps     `{ git, fs, dir }`
 * @param {string} oid
 * @param {string} filepath
 * @return {Promise<string|null>}
 */
async function modeInCommit(deps, oid, filepath) {
	const { git, fs, dir } = deps;
	const { commit } = await git.readCommit({ fs, dir, oid });
	let treeOid = commit.tree;
	const segments = filepath.split('/');
	for (let i = 0; i < segments.length; i++) {
		const { tree } = await git.readTree({ fs, dir, oid: treeOid });
		const entry = tree.find((e) => e.path === segments[i]);
		if (!entry) return null;
		if (i === segments.length - 1) return entry.mode;
		treeOid = entry.oid;
	}
	return null;
}

/**
 * The executable bit, which git records and a tree entry has to carry.
 *
 * On POSIX the working tree is authoritative — it is what the contributor
 * actually has. Windows has no executable bit at all, so a file that arrived
 * as 100755 would be silently demoted to 100644 by anything that asked the
 * filesystem; there, the mode git already recorded in HEAD is the truth. An
 * added file on Windows has no recorded mode and no bit to read, so 100644 is
 * the only answer available, and the right one for source.
 *
 * @param {Object} deps `{ git, fs, dir, headOid, platform, stat }`
 * @param {Object} file One collectChangedFiles entry.
 * @return {Promise<string>}
 */
async function fileModeForEntry(deps, file) {
	const { dir, headOid, platform } = deps;
	const stat = deps.stat || deps.fs.promises.stat;
	if (platform !== 'win32' && file.inWorkdir) {
		try {
			const stats = await stat(path.join(dir, file.path));
			// eslint-disable-next-line no-bitwise -- 0o111 is the executable bit for owner, group and other; masking is how a POSIX mode is read.
			const executable = (stats.mode & 0o111) !== 0;
			return executable ? GIT_MODE_EXECUTABLE : GIT_MODE_FILE;
		} catch {
			// Fall through to the recorded mode.
		}
	}
	if (file.inHead && headOid) {
		const recorded = await modeInCommit(deps, headOid, file.path).catch(() => null);
		if (recorded) return recorded;
	}
	return GIT_MODE_FILE;
}

/**
 * collectChangedFiles entries → tree API entries.
 *
 * Deletions are entries with null content — the tree API expresses them as a
 * null sha, and it is why the pull request carries deletions the `.diff`
 * still drops (#174). Files present but unreadable are skipped, since the
 * alternatives are committing a deletion or an empty file under that path.
 *
 * @param {Array}  files
 * @param {Object} deps  `{ git, fs, dir, headOid, platform, stat }`
 * @return {Promise<Array<{path: string, kind: string, content: Buffer|null, mode: string}>>}
 */
async function buildPullRequestEntries(files, deps) {
	const entries = [];
	for (const file of files) {
		const mode = await fileModeForEntry(deps, file);
		if (!file.inWorkdir) {
			entries.push({ path: file.path, kind: 'delete', content: null, mode });
			continue;
		}
		if (!file.work) continue;

		const binary = isProbablyBinary(file.base) || isProbablyBinary(file.work);
		// Text goes up LF-normalised, exactly as the patch renders it; the
		// comparison happens on the same normalised bytes so a CRLF-only
		// difference is no difference. Binary is compared and carried raw.
		const base = binary || !file.base ? file.base : normalizeEolBuffer(file.base);
		const work = binary ? file.work : normalizeEolBuffer(file.work);
		if (base && base.equals(work)) continue;

		entries.push({
			path: file.path,
			kind: file.inHead ? 'modify' : 'add',
			content: work,
			mode
		});
	}
	return entries;
}

module.exports = {
	GIT_MODE_FILE,
	GIT_MODE_EXECUTABLE,
	isProbablyBinary,
	modeInCommit,
	fileModeForEntry,
	buildPullRequestEntries
};
