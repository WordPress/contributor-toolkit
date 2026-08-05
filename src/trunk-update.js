'use strict';

/**
 * Git operations for the trunk update path (#94). No Electron dependency, so
 * `node --test` can exercise it against real repositories (same rationale as
 * npm-runner.js). All git I/O goes through isomorphic-git — the app never
 * shells out to a git binary.
 *
 * main.js owns the IPC plumbing and electron-store writes; the pure
 * statusMatrix/oid decision rules live in git-update.cjs.
 */

const path = require('path');
const fs = require('fs');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const {
	isDirtyFromStatusMatrix,
	staleStagedPaths,
	lockfileChangedFromBlobOids,
	normalizeEolBuffer
} = require('./git-update.cjs');

/**
 * A site checked out by native git on Windows (default core.autocrlf=true,
 * set globally — which isomorphic-git never reads) has CRLF on disk while
 * wordpress-develop's blobs are LF-only. Without this, statusMatrix hashes
 * the raw CRLF bytes and reports every text file as modified (~5k phantom
 * changes; isomorphic-git#1275). Writing core.autocrlf into the site's LOCAL
 * config makes isomorphic-git strip CRLF before hashing workdir files. LF
 * checkouts are unaffected. Called before every status/patch/update git op
 * so pre-existing sites are covered, not just new clones.
 */
async function ensureAutocrlf(dir) {
	try {
		const current = await git.getConfig({ fs, dir, path: 'core.autocrlf' });
		if (current !== 'true') {
			await git.setConfig({ fs, dir, path: 'core.autocrlf', value: 'true' });
		}
	} catch {}
}

/**
 * The commit the site's HEAD points at; its committer date is the age of the
 * trunk snapshot. One object read, no network.
 */
async function readTrunkInfo(dir) {
	const trunkOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
	const { commit } = await git.readCommit({ fs, dir, oid: trunkOid });
	const trunkDate = new Date(commit.committer.timestamp * 1000).toISOString();
	return { trunkOid, trunkDate };
}

async function readLockfileBlobOid(dir, oid) {
	try {
		const { oid: blobOid } = await git.readBlob({ fs, dir, oid, filepath: 'package-lock.json' });
		return blobOid;
	} catch {
		return null;
	}
}

// statusMatrix's autocrlf normalization only covers valid-UTF8 files, so
// non-UTF8 text fixtures (wordpress-develop's Big5/Latin-1 encoding tests)
// smudged to CRLF by a native-git checkout still hash as modified. Confirm
// with a byte-level, encoding-agnostic comparison.
async function isCrlfOnlyChange(dir, headOid, filepath) {
	try {
		const { blob } = await git.readBlob({ fs, dir, oid: headOid, filepath });
		const work = await fs.promises.readFile(path.join(dir, filepath));
		return normalizeEolBuffer(Buffer.from(blob)).equals(normalizeEolBuffer(work));
	} catch {
		return false;
	}
}

/**
 * The files that genuinely differ from HEAD — statusMatrix candidates minus
 * CRLF-only false positives. What this returns is what the dirty-tree dialog
 * lists, and it matches what patch generation would emit.
 */
async function collectDirtyFiles(dir) {
	await ensureAutocrlf(dir);
	const matrix = await git.statusMatrix({ fs, dir });
	let headOid = null;
	try { headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}
	const files = [];
	for (const [filepath, head, workdir] of isDirtyFromStatusMatrix(matrix).rows) {
		if (head === 1 && workdir === 2 && headOid && await isCrlfOnlyChange(dir, headOid, filepath)) continue;
		files.push(filepath);
	}
	return files;
}

/**
 * Resets the worktree to HEAD. Files absent from HEAD are removed from the
 * index AND the workdir — a "discard" that leaves new files behind would put
 * them straight back into the next patch.
 */
async function discardChanges(dir) {
	await ensureAutocrlf(dir);
	const matrix = await git.statusMatrix({ fs, dir });
	for (const [filepath, head, workdir] of matrix) {
		if (head === 0) {
			try { await git.remove({ fs, dir, filepath }); } catch {}
			if (workdir !== 0) {
				try { await fs.promises.unlink(path.join(dir, filepath)); } catch {}
			}
		}
	}
	await git.checkout({ fs, dir, ref: 'trunk', force: true });
}

/**
 * Step 1 of the update chain: fetch the latest remote trunk and hard-reset
 * the site to it. Returns { upToDate, oldOid, newOid, lockfileChanged,
 * trunkDate }; throws with `error.stage` set to 'fetch' (nothing moved —
 * plain failure) or 'checkout' (HEAD moved over a partial tree — the caller
 * must persist the incomplete state).
 *
 * Shallow-clone safe: a depth-1 re-fetch negotiates a new shallow tip, and
 * the forced checkout resets tracked files while untracked ones survive.
 */
async function updateToLatestTrunk({ dir, url, onLog = () => {} }) {
	await ensureAutocrlf(dir);
	let stage = 'fetch';
	try {
		const oldOid = await git.resolveRef({ fs, dir, ref: 'HEAD' });
		onLog('Fetching latest trunk…\n');
		const fetchResult = await git.fetch({
			fs, http, dir, url,
			ref: 'trunk',
			singleBranch: true,
			depth: 1,
			tags: false,
			onProgress: (evt) => onLog(`${evt.phase || 'fetch'} ${evt.loaded || 0}/${evt.total || 0}\r`)
		});
		let newOid = fetchResult && fetchResult.fetchHead;
		if (!newOid) newOid = await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/trunk' });

		if (newOid === oldOid) {
			const { trunkDate } = await readTrunkInfo(dir);
			onLog('\nAlready up to date.\n');
			return { upToDate: true, oldOid, newOid, lockfileChanged: false, trunkDate };
		}

		// Decide the install step before touching the worktree.
		const lockfileChanged = lockfileChangedFromBlobOids(
			await readLockfileBlobOid(dir, oldOid),
			await readLockfileBlobOid(dir, newOid)
		);

		stage = 'checkout';
		// Patch generation stages untracked files and never unstages them;
		// checkout({force}) deletes workdir files that are in the index but
		// absent from the target tree, so drop those index entries first
		// (index-only — the workdir files survive).
		const matrix = await git.statusMatrix({ fs, dir });
		for (const filepath of staleStagedPaths(matrix)) {
			try { await git.remove({ fs, dir, filepath }); } catch {}
		}
		onLog(`\nResetting to latest trunk (${newOid.slice(0, 7)})…\n`);
		await git.writeRef({ fs, dir, ref: 'refs/heads/trunk', value: newOid, force: true });
		await git.checkout({
			fs, dir, ref: 'trunk', force: true,
			onProgress: (evt) => onLog(`${evt.phase || 'checkout'} ${evt.loaded || 0}/${evt.total || 0}\r`)
		});

		const { trunkDate } = await readTrunkInfo(dir);
		onLog(`\nNow on trunk as of ${trunkDate}.\n`);
		return { upToDate: false, oldOid, newOid, lockfileChanged, trunkDate };
	} catch (e) {
		if (e && typeof e === 'object') e.stage = stage;
		throw e;
	}
}

module.exports = {
	ensureAutocrlf,
	readTrunkInfo,
	collectDirtyFiles,
	discardChanges,
	updateToLatestTrunk
};
