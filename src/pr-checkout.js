'use strict';

/**
 * A pull request as a checkout of its branch (#458).
 *
 * Trying someone else's pull request used to mean downloading it as a diff
 * and running `git apply` on the ticket branch's working tree. To Git those
 * hunks were the contributor's own edits, the next park rolled them into the
 * ticket's single WIP commit, and from then on nothing could tell the two
 * apart: not Git, not the app. This module does what a Git user would do
 * instead: fetch the pull request's head from the site's own `origin`, put a
 * local branch `pr/<number>` at it, and check that out. The ticket's work is
 * parked on its own branch by the ordinary switch, untouched, and comes back
 * by the same switch. The branch is the record; `git status` says
 * `On branch pr/7701`, and the pull request is tried as its author wrote it,
 * on the base they wrote it against (#290).
 *
 * Kept beside ticket-branches.js rather than inside it: that module's
 * invariants are stated for `ticket/` refs and `trunk`, and a pull request's
 * branch breaks the second one on purpose. Its base is a foreign commit that
 * moves when the author pushes, not a trunk snapshot, and it starts with the
 * author's commits, not empty. Edits a contributor makes on top are parked
 * by the same `parkCurrentWork` as one WIP commit whose parent is the pull
 * request's head, so Git still separates the author's commits from the
 * contributor's edits, and a patch cut from the branch holds only the edits.
 * What this module never does is redefine a park or a checkout: every write
 * goes through `switchToBranch` and the primitives it uses.
 *
 * No Electron dependency, so `node --test` can drive it against a real
 * origin on disk (same rationale as trunk-update.js). main.js owns the IPC
 * plumbing and the electron-store record of which pull request a branch
 * holds and where "back" leads.
 */

const { resolveRef, listBranches, mergeBase, changedPathsBetween, blobOid } = require('./git-read.cjs');
const { fetchBranch, createBranchAt, updateBranch, deleteBranch } = require('./git-write.cjs');
const { lockfileChangedFromBlobOids } = require('./git-update.cjs');
const { TRUNK, prBranchRef, prNumberFromRef, currentBranchName, switchToBranch } = require('./ticket-branches.js');

/** The remote a site's pull requests are fetched from: its own `origin` (#359). */
const REMOTE = 'origin';

/**
 * A pull request number as it arrives over IPC, or a thrown `code:
 * 'bad-pr-number'`. The number goes into a refspec and a branch name, so
 * anything that is not a positive integer is refused before Git sees it.
 *
 * @param {*} number
 * @return {number}
 */
function validNumber(number) {
	const n = Number(number);
	if (!Number.isInteger(n) || n <= 0) {
		const error = new Error(`Not a pull request number: ${String(number)}`);
		error.code = 'bad-pr-number';
		throw error;
	}
	return n;
}

/**
 * A commit id as the store or the renderer hands it back, or a thrown `code:
 * 'bad-oid'`. It goes to `branch` and `update-ref`, which accept any
 * revision expression as a start point (`HEAD@{1}`, a branch name), and a
 * branch put somewhere the app did not fetch is a branch the app cannot
 * reason about. Forty hex digits or nothing; null is allowed where the
 * caller says the value may be absent.
 *
 * @param {*}       oid
 * @param {Object}  [root0]
 * @param {boolean} [root0.optional]
 * @return {?string}
 */
function validOid(oid, { optional = false } = {}) {
	if (oid === null || oid === undefined) {
		if (optional) return null;
	} else if (/^[0-9a-f]{40}$/.test(String(oid))) {
		return String(oid);
	}
	const error = new Error(`Not a commit id: ${String(oid)}`);
	error.code = 'bad-oid';
	throw error;
}

/**
 * Fetches the pull request's head commit from `origin`, without moving any
 * branch. GitHub serves every pull request of a repository, fork or not, as
 * `refs/pull/<number>/head` on that repository, and `fetchBranch` hands the
 * short name to Git, which resolves it on the remote. The partial clone's
 * filter applies to this fetch as to every other, so what arrives is commits
 * and trees; the blobs come when the branch is checked out.
 *
 * @param {string}   dir
 * @param {number}   number
 * @param {Object}   [root0]
 * @param {Function} [root0.onStderr]   Git's own fetch lines, for a log.
 * @param {Function} [root0.onProgress]
 * @param {Function} [root0.onChild]    Handed the ChildProcess, so a quit can end it.
 * @return {Promise<{oid: string}>} Rejects with Git's error when the fetch fails.
 */
async function fetchPullRequestHead(dir, number, { onStderr = null, onProgress = null, onChild = null } = {}) {
	const n = validNumber(number);
	return fetchBranch(dir, REMOTE, `pull/${n}/head`, { onStderr, onProgress, onChild });
}

/**
 * The blob id of the lockfile at a commit, or null when the commit has none.
 * Same reading trunk-update.js does before its checkout, for the same reason:
 * whether an install is needed is decided before the worktree moves.
 *
 * @param {string} dir
 * @param {string} oid
 */
async function lockfileBlobOid(dir, oid) {
	try {
		return await blobOid(dir, oid, 'package-lock.json');
	} catch {
		return null;
	}
}

/**
 * What checking out a fetched head would do, read from the objects and
 * nothing else: no network, no write.
 *
 * The file list is the pull request's own diff, measured from where its
 * branch left trunk (the merge base), which is what its author changed. It
 * is not the difference from the current checkout: a pull request written
 * against last month's trunk differs from today's trunk by a month of other
 * people's commits, and listing those would blame the author for them. A
 * pull request based on a release branch is measured against trunk's merge
 * base all the same, so its list also carries that branch's own commits;
 * the app cannot tell those from the author's without the base the pull
 * request declares on GitHub, which this module does not read. A head that
 * shares no history with trunk at all has no merge base, and the list is
 * empty rather than a guess; `base` is null so the caller can say so.
 *
 * `needsInstall` is the one comparison made against the current checkout,
 * because it asks a different question: whether the worktree about to be
 * written needs `npm install` before it builds.
 *
 * @param {string} dir
 * @param {string} headOid             The fetched head.
 * @param {Object} [root0]
 * @param {string} [root0.currentHead] Defaults to HEAD.
 * @param {string} [root0.trunkRef]
 * @return {Promise<{files: Array<{path: string, kind: string}>, needsInstall: boolean, base: ?string}>}
 */
async function describePullRequestHead(dir, headOid, { currentHead = null, trunkRef = TRUNK } = {}) {
	const base = await mergeBase(dir, trunkRef, headOid);
	const rows = base ? await changedPathsBetween(dir, base, headOid) : [];
	const kindOf = (before, after) => {
		if (before === 0) return 'added';
		if (after === 0) return 'deleted';
		return 'modified';
	};
	const files = rows.map(([filepath, before, after]) => ({ path: filepath, kind: kindOf(before, after) }));
	const from = currentHead || await resolveRef(dir, 'HEAD');
	const needsInstall = lockfileChangedFromBlobOids(...await Promise.all([lockfileBlobOid(dir, from), lockfileBlobOid(dir, headOid)]));
	return { files, needsInstall, base };
}

/**
 * The state of `pr/<number>` on disk against what the app recorded for it:
 * whether the branch exists, whether it carries edits (a WIP commit the park
 * wrote, so its tip is not the head the app put it at), and whether the head
 * fetched now differs from the one recorded. Read-only; the checkout below
 * makes its decisions from the same reading.
 *
 * @param {string}  dir
 * @param {number}  number
 * @param {Object}  [root0]
 * @param {?string} [root0.headOid]         The head fetched now.
 * @param {?string} [root0.recordedHeadOid] The head the branch was last put at.
 * @return {Promise<{ref: string, exists: boolean, tip: ?string, hasEdits: boolean, moved: boolean}>}
 */
async function pullRequestBranchState(dir, number, { headOid = null, recordedHeadOid = null } = {}) {
	const ref = prBranchRef(validNumber(number));
	validOid(headOid, { optional: true });
	validOid(recordedHeadOid, { optional: true });
	const tip = await resolveRef(dir, `refs/heads/${ref}`);
	const exists = tip !== null;
	const hasEdits = exists && Boolean(recordedHeadOid) && tip !== recordedHeadOid;
	const moved = Boolean(headOid) && Boolean(recordedHeadOid) && headOid !== recordedHeadOid;
	return { ref, exists, tip, hasEdits, moved };
}

/**
 * Puts `pr/<number>` at `headOid` and checks it out, parking whatever branch
 * is being left through the ordinary switch.
 *
 * The branch is created when it is not there. When it is, the app's record
 * of where it last put it (`recordedHeadOid`) decides:
 *
 * - No record: the branch is someone else's, made by hand in a terminal, and
 *   is refused with `code: 'pr-branch-exists'` rather than adopted. Adopting
 *   it would let the next park write a WIP commit onto a branch the app does
 *   not own.
 * - Tip differs from the record: the park wrote edits onto it. Moving the
 *   branch would drop them, so a head that moved on GitHub is refused with
 *   `code: 'pr-has-edits'` while they are there; the same head as before is
 *   simply checked out again, edits and all.
 * - Tip equals the record and the head moved: the branch is moved with
 *   `expected` set, so a second writer in the same site fails loudly.
 *
 * Checking out the branch that is already checked out is refused with
 * `code: 'already-checked-out'`: moving a checked-out branch under a
 * worktree that may hold edits is a rewrite the forced checkout would make
 * silently, and the caller has a better answer (leave, then come back).
 *
 * The switch itself is `switchToBranch`, so leaving a dirty trunk is refused
 * with `dirty-trunk`, leaving a ticket parks it onto `fromBaseOid`, and a
 * checkout that dies part-way is tagged `stage: 'checkout'` for the caller's
 * switch marker, all exactly as a ticket switch. Every error thrown after
 * the ref was written carries `ref`, `headOid`, `created` and `moved`, the
 * way `rebaseOntoTrunk` carries `movedTo`: the branch is at `headOid` now
 * whatever the worktree looks like, and the caller has to record that head
 * or its next call will read the branch as one the app did not make. A
 * switch refused before its checkout moved a file deletes a branch this
 * call created, so "nothing was changed" includes the ref; a checkout that
 * died part-way keeps it, because the caller's marker retries exactly it.
 *
 * @param {string}   dir
 * @param {number}   number
 * @param {Object}   root0
 * @param {string}   root0.headOid           The head fetched now.
 * @param {?string}  [root0.recordedHeadOid] The head the app last put the branch at.
 * @param {?string}  [root0.fromBaseOid]     Branch point of the branch being left, for its park.
 * @param {Function} [root0.onProgress]
 * @param {Function} [root0.onChild]
 * @return {Promise<{ref: string, from: ?string, to: string, parked: boolean, created: boolean, moved: boolean}>}
 */
async function checkoutPullRequest(dir, number, { headOid, recordedHeadOid = null, fromBaseOid = null, onProgress = null, onChild = null }) {
	validOid(headOid);
	validOid(fromBaseOid, { optional: true });
	const state = await pullRequestBranchState(dir, number, { headOid, recordedHeadOid });
	const { ref } = state;

	const from = await currentBranchName(dir);
	if (from === ref) {
		const error = new Error(`${ref} is already checked out`);
		error.code = 'already-checked-out';
		error.ref = ref;
		throw error;
	}

	let created = false;
	let moved = false;
	if (!state.exists) {
		await createBranchAt(dir, ref, headOid);
		created = true;
	} else if (!recordedHeadOid) {
		const error = new Error(`A branch named ${ref} already exists and the app did not make it`);
		error.code = 'pr-branch-exists';
		error.ref = ref;
		throw error;
	} else if (state.moved) {
		if (state.hasEdits) {
			const error = new Error(`Pull request #${number} moved on GitHub, and ${ref} carries edits made on the older version`);
			error.code = 'pr-has-edits';
			error.ref = ref;
			throw error;
		}
		await updateBranch(dir, ref, headOid, { expected: recordedHeadOid });
		moved = true;
	}

	let result;
	try {
		result = await switchToBranch(dir, ref, {
			...(fromBaseOid ? { baseOid: fromBaseOid } : {}),
			...(onProgress ? { onProgress } : {}),
			...(onChild ? { onChild } : {})
		});
	} catch (e) {
		const refused = !(e && e.stage === 'checkout');
		let rolledBack = false;
		if (created && refused) {
			// Its own try: a delete that fails must not replace the refusal
			// it is cleaning up after, which is the sentence the contributor
			// needs ("your edits are still there").
			try {
				await deleteBranch(dir, ref);
				rolledBack = true;
			} catch (cleanup) {
				if (e && typeof e === 'object') e.cleanupError = cleanup;
			}
		}
		if (e && typeof e === 'object') {
			e.ref = ref;
			e.headOid = headOid;
			e.created = created && !rolledBack;
			e.moved = moved;
		}
		throw e;
	}
	return { ref, from, to: ref, parked: result.parked, created, moved };
}

/**
 * Leaves `pr/<number>` for the branch the contributor came from, parking any
 * edits made on the pull request as one WIP commit whose parent is the pull
 * request's head. That parent is what keeps the author's commits and the
 * contributor's edits apart in the branch's history, and it is why the
 * caller passes `headOid` rather than letting the park fall back to trunk.
 *
 * `returnTo` that no longer exists (the ticket was deleted meanwhile) falls
 * back to trunk, and the result says where it went. Refuses with
 * `code: 'not-on-pr'` when the checkout is not on a pull request branch:
 * parking a ticket onto a pull request's head would be the wrong parent.
 * Refuses with `code: 'no-pr-head'` when `headOid` is missing, rather than
 * letting the park fall back to trunk as it does for a ticket: a WIP commit
 * on `pr/N` parented on trunk folds the author's commits into the
 * contributor's edits, which is the state this module exists to end.
 *
 * @param {string}   dir
 * @param {Object}   root0
 * @param {string}   root0.returnTo     The branch to go back to.
 * @param {string}   root0.headOid      The pull request's head, the park's parent.
 * @param {Function} [root0.onProgress]
 * @param {Function} [root0.onChild]
 * @return {Promise<{from: string, to: string, parked: boolean, fellBack: boolean}>}
 */
async function leavePullRequest(dir, { returnTo, headOid, onProgress = null, onChild = null }) {
	const from = await currentBranchName(dir);
	if (prNumberFromRef(from) === null) {
		const error = new Error(`Not on a pull request branch: ${from || 'detached HEAD'}`);
		error.code = 'not-on-pr';
		throw error;
	}
	if (headOid === null || headOid === undefined) {
		const error = new Error(`No recorded head for ${from}; refusing to park its edits onto trunk`);
		error.code = 'no-pr-head';
		throw error;
	}
	validOid(headOid);
	const branches = await listBranches(dir);
	const fellBack = !returnTo || !branches.includes(returnTo);
	const to = fellBack ? TRUNK : returnTo;
	const result = await switchToBranch(dir, to, {
		baseOid: headOid,
		...(onProgress ? { onProgress } : {}),
		...(onChild ? { onChild } : {})
	});
	return { from, to, parked: result.parked, fellBack };
}

module.exports = {
	REMOTE,
	fetchPullRequestHead,
	describePullRequestHead,
	pullRequestBranchState,
	checkoutPullRequest,
	leavePullRequest
};
