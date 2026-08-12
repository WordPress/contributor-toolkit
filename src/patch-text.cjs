'use strict';

/**
 * Rendering one file's change as a unified-diff section.
 *
 * Lifted out of main.js when the carry (#305) needed the same rendering for a
 * different pair of sides — the ticket's own change, base commit against parked
 * commit, rather than base commit against working tree. Two builders would have
 * meant two answers to the `/dev/null` question below, and this app reads its
 * own patches back.
 *
 * Pure and dependency-light so `node --test` can drive it directly.
 */

const JsDiff = require('diff');

/**
 * Drops the `\ No newline at end of file` marker jsdiff adds to a deletion
 * whether or not it is true (#85).
 *
 * jsdiff decides the marker from the *new* side, and a deletion's new side is
 * the empty string — which it reads as "no trailing newline", so every deletion
 * comes out claiming the removed file lacked one. The marker attaches to the
 * preceding `-` line, so on a file that did end in a newline it asserts
 * something false about the old side and `git apply` refuses the patch — the
 * whole patch, since it is all-or-nothing, unrelated files included. `patch(1)`
 * tolerates it; the destination is a Trac ticket read by a committer running
 * `git apply`, so tolerance elsewhere is not enough.
 *
 * @param {string}  section One createTwoFilesPatch section.
 * @param {boolean} phantom True when the marker is jsdiff's invention.
 * @return {string} The section, marker removed only when it was not earned.
 */
function withoutPhantomNoNewline(section, phantom) {
	if (!phantom) return section;
	return section.replace(/\n\\ No newline at end of file\n$/, '\n');
}

/**
 * One file's section of a unified diff.
 *
 * `/dev/null` names whichever side does not exist, and it is not decoration:
 * `classify()` in patch-plan.cjs reads an add or a delete from the filename
 * alone, never from "the hunk removes every line". Named `b/<path>`, a deletion
 * comes back through this app's own reader as a modification, and the applier
 * writes an empty file where the patch said remove.
 *
 * Which side exists is the caller's answer — the walk's status codes or a tree
 * lookup — never the buffers'. An added or deleted *empty* file is exactly the
 * case where the bytes say "unchanged" and the codes say otherwise (#85, #311).
 *
 * No blank line is added after a section. jsdiff keeps consuming lines past a
 * `\ No newline at end of file` marker, so a separator becomes a phantom empty
 * context line and the section stops applying to any file that does not end in
 * a newline — the file it just described. Each section already ends in one.
 *
 * @param {Object}  root0
 * @param {string}  root0.path
 * @param {boolean} root0.inOld True when the old side has the file.
 * @param {boolean} root0.inNew True when the new side has the file.
 * @param {string}  root0.a     Old contents, '' when absent.
 * @param {string}  root0.b     New contents, '' when absent.
 * @return {string}
 */
function unifiedSection({ path, inOld, inNew, a, b }) {
	const oldName = inOld ? `a/${path}` : '/dev/null';
	const newName = inNew ? `b/${path}` : '/dev/null';
	return withoutPhantomNoNewline(
		JsDiff.createTwoFilesPatch(oldName, newName, a, b, '', '', { context: 3 }),
		!inNew && a.endsWith('\n')
	);
}

module.exports = { withoutPhantomNoNewline, unifiedSection };
