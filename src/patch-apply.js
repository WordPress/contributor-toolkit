'use strict';

/**
 * Applying someone else's patch to a checkout (issue #11).
 *
 * There is no `git apply` available: the app never shells out to a git binary,
 * and isomorphic-git has no apply primitive. So hunks are matched and written
 * here, using the `diff` package the app already bundles for the generating
 * side.
 *
 * The rule that shapes everything below is **all or nothing**. A patch that
 * half-applies is worse than one that does not apply at all: the contributor
 * would build it, test it, and draw conclusions from a tree that matches
 * neither trunk nor the patch. Every file is resolved in memory first — and
 * because a write can still fail on the way out (a directory that is really a
 * file, a read-only attribute, Windows holding a file open, a full disk), the
 * previous contents are captured during resolution and restored if any write
 * throws.
 */

const fs = require('fs');
const path = require('path');
const JsDiff = require('diff');
const { ensureAutocrlf } = require('./trunk-update');
const { normalizeEol } = require('./git-update.cjs');
const { parsePatchFiles } = require('./patch-plan.cjs');

/**
 * Resolves a patch's repo-relative path inside the site directory, refusing
 * anything that climbs out of it. A patch is untrusted input downloaded from a
 * ticket, and `../../` in a header would otherwise write anywhere on disk.
 *
 * `path.resolve` normalises `..` but not symlinks, and a checkout contains
 * plenty of those, so the deepest ancestor that exists is realpath-ed before
 * the comparison. Otherwise a path leading through a symlinked directory
 * passes a purely lexical check and lands outside the site folder.
 *
 * @param {string} dir
 * @param {string} relPath
 * @return {string|null} Absolute path, or null if it escapes the directory.
 */
function resolveInside(dir, relPath) {
	let root;
	try { root = fs.realpathSync(path.resolve(dir)); } catch { root = path.resolve(dir); }

	const lexical = path.resolve(root, relPath);
	// Walk up to the nearest existing entry, resolve that for real, then put the
	// not-yet-existing remainder back on. lstat, not existsSync: existsSync
	// follows links and reports a dangling symlink as absent, so the walk would
	// step past a symlink pointing outside the checkout and hand back its lexical
	// path — which the writer would then follow out of the tree.
	let existing = lexical;
	const trailing = [];
	const entryExists = (p) => { try { fs.lstatSync(p); return true; } catch { return false; } };
	while (!entryExists(existing)) {
		const parent = path.dirname(existing);
		if (parent === existing) break;
		trailing.unshift(path.basename(existing));
		existing = parent;
	}
	// The deepest existing entry is realpath-ed for real. A symlink here that
	// dangles (realpath throws) or resolves outside root is an escape, not a
	// path to write through — fail closed rather than falling back to lexical.
	let realExisting;
	try { realExisting = fs.realpathSync(existing); } catch { return null; }
	const abs = path.join(realExisting, ...trailing);

	if (abs !== root && !abs.startsWith(root + path.sep)) return null;
	return abs;
}

/**
 * The line ending a file already uses, so applying a patch does not silently
 * rewrite a genuinely-CRLF file to LF. wordpress-develop carries fixtures whose
 * line endings are the thing under test.
 *
 * @param {string} text
 * @return {string}
 */
function dominantEol(text) {
	const crlf = (text.match(/\r\n/g) || []).length;
	if (!crlf) return '\n';
	const lf = (text.match(/\n/g) || []).length;
	return crlf * 2 >= lf ? '\r\n' : '\n';
}

/**
 * Inverts one parsed file so the patch can be undone.
 *
 * Reversing through `formatPatch` would be simpler but wrong: it emits the
 * headers swapped (`--- b/…`, `+++ a/…`), which no longer look like a git
 * patch to the prefix-stripping in patch-plan.cjs, and the paths come back
 * carrying a literal `b/`. Reversing the hunks while keeping the paths already
 * resolved on the way in avoids the round trip entirely.
 *
 * @param {Object} file
 * @return {Object}
 */
function reverseFile(file) {
	const reversed = JsDiff.reversePatch(file.patch);
	const INVERSE = { add: 'delete', delete: 'add' };
	const kind = INVERSE[file.kind] || file.kind;
	const oldPath = file.newPath;
	const newPath = file.oldPath;
	return {
		...file,
		kind,
		oldPath,
		newPath,
		path: kind === 'delete' ? oldPath : newPath,
		hunks: reversed.hunks || [],
		patch: reversed
	};
}

/**
 * Works out what one file's new content should be, without touching disk.
 * Also captures what is there now, so a failed write can be rolled back.
 *
 * @param {string} dir
 * @param {Object} file
 * @return {Object}
 */
function resolveFile(dir, file) {
	const target = resolveInside(dir, file.path);
	if (!target) return { error: `${file.path} points outside the site folder` };

	if (file.kind === 'delete') {
		if (!fs.existsSync(target)) return { error: `${file.path} is already gone, so the patch cannot remove it` };
		const previous = fs.readFileSync(target);
		// Validate the file still matches what the patch expects to remove, so an
		// edit made after the preview fails all-or-nothing rather than being
		// silently deleted with the contributor's changes in it.
		if (file.hunks && file.hunks.length
			&& JsDiff.applyPatch(normalizeEol(previous.toString('utf8')), file.patch) === false) {
			return { error: `${file.path} has moved on since the patch was written, so it no longer applies` };
		}
		return { op: 'delete', abs: target, path: file.path, previous };
	}

	if (file.kind === 'add') {
		if (fs.existsSync(target)) return { error: `${file.path} already exists, so the patch cannot add it` };
		const content = JsDiff.applyPatch('', file.patch);
		if (content === false) return { error: `${file.path} could not be created from the patch` };
		return { op: 'write', abs: target, path: file.path, content, previous: null };
	}

	if (file.kind === 'rename') {
		const source = resolveInside(dir, file.oldPath);
		if (!source) return { error: `${file.oldPath} points outside the site folder` };
		if (!fs.existsSync(source)) return { error: `${file.oldPath} is not in this checkout, so the patch cannot move it` };
		if (fs.existsSync(target)) return { error: `${file.newPath} already exists, so the patch cannot move ${file.oldPath} onto it` };
		const originalBuf = fs.readFileSync(source);
		// A 100%-similarity rename has no hunks: the bytes move unchanged, so they
		// are carried as a Buffer. Git emits binary renames with no binary marker,
		// so this path is reachable for them — decoding through utf8 would corrupt
		// the file. Decode to text only when hunks actually need applying.
		let content = originalBuf;
		if (file.hunks.length) {
			const original = originalBuf.toString('utf8');
			const applied = JsDiff.applyPatch(normalizeEol(original), file.patch);
			if (applied === false) {
				return { error: `${file.oldPath} has moved on since the patch was written, so it no longer applies` };
			}
			content = applied.replace(/\n/g, dominantEol(original) === '\r\n' ? '\r\n' : '\n');
		}
		return {
			op: 'rename', abs: target, from: source, path: file.path, content,
			previous: null, previousFrom: originalBuf
		};
	}

	if (!fs.existsSync(target)) return { error: `${file.path} is not in this checkout, so the patch does not fit it` };

	// Matching happens on LF, the way the generating side normalises, so a CRLF
	// checkout does not make every context line miss — but the file is written
	// back with the endings it already had.
	const raw = fs.readFileSync(target, 'utf8');
	const applied = JsDiff.applyPatch(normalizeEol(raw), file.patch);
	if (applied === false) {
		return { error: `${file.path} has moved on since the patch was written, so it no longer applies` };
	}
	const content = dominantEol(raw) === '\r\n' ? applied.replace(/\n/g, '\r\n') : applied;
	return { op: 'write', abs: target, path: file.path, content, previous: Buffer.from(raw, 'utf8') };
}

/**
 * Puts back everything a failed run had already written.
 *
 * Returns the paths it could not restore. The same full-disk, lock, or
 * permission condition that broke a write can also break its undo, and the
 * caller must not claim a clean restore when the tree is actually unknown.
 *
 * @param {Array} done
 * @return {Array<string>} paths whose rollback failed (empty when fully restored)
 */
function rollback(done) {
	const errors = [];
	// Removing something that was never created — already gone, or its parent is
	// not even a directory — is the desired end state, not a failure. Actions are
	// registered before they mutate (so a half-done one is still undoable), which
	// means rollback can see ones that never ran; only a content restoration that
	// cannot be written back is a real, unrecoverable loss.
	const removeQuietly = (target) => {
		try { fs.rmSync(target, { force: true }); }
		catch (e) { if (!e || (e.code !== 'ENOTDIR' && e.code !== 'ENOENT')) throw e; }
	};
	for (const action of done.reverse()) {
		try {
			if (action.op === 'rename' && action.previousFrom !== null) {
				fs.mkdirSync(path.dirname(action.from), { recursive: true });
				fs.writeFileSync(action.from, action.previousFrom);
				removeQuietly(action.abs);
				continue;
			}
			if (action.previous === null) {
				removeQuietly(action.abs);
				continue;
			}
			fs.mkdirSync(path.dirname(action.abs), { recursive: true });
			fs.writeFileSync(action.abs, action.previous);
		} catch (e) {
			errors.push(`${action.path}: ${String(e && e.message ? e.message : e)}`);
		}
	}
	return errors;
}

/**
 * Applies (or reverses) a patch across a checkout.
 *
 * Binary files are skipped and named rather than failing the whole patch: a
 * text diff cannot carry their content, and refusing an otherwise-good pull
 * request over an image would help nobody. Everything else is all or nothing.
 *
 * @param {Object}   root0
 * @param {string}   root0.dir
 * @param {string}   root0.patchText
 * @param {boolean}  [root0.reverse]
 * @param {Function} [root0.onLog]
 * @return {Promise<Object>}
 */
async function applyPatchToDir({ dir, patchText, reverse = false, onLog = () => {} }) {
	const parsed = parsePatchFiles(patchText);
	if (!parsed.ok) return { ok: false, error: parsed.error };

	await ensureAutocrlf(dir);

	const files = reverse ? parsed.files.map(reverseFile) : parsed.files;
	const actions = [];
	const skipped = [];
	const failures = [];

	for (const file of files) {
		if (file.kind === 'binary') {
			skipped.push(file.path);
			continue;
		}
		const resolved = resolveFile(dir, file);
		if (resolved.error) {
			failures.push(resolved.error);
			continue;
		}
		actions.push(resolved);
	}

	if (failures.length) {
		onLog(`\nThe patch was not applied — the checkout is unchanged.\n${failures.map((f) => `  • ${f}\n`).join('')}`);
		return { ok: false, error: failures[0], failures, applied: [], skipped };
	}

	if (!actions.length && !skipped.length) {
		return { ok: false, error: 'The patch does not change any files.', applied: [], skipped };
	}

	// Every file resolved cleanly, so the writes below are the first thing to
	// touch the working tree — and the only place a partial result could still
	// appear, which is what the rollback is for.
	const done = [];
	try {
		for (const action of actions) {
			// Registered before its mutations, not after: a rename that writes its
			// destination and then throws removing the source would otherwise be
			// invisible to rollback and leave a partial patch behind. Undoing an
			// action whose mutations had not started yet is harmless.
			done.push(action);
			if (action.op === 'delete') {
				fs.rmSync(action.abs, { force: true });
			} else if (action.op === 'rename') {
				fs.mkdirSync(path.dirname(action.abs), { recursive: true });
				fs.writeFileSync(action.abs, action.content);
				fs.rmSync(action.from, { force: true });
			} else {
				fs.mkdirSync(path.dirname(action.abs), { recursive: true });
				fs.writeFileSync(action.abs, action.content);
			}
		}
	} catch (e) {
		const recovery = rollback(done);
		const message = `writing ${String(e && e.message ? e.message : e)}`;
		if (recovery.length) {
			onLog(`\nThe patch could not be written, and the checkout could not be fully put back — it is in an unknown state. Could not undo: ${recovery.join('; ')}\n`);
			return { ok: false, error: message, applied: [], skipped, rolledBack: false, recovery };
		}
		onLog(`\nThe patch could not be written, so the checkout was put back as it was: ${message}\n`);
		return { ok: false, error: message, applied: [], skipped, rolledBack: true };
	}

	// New files are deliberately left unstaged. Staging them is what leaves the
	// residue that updateToLatestTrunk has to clear before a force checkout
	// (see staleStagedPaths in git-update.cjs), and an unstaged new file still
	// shows up in the patch the contributor generates afterwards.
	const applied = actions.map((a) => a.path);
	onLog(`\n${reverse ? 'Reverted' : 'Applied'} ${applied.length} file${applied.length === 1 ? '' : 's'}.\n`);
	if (skipped.length) {
		onLog(`Skipped ${skipped.length} binary file${skipped.length === 1 ? '' : 's'} the app cannot apply: ${skipped.join(', ')}\n`);
	}

	return { ok: true, applied, skipped };
}

module.exports = { applyPatchToDir, resolveInside, reverseFile, dominantEol, rollback };
