// Removes a directory tree, including the parts Git protects.
//
// A real Git marks its loose object files read-only, and Windows refuses to
// unlink a read-only file. `fs.rm` with `force: true` never clears the
// attribute — `force` only forgives a path that is already gone — and its
// `maxRetries` cannot help either, because a retry does not change the file.
// fs-extra 11 is a bare `fs.rm(recursive, force)`, so it inherits the same
// blind spot. On POSIX the analogue is a directory without the write bit,
// which blocks unlinking its entries the same way.
//
// Today the app gets away with plain removal because isomorphic-git does not
// set the attribute. Any real Git writing into a checkout plants it — a mentor
// making a commit with their own tools does — and from then on `sites:delete`
// leaves the tree behind on Windows (#381).
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
 * Restores the write bit on everything under `dir`, directories first so the
 * walk can enter them. Errors on individual entries are ignored: a path that
 * cannot be chmodded will fail the removal that follows, which is the honest
 * place for the failure to surface.
 *
 * @param {string} dir
 * @param {Object} fs
 */
async function makeWritable(dir, fs) {
	let entries;
	try {
		await fs.promises.chmod(dir, 0o777);
		entries = await fs.promises.readdir(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const child = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			await makeWritable(child, fs);
		} else {
			try { await fs.promises.chmod(child, 0o666); } catch {}
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
	const options = { recursive: true, force: true, maxRetries: 3, retryDelay: 100 };
	try {
		await fs.promises.rm(dir, options);
	} catch (error) {
		if (!shouldClearAttributes(error)) throw error;
		await makeWritable(dir, fs);
		await fs.promises.rm(dir, options);
	}
}

module.exports = { shouldClearAttributes, removeTree };
