// Removes a directory tree, including the parts Git protects.
//
// A real Git marks its loose object files read-only, and what that does to a
// removal differs by platform — with a different hole in each default. On
// Windows, Node's own `fs.rm` chmods an entry it failed to delete and tries
// again (inherited from rimraf when core absorbed it), so the read-only file
// itself is survivable there; what has no answer is an entry something still
// holds open, because `fse.remove` passes no retry budget at all. On POSIX
// nothing clears a directory whose write bit is missing, so the same
// protected checkout fails with EACCES and no recovery of any kind. The #364
// spike hit EPERM on every packaged Windows run; the CI suite proves the
// POSIX half.
//
// Today the app mostly gets away with plain removal because isomorphic-git
// sets no attribute. Any real Git writing into a checkout changes that — a
// mentor making a commit with their own tools does — and `sites:delete`
// swallowed whatever went wrong besides (#381).
//
// The shape: try the cheap removal first, and only when it fails with a
// permission error walk whatever survived, restore the write bit, and remove
// once more. The walk is the recovery path, so the common case pays nothing.
// Anything that still fails after that propagates: the caller decides what a
// failed deletion means, this module only refuses to hide one.

'use strict';

const fsDefault = require('fs');
const path = require('path');

/**
 * Pure decision: does this removal error call for clearing attributes and
 * retrying? Only a permission error does — anything else (a path that is a
 * file, a disk error) would fail the same way twice.
 *
 * @param {?Object} error
 * @return {boolean}
 */
function shouldClearAttributes(error) {
	return !!error && (error.code === 'EPERM' || error.code === 'EACCES');
}

/**
 * Restores the owner write bit on everything under `dir`, directories first so
 * the walk can enter them. Owner-only on purpose: `0o700`/`0o600` clears the
 * read-only attribute on Windows and unblocks POSIX unlinking just as well as
 * wider modes, without leaving a world-writable tree behind if the removal
 * still fails. Errors on individual entries are ignored: a path that cannot be
 * chmodded will fail the removal that follows, which is the honest place for
 * the failure to surface.
 *
 * @param {string} dir
 * @param {Object} fs
 */
async function makeWritable(dir, fs) {
	// The chmod and the readdir fail independently: a directory whose mode
	// cannot be changed may still be readable, and its children deserve the
	// pass either way.
	try { await fs.promises.chmod(dir, 0o700); } catch {}
	let entries;
	try {
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		// chmod follows symlinks — there is no portable lchmod — so touching one
		// would change its target's mode, possibly outside this tree. `rm` does
		// not follow them when deleting, so they need no help anyway.
		if (entry.isSymbolicLink()) continue;
		const child = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await makeWritable(child, fs);
		} else {
			try { await fs.promises.chmod(child, 0o600); } catch {}
		}
	}
}

/**
 * Removes `dir` recursively, clearing read-only attributes if they are what
 * stands in the way. Resolves when the tree is gone (or never existed);
 * rejects with the underlying error when it could not be removed.
 *
 * @param {string} dir
 * @param {Object} [deps]    Injection point, so the tests can assert the
 *                           retry decision without staging a real EPERM.
 * @param {Object} [deps.fs]
 */
async function removeTree(dir, { fs = fsDefault } = {}) {
	// maxRetries 10 is inherited from the e2e teardown this replaces: an
	// ENOTEMPTY that only ever appeared on a macOS CI runner — a just-closed
	// app's last flush — needed that budget, and ENOTEMPTY is not a permission
	// code, so the attribute pass below does nothing for it. Retries are still
	// its only mitigation.
	const options = { recursive: true, force: true, maxRetries: 10, retryDelay: 100 };
	try {
		await fs.promises.rm(dir, options);
	} catch (error) {
		if (!shouldClearAttributes(error)) throw error;
		await makeWritable(dir, fs);
		await fs.promises.rm(dir, options);
	}
}

module.exports = { shouldClearAttributes, removeTree };
