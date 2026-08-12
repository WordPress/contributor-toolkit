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
 * So this module answers three things, and the file is in that order. Whether
 * trunk has moved past the ticket's base. What carrying the ticket's work onto
 * today's trunk would mean for each file — both of those are pure reads, which
 * is what lets the app *offer* the carry honestly and lets the ticket card say
 * something true before anyone clicks anything. And then, below the divider,
 * the carry itself, whose ordering is documented on `carryTicketForward`
 * because the ordering *is* the safety property.
 *
 * The carry is offered and confirmed, never automatic and never part of the
 * site update — the app does not silently rebase anyone (#309).
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
const path = require('path');
const git = require('isomorphic-git');
const { entryInCommit, modeInCommit, GIT_MODE_EXECUTABLE } = require('./pr-files.cjs');
const { normalizeEol, normalizeEolBuffer } = require('./git-update.cjs');
const { unifiedSection } = require('./patch-text.cjs');
const { applyPatchToDir, diagnoseRemoval } = require('./patch-apply.js');
const {
	TRUNK,
	WIP_MESSAGE,
	WIP_AUTHOR,
	parkCurrentWork,
	switchToBranch,
	forceCheckout
} = require('./ticket-branches.js');
// The vocabulary is the renderer's, for the reason BASE_STATUS is: both sides
// name these and only one of the two may depend on `isomorphic-git`.
const { CARRY_STATE, CARRY_FAILURE, REFUSAL } = require('./renderer/carry-note.cjs');

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

// --- performing the carry --------------------------------------------------
//
// Everything above is a read. Everything below moves a ref and rewrites a
// working tree, which makes the *order* the load-bearing part.
//
// The branch ref is the only handle on the WIP commit. Parking reparents onto
// the base rather than stacking, so the previous WIP commit becomes unreachable
// the moment the branch moves — there is no reflog to fall back on and no second
// ref to find it by. So nothing moves the ref until the new state is proven, and
// the one window in which no ref points at the old work is spanned by a marker
// holding its oid. `reconcileCarry` is what that marker is for.

/**
 * The bytes and mode to put on the new trunk for one path, read from the parked
 * commit rather than from disk.
 *
 * The commit is the truth here, and deliberately so: the checkout onto trunk is
 * about to overwrite the working tree, so anything read from it afterwards is
 * trunk's. A path the parked commit does not have is one the ticket deleted —
 * the tree says so, never the bytes (#85, #311).
 *
 * @param {string}   dir
 * @param {Object}   root0
 * @param {string}   root0.wipOid
 * @param {string[]} root0.paths
 * @return {Promise<Array<{path: string, deleted: boolean, oid: ?string, mode: ?string, content: ?Buffer}>>}
 */
async function readCarryPayload(dir, { wipOid, paths }) {
	const payload = [];
	for (const filepath of paths) {
		const entry = await entryInCommit({ git, fs, dir }, wipOid, filepath);
		if (!entry || entry.type !== 'blob') {
			payload.push({ path: filepath, deleted: true, oid: null, mode: null, content: null });
			continue;
		}
		const { blob } = await git.readBlob({ fs, dir, oid: wipOid, filepath });
		payload.push({
			path: filepath,
			deleted: false,
			oid: entry.oid,
			// The mode git recorded, not the one the filesystem would report. On
			// Windows there is no executable bit to read at all, so a file that
			// arrived as 100755 would be demoted by anything that asked the
			// filesystem — the argument fileModeForEntry makes for pull requests.
			mode: entry.mode,
			content: Buffer.from(blob)
		});
	}
	return payload;
}

/**
 * The ticket's own change to the paths trunk has also touched, as a patch.
 *
 * Only these go through `applyPatchToDir`, so upstream's other edits to the same
 * file survive. Built from the two commits rather than from the working tree,
 * because by the time it is applied the working tree is trunk's.
 *
 * @param {string}   dir
 * @param {Object}   root0
 * @param {string}   root0.baseOid
 * @param {string}   root0.wipOid
 * @param {string[]} root0.paths
 * @return {Promise<string>} '' when there is nothing to replay.
 */
async function buildCarryPatch(dir, { baseOid, wipOid, paths }) {
	let patch = '';
	for (const filepath of paths) {
		const before = await git.readBlob({ fs, dir, oid: baseOid, filepath }).catch(() => null);
		const after = await git.readBlob({ fs, dir, oid: wipOid, filepath }).catch(() => null);
		patch += unifiedSection({
			path: filepath,
			inOld: Boolean(before),
			inNew: Boolean(after),
			a: before ? normalizeEol(Buffer.from(before.blob).toString('utf8')) : '',
			b: after ? normalizeEol(Buffer.from(after.blob).toString('utf8')) : ''
		});
	}
	return patch;
}

/**
 * Writes one carried path onto the checked-out trunk.
 *
 * The executable bit is put on the file as well as into the index, on the
 * platforms that have one. The commit would be right either way — the mode goes
 * into the tree explicitly — but the *next* park reads the mode off `lstat`, so
 * a file left at 0644 on disk would have the bit the carry just preserved taken
 * straight back off it by the following save.
 *
 * @param {string} dir
 * @param {Object} entry      A readCarryPayload row.
 * @param {string} [platform] Injected so both branches are testable from one machine.
 */
function writeCarriedFile(dir, entry, platform = process.platform) {
	const abs = path.join(dir, entry.path);
	if (entry.deleted) {
		fs.rmSync(abs, { force: true });
		return;
	}
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, entry.content);
	// Windows has no bit to set, and asking it to chmod an executable is a
	// no-op at best — there the mode recorded in the tree is the only truth,
	// which is the argument fileModeForEntry already makes.
	if (platform !== 'win32' && entry.mode === GIT_MODE_EXECUTABLE) {
		try { fs.chmodSync(abs, 0o755); } catch {}
	}
}

/**
 * Stages the carried paths with the oid and mode they are meant to have, and
 * commits them as the branch's single WIP commit on the new base.
 *
 * `updateIndex` rather than `add`, because `add` recomputes the mode from the
 * filesystem — which on Windows has no executable bit, so a 100755 file would be
 * silently demoted by the very operation meant to preserve it.
 *
 * @param {string}   dir
 * @param {Object}   root0
 * @param {string}   root0.ref
 * @param {string}   root0.trunkOid
 * @param {Array}    root0.payload  readCarryPayload rows.
 * @param {string[]} root0.merged   Paths applyPatchToDir wrote, whose bytes are on disk.
 * @param {Object}   root0.author
 * @return {Promise<string>} The new WIP commit's oid.
 */
async function commitCarriedWork(dir, { ref, trunkOid, payload, merged, author }) {
	// A ticket with nothing on it — read but never edited — gets its base moved
	// and no commit at all. An empty WIP commit would be a change to the branch
	// that no work asked for, and the patch it generates is the same either way.
	if (!payload.length && !merged.length) return trunkOid;

	for (const entry of payload) {
		if (entry.deleted) {
			try { await git.remove({ fs, dir, filepath: entry.path }); } catch {}
			continue;
		}
		await git.updateIndex({ fs, dir, filepath: entry.path, oid: entry.oid, mode: parseInt(entry.mode, 8), add: true });
	}
	for (const filepath of merged) {
		// The patched bytes, LF-normalised the way `add` would: a checkout made by
		// native git on Windows has CRLF on disk while every blob in the store is
		// LF, and writing the raw bytes would commit a file whose every line
		// differs from upstream's.
		const content = normalizeEolBuffer(fs.readFileSync(path.join(dir, filepath)));
		const oid = await git.writeBlob({ fs, dir, blob: content });
		const mode = await modeInCommit({ git, fs, dir }, trunkOid, filepath);
		await git.updateIndex({ fs, dir, filepath, oid, mode: parseInt(mode || '100644', 8), add: true });
	}
	return git.commit({ fs, dir, message: WIP_MESSAGE, author, parent: [trunkOid], ref: `refs/heads/${ref}` });
}

/**
 * Brings a ticket's accumulated work onto the trunk the site now has (#305).
 *
 * The order is the safety property, and it is the whole design:
 *
 *  1. Park, so every edit is in the branch's WIP commit and nothing lives only
 *     on disk. (The caller has already refused if the site needs reconciling.)
 *  2. Read the payload and classify. Pure reads — a refusal here has touched
 *     nothing at all.
 *  3. Decide the layers. With a patch applied whose text still reverses cleanly,
 *     lifting it out first is what keeps the contributor's own edits separable;
 *     an absorbed one moves with them as a single layer, because folding it in
 *     would destroy the revert the record still promises.
 *  4. **Persist the marker**, carrying the WIP commit's oid. From here until the
 *     new commit exists, this is the only thing that keeps the old work
 *     findable — parking reparents, so no reflog holds it.
 *  5. Switch to trunk. The ticket ref still points at the old WIP commit, so a
 *     failure here is today's known mid-switch state and the existing guard
 *     handles it.
 *  6. Write. A failure costs nothing: check back out to the ticket, drop the
 *     marker, report. This is where a genuine conflict surfaces.
 *  7. Only now move the ref, commit the carried work onto the new base, record
 *     it, and clear the marker.
 *  8. Put an applied patch back, if one was lifted out. By this point the carry
 *     has already succeeded, so a patch that no longer applies loses its record
 *     rather than the contributor losing their work.
 *
 * Electron-free like the rest of the module: the two store writes arrive as
 * `setMarker` and `setBase`, and `runSwitch` is where main.js wraps a checkout
 * in its mid-switch marker. `node --test` passes in-memory equivalents and
 * drives the whole thing against a real repository.
 *
 * @param {Object}   root0
 * @param {string}   root0.dir
 * @param {string}   root0.ref            The ticket branch.
 * @param {string}   root0.baseOid        Its current branch point.
 * @param {string}   root0.trunkOid       Where the site's `trunk` points now.
 * @param {?Object}  [root0.appliedPatch] The stored layer record (#306), or null.
 * @param {Object}   [root0.author]
 * @param {Function} [root0.setMarker]    Persists (or clears, on null) the carry marker.
 * @param {Function} [root0.setBase]      Records the branch's new branch point.
 * @param {Function} [root0.runSwitch]    Wraps a checkout in the mid-switch marker.
 * @param {Function} [root0.onProgress]
 * @param {Function} [root0.onLog]
 * @return {Promise<Object>}
 */
async function carryTicketForward({
	dir,
	ref,
	baseOid,
	trunkOid,
	appliedPatch = null,
	author = WIP_AUTHOR,
	setMarker = async () => {},
	setBase = async () => {},
	runSwitch = (run) => run(),
	onProgress = null,
	onLog = () => {}
}) {
	onLog(`Saving your work on ${ref} before anything moves…\n`);
	await parkCurrentWork(dir, { baseOid, author, onProgress });
	const wipOid = await git.resolveRef({ fs, dir, ref });

	// Everything from here to the marker is a read.
	const candidates = await collectTicketChanges(dir, baseOid);
	const classified = await classifyCarry(dir, { files: candidates, baseOid, trunkOid });
	if (classified.refused.length) {
		onLog('\nNothing was moved.\n');
		return { ok: false, code: CARRY_FAILURE.REFUSED, oid: wipOid, ...classified };
	}

	// A patch whose text still comes out cleanly is lifted off first, so what is
	// carried is the contributor's own writing and the patch goes back on top.
	// One that has been edited over cannot be lifted at all (#306) — it has
	// become their changes, and it travels as part of them.
	let liftable = null;
	if (appliedPatch && appliedPatch.text) {
		let absorbed = [];
		try { ({ absorbed } = diagnoseRemoval({ dir, patchText: appliedPatch.text })); } catch { absorbed = [{}]; }
		if (!absorbed.length) liftable = appliedPatch;
	}

	// The load-bearing write. Past this line the old WIP commit is reachable only
	// through the oid recorded here.
	await setMarker({ ref, oldOid: wipOid, trunkOid, baseOid });

	let ownOid = wipOid;
	if (liftable) {
		onLog(`\nLifting ${liftable.label || 'the applied patch'} out so your own work moves on its own…\n`);
		const undo = await applyPatchToDir({ dir, patchText: liftable.text, reverse: true, onLog });
		if (undo.ok) {
			await parkCurrentWork(dir, { baseOid, author, onProgress });
			ownOid = await git.resolveRef({ fs, dir, ref });
		} else {
			// All-or-nothing: nothing was written, so the tree is still the full
			// WIP. Carry it as one layer rather than abandoning the carry.
			onLog('It could not be lifted out, so it moves as part of your changes.\n');
			liftable = null;
		}
	}

	// Re-derived only when the lift actually happened, because that is the only
	// thing that shrinks the set — the classification above still holds (this is
	// a subset of it) and cannot produce a refusal it did not already produce.
	// Without a lift the two answers are identical, and the walk behind them
	// hashes every non-ignored file in the checkout.
	const own = ownOid === wipOid
		? classified
		: await classifyCarry(dir, { files: await collectTicketChanges(dir, baseOid), baseOid, trunkOid });
	const payload = await readCarryPayload(dir, { wipOid: ownOid, paths: own.wholesale });
	const patchText = own.merge.length
		? await buildCarryPatch(dir, { baseOid, wipOid: ownOid, paths: own.merge })
		: '';

	onLog(`\nMoving ${ref} onto trunk ${trunkOid.slice(0, 7)}…\n`);
	await runSwitch(() => switchToBranch(dir, TRUNK, { baseOid, author, onProgress }));

	try {
		// The fallible half first, so a conflict has written nothing at all.
		if (patchText) {
			const replay = await applyPatchToDir({ dir, patchText, onLog });
			if (!replay.ok) {
				const conflict = new Error(replay.error || 'Your change no longer applies to this file.');
				conflict.replay = replay;
				throw conflict;
			}
		}
		for (const entry of payload) writeCarriedFile(dir, entry);
	} catch (e) {
		// "Nothing moved" has to be true, and lifting a layer out already moved
		// the ref: it re-parked, so the branch is at the contributor's work
		// *without* the patch. Putting the ref back before the checkout is what
		// makes this the no-op it claims to be — otherwise the layer would be
		// silently un-applied and, once the marker is cleared below, gone.
		onLog('\nPutting your ticket back exactly as it was…\n');
		if (ownOid !== wipOid) {
			await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: wipOid, force: true });
		}
		await runSwitch(() => forceCheckout(dir, { ref, from: TRUNK, onProgress }));
		// Only now: with the ref back on the WIP commit, the marker is the last
		// thing still pointing at a state that no longer needs recovering.
		await setMarker(null);
		const conflicts = (e && e.replay && e.replay.conflicts) || [];
		return {
			ok: false,
			code: CARRY_FAILURE.CONFLICT,
			oid: wipOid,
			conflicts,
			failures: (e && e.replay && e.replay.failures) || [String(e && e.message ? e.message : e)],
			// Which files actually collided, as opposed to which ones were merely
			// on the replay route. `applyPatchToDir` is all-or-nothing across the
			// whole patch, so without this the report names every replayed file as
			// a collision — and naming the file is the point of the report.
			conflictPaths: conflicts.map((c) => c && c.path).filter(Boolean),
			...own
		};
	}

	// Proven. Move the ref, commit onto the new base, and close the window.
	await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: trunkOid, force: true });
	// Symbolic, not a checkout: the branch now *is* trunk, and the working tree
	// is already trunk plus the carried work. A checkout here would either undo
	// the writes or refuse the dirty tree.
	await git.writeRef({ fs, dir, ref: 'HEAD', value: `refs/heads/${ref}`, force: true, symbolic: true });
	const newOid = await commitCarriedWork(dir, { ref, trunkOid, payload, merged: own.merge, author });
	await setBase({ baseOid: trunkOid, oid: newOid });
	await setMarker(null);

	// The carry is done; the layer is a separate promise. A patch that no longer
	// applies to today's trunk loses its record here rather than taking the
	// contributor's work down with it.
	let patchKept = null;
	if (liftable) {
		onLog(`\nPutting ${liftable.label || 'the applied patch'} back on top…\n`);
		const again = await applyPatchToDir({ dir, patchText: liftable.text, onLog });
		patchKept = again.ok;
		if (again.ok) {
			await parkCurrentWork(dir, { baseOid: trunkOid, author, onProgress });
		}
	}

	return {
		ok: true,
		oid: await git.resolveRef({ fs, dir, ref }),
		previousOid: wipOid,
		baseOid: trunkOid,
		patchKept,
		patchLabel: liftable ? (liftable.label || null) : null,
		...own
	};
}

/**
 * The ticket's changed paths, in the shape `classifyCarry` reads them.
 *
 * The same scan `collectCarryCandidates` in main.js makes, minus the parts that
 * only the patch modal needs — kept here so the carry can re-ask after lifting a
 * layer out without crossing back over IPC.
 *
 * @param {string} dir
 * @param {string} baseOid
 * @return {Promise<Array<{path: string, unreadable: boolean, binary: boolean, deleted: boolean}>>}
 */
async function collectTicketChanges(dir, baseOid) {
	const matrix = await git.statusMatrix({ fs, dir, ref: baseOid });
	const files = [];
	for (const [filepath, head, workdir] of matrix) {
		if (head === workdir) continue;
		const gone = workdir === 0;
		let work = null;
		if (!gone) {
			work = await fs.promises.readFile(path.join(dir, filepath)).catch(() => null);
			if (!work) {
				files.push({ path: filepath, unreadable: true, binary: false, deleted: false });
				continue;
			}
		}
		const base = head
			? await git.readBlob({ fs, dir, oid: baseOid, filepath }).catch(() => null)
			: null;
		if (head && !base) {
			files.push({ path: filepath, unreadable: true, binary: false, deleted: gone });
			continue;
		}
		const binary = Boolean((work && work.includes(0)) || (base && Buffer.from(base.blob).includes(0)));
		files.push({ path: filepath, unreadable: false, binary, deleted: gone });
	}
	return files;
}

/**
 * Puts a ticket back where the marker says it was.
 *
 * The recovery for the one window a carry cannot make atomic: between the marker
 * being written and the new commit existing, the branch ref may have been left
 * anywhere, and the old WIP commit is reachable only through the oid the marker
 * holds. Pointing the branch back at it and checking it out is the whole repair.
 *
 * Safe to run when nothing was actually lost — a marker left behind by a carry
 * that had already finished puts the branch back at its pre-carry commit, which
 * undoes the carry rather than damaging anything. That is the direction to fail
 * in: the contributor can carry again, and the alternative is guessing.
 *
 * @param {Object}   root0
 * @param {string}   root0.dir
 * @param {Object}   root0.marker       A `{ ref, oldOid }` record.
 * @param {Function} [root0.onProgress]
 * @return {Promise<{ok: true, ref: string, oid: string}>}
 */
async function reconcileCarry({ dir, marker, onProgress = null }) {
	const { ref, oldOid } = marker || {};
	if (!ref || !oldOid) {
		const error = new Error('The interrupted carry left no record of where your work was.');
		error.code = 'carry-marker-incomplete';
		throw error;
	}
	await git.writeRef({ fs, dir, ref: `refs/heads/${ref}`, value: oldOid, force: true });
	await git.writeRef({ fs, dir, ref: 'HEAD', value: `refs/heads/${ref}`, force: true, symbolic: true });
	await forceCheckout(dir, { ref, from: null, onProgress });
	return { ok: true, ref, oid: oldOid };
}

module.exports = {
	REFUSAL,
	CARRY_STATE,
	CARRY_FAILURE,
	commitTime,
	trunkMovedPast,
	blobEntryAt,
	classifyCarry,
	carryStatus,
	collectTicketChanges,
	readCarryPayload,
	buildCarryPatch,
	carryTicketForward,
	reconcileCarry
};
