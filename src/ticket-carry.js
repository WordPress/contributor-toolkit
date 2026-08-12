'use strict';

/**
 * Whether a ticket is still sitting on the trunk it was born from, and what it
 * would take to bring it forward (#305).
 *
 * "Update to latest trunk" updates the *site*. Ticket branches deliberately
 * keep their own branch point, because a ticket's diff base has to stay fixed
 * or its patch would suddenly contain everything trunk moved. The consequence
 * is that nothing ever brings the ticket itself forward: a contributor coming
 * back to it is working on the trunk of the day they linked it, indefinitely,
 * and every pull request rebased since then fails to apply on it.
 *
 * This module is the read-only half of the answer. It says whether trunk has
 * moved past the ticket's base, and — path by path — what carrying the ticket's
 * work onto today's trunk would mean for each file. Nothing here writes: no ref
 * moves, no file is touched, no index entry changes. The carry itself is its own
 * change; this is what lets the app *offer* it honestly, and what lets the
 * ticket card say something true before anyone clicks anything.
 *
 * ## Detection cannot use ancestry
 *
 * Sites are `depth: 1` clones and the update re-fetches at depth 1, so the new
 * trunk tip shares no reachable history with the base a ticket was born on —
 * `isDescendent` walks parents that were never fetched and answers wrongly or
 * throws. So the question is asked of the two commit objects directly: a
 * different oid, and a committer date that is strictly newer. Both are already
 * on disk (`readTrunkInfo` and `baseProvenance` in main.js read the same
 * objects), so this costs two object reads and no network.
 *
 * Equal timestamps answer "not behind". Trunk landing a commit in the same
 * second as the ticket's base is not a gap worth offering to close, and a clock
 * comparison that resolves ties in the other direction would offer a carry that
 * moves nothing.
 *
 * ## Classifying, rather than diffing everything
 *
 * The carry cannot route the whole ticket through a generated patch. A unified
 * diff cannot express a binary file, an empty add or delete (#311) or a file
 * that would not read — and the checkout onto new trunk *deletes* every path the
 * patch failed to represent, so a patch-only carry silently destroys work.
 *
 * So each changed path is classified by comparing its blob in the ticket's base
 * against the same path in today's trunk:
 *
 *   - **wholesale** — upstream did not touch it (same blob oid, or absent from
 *     both). The base side is byte-identical, so the ticket's version *is* the
 *     result: its bytes and its mode are carried over with no text matching at
 *     all. That is the route binaries, empty files and deletions survive.
 *   - **merge** — upstream changed it too. Only these need a three-way-ish
 *     reconciliation, and only these can genuinely conflict.
 *   - **refuse** — upstream deleted a file the ticket edited, or both sides
 *     added the same path, or the file would not read. Same rule
 *     `staleTouchedPaths` (github-pr.cjs) already encodes for pull requests:
 *     replacing those wholesale would silently revert somebody else's work,
 *     and reproducing bytes that could not be read is not something to guess at.
 *
 * A file both sides added is refused even when the two additions happen to be
 * identical. Comparing the ticket's own blob to decide would mean hashing the
 * worktree on a read that the ticket card polls, to spare a case that costs the
 * contributor one refusal they can act on — the trade is not worth the scan.
 *
 * No Electron dependency, so `node --test` can exercise it against real
 * repositories (same rationale as ticket-branches.js and trunk-update.js).
 * main.js owns the IPC plumbing and the electron-store writes.
 */

const fs = require('fs');
const git = require('isomorphic-git');
const { entryInCommit } = require('./pr-files.cjs');
// The vocabulary is the renderer's, for the reason BASE_STATUS is: both sides
// name these and only one of the two may depend on `isomorphic-git`.
const { CARRY_STATE, REFUSAL } = require('./renderer/carry-note.cjs');

/**
 * The committer timestamp of a commit, in seconds, or null when it will not
 * read. Committer rather than author, matching `readTrunkInfo`: a rebased or
 * cherry-picked upstream commit keeps its original author date, which would
 * make today's trunk look older than a ticket linked last week.
 *
 * @param {string} dir
 * @param {string} oid
 * @return {Promise<number|null>}
 */
async function commitTime(dir, oid) {
	try {
		const { commit } = await git.readCommit({ fs, dir, oid });
		return commit.committer.timestamp;
	} catch {
		return null;
	}
}

/**
 * Whether the site's trunk has moved past the commit this ticket was born on.
 *
 * @param {string}  dir
 * @param {Object}  root0
 * @param {?string} root0.baseOid  The ticket's branch point.
 * @param {?string} root0.trunkOid Where the site's `trunk` points now.
 * @return {Promise<{state: string, baseDate: ?string, trunkDate: ?string}>}
 */
async function trunkMovedPast(dir, { baseOid, trunkOid } = {}) {
	if (!baseOid || !trunkOid) return { state: CARRY_STATE.UNKNOWN, baseDate: null, trunkDate: null };
	if (baseOid === trunkOid) return { state: CARRY_STATE.CURRENT, baseDate: null, trunkDate: null };

	const [baseSeconds, trunkSeconds] = await Promise.all([
		commitTime(dir, baseOid),
		commitTime(dir, trunkOid)
	]);
	// A base commit that will not read is the common shape of this: a site
	// adopted from disk, or a registry entry naming an object this clone never
	// had. Saying "unknown" is what keeps the card from claiming a ticket is
	// current when the app has no idea.
	if (baseSeconds === null || trunkSeconds === null) {
		return { state: CARRY_STATE.UNKNOWN, baseDate: null, trunkDate: null };
	}

	const iso = (seconds) => new Date(seconds * 1000).toISOString();
	return {
		state: trunkSeconds > baseSeconds ? CARRY_STATE.BEHIND : CARRY_STATE.CURRENT,
		baseDate: iso(baseSeconds),
		trunkDate: iso(trunkSeconds)
	};
}

/**
 * What one path was at a commit — its oid, its mode and whether it is a file at
 * all — or the fact that the read itself failed. Absence is read from the tree,
 * never from empty bytes (#311).
 *
 * The two are kept apart for the reason #308 keeps `unreadable` apart from
 * `trunk`: folded together, a damaged object store reads as "neither side has
 * this path", which classifies it as one upstream never touched — and then
 * writes the ticket's version over whatever upstream really has there. A read
 * that failed is a refusal, not a licence.
 *
 * A directory counts as present. It is not a file the ticket's version can
 * replace, and reading it as absence would try to write a file over a tree.
 *
 * @param {string}  dir
 * @param {?string} commitOid
 * @param {string}  filepath
 * @return {Promise<{readable: boolean, entry: ?{oid: string, mode: string, type: string}}>}
 */
async function blobEntryAt(dir, commitOid, filepath) {
	if (!commitOid) return { readable: true, entry: null };
	try {
		return { readable: true, entry: await entryInCommit({ git, fs, dir }, commitOid, filepath) };
	} catch {
		return { readable: false, entry: null };
	}
}

/**
 * How each of the ticket's changed paths would be carried onto today's trunk.
 *
 * Pure reads: two tree walks per path, both against commits already in the
 * object store. Deliberately not a whole-tree diff of trunk against the base —
 * that is tens of thousands of entries on a `wordpress-develop` clone, to answer
 * a question about the handful of files the ticket actually touched.
 *
 * A deletion is its own question and is answered first. Whether the ticket
 * *removed* a path is not something its bytes can say (#311), so it arrives as a
 * flag from the walk — and without it, a file both sides deleted looks exactly
 * like a file the ticket edited and upstream deleted, which would refuse the
 * whole carry over two sides that agree.
 *
 * @param {string}  dir
 * @param {Object}  root0
 * @param {Array}   root0.files    `{ path, unreadable, binary, deleted }` per changed path.
 * @param {?string} root0.baseOid  The ticket's branch point.
 * @param {?string} root0.trunkOid Where the site's `trunk` points now.
 * @return {Promise<{wholesale: string[], merge: string[], settled: string[], refused: Array<{path: string, reason: string}>}>}
 */
async function classifyCarry(dir, { files = [], baseOid, trunkOid } = {}) {
	const wholesale = [];
	const merge = [];
	const settled = [];
	const refused = [];

	for (const file of files) {
		const filepath = file && file.path;
		if (!filepath) continue;
		if (file.unreadable) {
			refused.push({ path: filepath, reason: REFUSAL.UNREADABLE });
			continue;
		}

		const base = await blobEntryAt(dir, baseOid, filepath);
		const tip = await blobEntryAt(dir, trunkOid, filepath);
		if (!base.readable || !tip.readable) {
			refused.push({ path: filepath, reason: REFUSAL.UNREADABLE });
			continue;
		}

		if (file.deleted) {
			// The ticket removed it. Nothing is carried *into* the file, so the
			// only question is whether upstream still has the version it removed.
			if (!base.entry) continue;
			if (!tip.entry) settled.push(filepath);
			else if (base.entry.oid === tip.entry.oid) wholesale.push(filepath);
			else refused.push({ path: filepath, reason: REFUSAL.DELETED_BUT_CHANGED });
			continue;
		}

		if (!base.entry && !tip.entry) {
			// Neither side has it: the ticket added it, and upstream did not.
			wholesale.push(filepath);
		} else if (!base.entry) {
			refused.push({ path: filepath, reason: REFUSAL.ADDED_BOTH });
		} else if (!tip.entry) {
			refused.push({ path: filepath, reason: REFUSAL.UPSTREAM_DELETED });
		} else if (base.entry.oid === tip.entry.oid) {
			// Byte-identical on the base side, so the ticket's version *is* the
			// result — binary or not, this is the route that carries it losslessly.
			wholesale.push(filepath);
		} else if (file.binary) {
			// Both sides changed the same binary. There is no replaying one change
			// onto the other: a unified diff cannot carry the ticket's version, and
			// writing it wholesale would drop upstream's.
			refused.push({ path: filepath, reason: REFUSAL.BINARY_CONFLICT });
		} else {
			merge.push(filepath);
		}
	}

	return { wholesale, merge, settled, refused };
}

/**
 * The whole read-only answer: is this ticket behind, and what would carrying it
 * mean file by file.
 *
 * The changed paths come from the caller rather than being walked here, so the
 * carry, the card's note (#239) and the patch modal all read one walk decided
 * one way — `collectCarryCandidates` in main.js is that walk, with the same base
 * and the same filter as the note's, and the flags the classifier needs added
 * rather than a second opinion formed here.
 *
 * They arrive as a function rather than a list so the walk is never paid for
 * when the answer does not need it. `statusMatrix` hashes every non-ignored file
 * in a `wordpress-develop` checkout — thousands of them, on the process that
 * draws the window — and a ticket that is already on today's trunk is the common
 * case. Two commit reads answer that one. (A ticket that *is* behind still pays
 * one walk here on top of the note's; sharing them across the two channels is a
 * follow-up, not something this can do from inside the module.)
 *
 * @param {string}   dir
 * @param {Object}   root0
 * @param {Function} root0.loadFiles Resolves to `{ path, unreadable, binary, deleted }` per changed path.
 * @param {?string}  root0.baseOid
 * @param {?string}  root0.trunkOid
 * @return {Promise<Object>}
 */
async function carryStatus(dir, { loadFiles = async () => [], baseOid, trunkOid } = {}) {
	const moved = await trunkMovedPast(dir, { baseOid, trunkOid });
	// Classification is only meaningful once trunk has actually moved: against
	// an unmoved trunk every path classifies wholesale, which would read as "3
	// files would carry cleanly" beside a carry that does nothing at all.
	if (moved.state !== CARRY_STATE.BEHIND) {
		return {
			...moved,
			baseOid: baseOid || null,
			trunkOid: trunkOid || null,
			wholesale: [], merge: [], settled: [], refused: []
		};
	}
	const classified = await classifyCarry(dir, { files: await loadFiles(), baseOid, trunkOid });
	return { ...moved, baseOid, trunkOid, ...classified };
}

module.exports = {
	REFUSAL,
	CARRY_STATE,
	commitTime,
	trunkMovedPast,
	blobEntryAt,
	classifyCarry,
	carryStatus
};
