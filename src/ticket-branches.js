'use strict';

/**
 * Ticket branches (#108). A site is the expensive shared substrate — the clone,
 * `node_modules`, the build output — and a ticket is a cheap branch on top of
 * it. Switching tickets parks the current work, swaps the worktree, and leaves
 * the substrate untouched, so starting a second ticket costs seconds instead of
 * another clone and another install.
 *
 * No Electron dependency, so `node --test` can exercise it against real
 * repositories (same rationale as trunk-update.js). Everything here runs on
 * the bundled Git: reads through git-read.cjs (#384), writes through the
 * primitives in git-write.cjs (#385). main.js owns the IPC plumbing and the
 * electron-store writes.
 *
 * Two invariants hold everything else up:
 *
 * 1. **`trunk` is never committed to.** It stays the pristine snapshot every
 *    branch is diffed against. Work that starts on trunk is carried into a
 *    ticket branch instead (the branch is created and HEAD pointed at it
 *    without a checkout, so uncommitted edits come along for free).
 *
 * 2. **A ticket branch carries exactly one WIP commit**, always reparented onto
 *    the branch point. Parking writes the commit with `commit-tree -p baseOid`
 *    and moves the branch ref onto it, rather than committing onto the previous
 *    WIP commit, so re-parking rewrites that single commit instead of stacking
 *    a pile of saves the user never asked for — the history-nobody-asked-for
 *    risk #108 flags at the end.
 */

const fs = require('node:fs');
const path = require('node:path');
const { mapCheckoutPhase } = require('./switch-progress.cjs');
const { currentBranch, listBranches, resolveRef, statusRows, changesAgainst, changedPathsBetween, otherPaths, treeDirectories, mergeTree } = require('./git-read.cjs');
const { stagePaths, writeTree, commitTree, updateBranch, createBranchAt, pointHeadAt, deleteBranch, checkoutBranch } = require('./git-write.cjs');

/** The pristine snapshot branch. Never committed to, never deleted. */
const TRUNK = 'trunk';

/**
 * The one commit on a ticket branch. The message is never shown to the user —
 * the app's deliverable is a patch, not a history — but it makes the state
 * legible to anyone who opens the site in a real git client.
 */
const WIP_MESSAGE = 'Work in progress (WordPress Contributor Toolkit)';

/**
 * A commit needs an author, and there is no host `git config` to read one
 * from — a contributor having no git installed is the entire premise of the
 * app, and the bundled Git reads no host config either (git-binary.cjs). These
 * commits never leave the disk: the deliverable is the patch, and its real
 * author is the name on the Trac ticket.
 */
const WIP_AUTHOR = { name: 'WordPress Contributor Toolkit', email: 'noreply@localhost' };

/**
 * The namespaces a work-item branch can live under (#251). Core keeps
 * `ticket/`, unchanged since #108, so no existing site moves; a Gutenberg site
 * gets `issue/`, the noun its upstream uses. Which one a site writes comes from
 * its project type (`workItem.branchPrefix`); every *read* here accepts both,
 * because a site's branches are read by ref name alone — `branches:list` and
 * the delete guard have no site type to hand — and two sites of different types
 * never share a directory anyway.
 */
const WORK_ITEM_BRANCH_PREFIXES = ['ticket/', 'issue/'];
const DEFAULT_BRANCH_PREFIX = WORK_ITEM_BRANCH_PREFIXES[0];
const WORK_ITEM_REF = /^(?:ticket|issue)\/(\d+)$/;

/**
 * Branch name for a work item. Both Trac ticket ids and GitHub issue numbers
 * are numeric, so this cannot collide with `trunk` and needs no escaping.
 *
 * @param {number|string} ticketId
 * @param {string}        [prefix] the site's namespace; Core's when absent, so
 *                                 a caller with no site meta to hand behaves
 *                                 exactly as it did before project types.
 */
function ticketBranchRef(ticketId, prefix = DEFAULT_BRANCH_PREFIX) {
	return `${prefix}${ticketId}`;
}

/**
 * The work-item id a branch name encodes, or null for anything else (`trunk`, a
 * `pr/` checkout, or a branch a user made by hand in their own git client).
 *
 * @param {string} ref
 */
function ticketIdFromRef(ref) {
	const match = WORK_ITEM_REF.exec(String(ref || ''));
	return match ? Number(match[1]) : null;
}

/**
 * Branch name for a pull request checked out to be tried (#458): `pr/7701`.
 * Its own namespace, so `ticketIdFromRef` reads null for one and a mentor
 * reading `git branch` knows what it is. `listTicketBranches` still lists
 * it, as it lists any branch that is not trunk, and the generic switch
 * parks it like any other: what makes that park right is that the pull
 * request's recorded head is the branch's `baseOid`, so the WIP commit's
 * parent is the author's commit and not trunk. Whoever records a `pr/`
 * branch records that head as its base.
 *
 * @param {number|string} number
 */
function prBranchRef(number) {
	return `pr/${number}`;
}

/**
 * The pull request number a branch name encodes, or null for anything else.
 *
 * @param {string} ref
 */
function prNumberFromRef(ref) {
	const match = /^pr\/(\d+)$/.exec(String(ref || ''));
	return match ? Number(match[1]) : null;
}

/**
 * The checked-out branch name, or null in a detached HEAD — which the app never
 * creates, but a user poking at the site with their own git client can.
 *
 * @param {string} dir
 */
async function currentBranchName(dir) {
	return currentBranch(dir);
}

/**
 * Every branch in the site except `trunk`, newest-irrelevant order (the caller
 * sorts by its own `lastUsedAt`, which is what the switcher shows).
 *
 * @param {string} dir
 */
async function listTicketBranches(dir) {
	const branches = await listBranches(dir);
	return branches.filter((ref) => ref !== TRUNK);
}

/**
 * The trunk tip, which every ticket branches from and every patch is measured
 * against. A site with no `trunk` is one the app did not make and cannot work
 * in; that is an error with a code, not a null to trip over later.
 *
 * @param {string} dir
 */
async function trunkOid(dir) {
	const oid = await resolveRef(dir, TRUNK);
	if (!oid) {
		const error = new Error('This site has no trunk branch');
		error.code = 'no-trunk';
		throw error;
	}
	return oid;
}

/**
 * Brings the index in line with the worktree: modified and untracked files
 * staged, deleted files removed. Deletions are the half the patch generator has
 * always dropped (#85) — here they have to work, or a file a contributor
 * removed would come back on the next switch.
 *
 * Only the rows the scan returned are handed to Git, so gitignored paths never
 * enter the index no matter how large `node_modules` and `build/` have grown,
 * and the machine-local excludes main.js writes stay excluded.
 *
 * @param {string}   dir
 * @param {Array}    [matrix]     status rows the caller already computed
 * @param {Function} [onProgress] told how far the staging has got (#173)
 */
async function stageWorktree(dir, matrix = null, onProgress = null) {
	// The caller has usually just scanned the worktree to decide whether there
	// was anything to park. On wordpress-develop that scan hashes thousands of
	// files, so it is passed in and reused rather than repeated.
	if (!matrix) matrix = await statusRows(dir);
	// The one stage of a park with a real total, and it comes free: the rows
	// worth staging are known before any of them is written. One `add` stages
	// them all, so the count moves from nothing to everything in one step.
	const pending = matrix.filter(([, head, workdir, stage]) => !(head === workdir && workdir === stage));
	if (onProgress) onProgress({ stage: 'stage', loaded: 0, total: pending.length });
	const staged = await stagePaths(dir, pending.map(([filepath]) => filepath));
	if (onProgress) onProgress({ stage: 'stage', loaded: staged, total: pending.length });
	return staged;
}

/**
 * Whether the worktree differs from the commit `ref` names. Used to decide
 * whether parking has anything to do, and to refuse a switch that would discard
 * uncommitted work sitting on trunk.
 *
 * @param {string} dir
 * @param {string} [ref]
 */
async function hasChangesAgainst(dir, ref = 'HEAD') {
	const { changed } = await scanWorktree(dir, ref);
	return changed;
}

/**
 * How many files differ from `ref` — the same scan, when the answer has to be
 * a number rather than a yes.
 *
 * Used where loose work is about to be carried into a new ticket branch (#108):
 * the app moves it silently otherwise, and "your 3 changes came with you" is
 * the difference between that reading as a feature and as a loss.
 *
 * @param {string} dir
 * @param {string} [ref]
 * @return {Promise<number>} Count of differing paths, gitignored ones excluded.
 */
async function countChangesAgainst(dir, ref = 'HEAD') {
	const { matrix } = await scanWorktree(dir, ref);
	return matrix.filter(([, head, workdir]) => head !== workdir).length;
}

/**
 * One worktree scan, and what the callers need from it. Split out because the
 * scan is the expensive part of every park and every switch: Git hashes every
 * file whose stat data went stale, and wordpress-develop has thousands.
 *
 * Against HEAD it is `git status`, which also fills the index column
 * `stageWorktree` reads; against any other commit (a ticket's branch point,
 * once work is parked) it is `git diff <commit>` plus the untracked files.
 *
 * @param {string} dir
 * @param {string} [ref]
 */
async function scanWorktree(dir, ref = 'HEAD') {
	const matrix = ref === 'HEAD' ? await statusRows(dir) : await changesAgainst(dir, ref);
	return { matrix, changed: matrix.some(([, head, workdir]) => head !== workdir) };
}

/**
 * Commits the worktree onto the current ticket branch as its single WIP commit,
 * reparented onto `baseOid` so re-parking rewrites rather than stacks.
 *
 * A no-op when nothing changed, so switching away from a ticket the user only
 * read does not churn the branch. Refuses to run on `trunk` (invariant 1) —
 * work that starts there is carried into a branch by `startTicketBranch`, not
 * committed where every other branch's diff base lives.
 *
 * @param {string}   dir
 * @param {Object}   root0
 * @param {string}   [root0.baseOid]    branch point; resolved from `trunk` when absent
 * @param {Object}   [root0.author]
 * @param {Function} [root0.onProgress] told which stage of the park is running (#173)
 */
async function parkCurrentWork(dir, { baseOid, author = WIP_AUTHOR, onProgress = null } = {}) {
	const branch = await currentBranchName(dir);
	if (!branch || branch === TRUNK) {
		const error = new Error('Refusing to commit on trunk — it is the diff base for every ticket');
		error.code = 'trunk-is-read-only';
		throw error;
	}

	// Announced before the scan rather than after it: `git status` reports
	// nothing while it runs and is about a third of a switch, so this is the
	// stretch that would otherwise be silent — and the stretch during which the
	// contributor's edits are not committed anywhere yet.
	if (onProgress) onProgress({ stage: 'scan', from: branch });
	const { matrix, changed } = await scanWorktree(dir);
	if (!changed) return { parked: false, branch, oid: null };

	// Resolved rather than required so a branch whose baseOid was lost (a store
	// wiped by hand, a site adopted from disk) still parks against something
	// sane instead of throwing.
	const parent = baseOid || await trunkOid(dir);
	// Read before anything is written: the ref move below refuses if the
	// branch no longer points here, so a second writer in the same site (a
	// mentor's own client, say) fails loudly rather than being overwritten.
	const headOid = await resolveRef(dir, 'HEAD');
	// `from` added here rather than inside stageWorktree: staging is the
	// longest stretch of a park, and without it the sentence loses the ticket
	// number for exactly the seconds it most needs to name it.
	await stageWorktree(dir, matrix, onProgress && ((p) => onProgress({ from: branch, ...p })));
	if (onProgress) onProgress({ stage: 'commit', from: branch });
	// The tree the index now describes, one commit for it with exactly the
	// branch point as parent, and the branch moved onto that commit. HEAD, the
	// index and the worktree agree afterwards, so the checkout that usually
	// follows has nothing to preserve and nothing to lose.
	const tree = await writeTree(dir);
	const oid = await commitTree(dir, { tree, parent, message: WIP_MESSAGE, author });
	await updateBranch(dir, branch, oid, { expected: headOid || undefined });
	return { parked: true, branch, oid };
}

/**
 * Creates the branch for a ticket at the current trunk tip and checks it out,
 * returning the `baseOid` the caller must record — the diff base for every
 * patch this branch ever produces.
 *
 * Uncommitted work in the tree comes along: the branch is created at trunk's
 * commit and HEAD is pointed at it, with no checkout at all, so no file is
 * rewritten. That is why this is instant, why `node_modules` survives, and it
 * is deliberate — "I started editing, then realised which ticket this is" is
 * the common case, and the alternative would be to throw the edits away.
 *
 * @param {string}        dir
 * @param {number|string} ticketId
 * @param {Object}        [root0]
 * @param {string}        [root0.prefix] the site's branch namespace (#251)
 */
async function startTicketBranch(dir, ticketId, { prefix = DEFAULT_BRANCH_PREFIX } = {}) {
	const ref = ticketBranchRef(ticketId, prefix);
	const existing = await listBranches(dir);
	if (existing.includes(ref)) {
		// The noun follows the namespace, so a Gutenberg site is not told it is
		// already working on a "ticket" it has never heard of.
		const noun = prefix === 'issue/' ? 'issue' : 'ticket';
		const error = new Error(`Already working on ${noun} #${ticketId} in this site`);
		error.code = 'branch-exists';
		throw error;
	}
	const baseOid = await trunkOid(dir);
	await createBranchAt(dir, ref, TRUNK);
	await pointHeadAt(dir, ref);
	return { ref, baseOid, ticketId: ticketIdFromRef(ref) };
}

/**
 * Marks the block of `.git/info/exclude` this module owns (#521). The
 * paths under it are files a branch the contributor left had ignored, that
 * the branch they arrived on does not, and that nobody wrote by hand.
 */
const LEFTOVERS_MARKER = '# WordPress Contributor Toolkit: generated files another branch ignored';

/**
 * What is ignored on disk now, in the directories whose `.gitignore` differs
 * between HEAD and `ref`, or null when none does, which is nearly every
 * switch and costs one tree diff. The root `.gitignore` widens it to the
 * whole repository, still cheap: an ignored directory is one entry.
 *
 * @param {string}  dir
 * @param {Array[]} rows the tree diff from HEAD to the ref being switched to
 * @return {Promise<?{dirs: string[], ignored: string[]}>}
 */
async function ignoredBeforeSwitch(dir, rows) {
	const dirs = new Set();
	for (const [filepath] of rows) {
		if (path.posix.basename(filepath) !== '.gitignore') continue;
		const parent = path.posix.dirname(filepath);
		dirs.add(parent === '.' ? '' : parent);
	}
	if (!dirs.size) return null;
	const scope = dirs.has('') ? [''] : [...dirs];
	return { dirs: scope, ignored: await otherPaths(dir, scope, { ignored: true }) };
}

/**
 * One line of `.gitignore` syntax matching exactly `filepath` from the root:
 * anchored, and with the characters Git would read as a pattern escaped. A
 * directory keeps its trailing `/`, which Git reads as "this directory".
 *
 * @param {string} filepath
 */
function literalExcludeLine(filepath) {
	return `/${filepath.replace(/[\\*?[]/g, '\\$&').replace(/ +$/, (spaces) => spaces.replace(/ /g, '\\ '))}`;
}

/**
 * The entries of `ignored` (files, and directories ending in `/`) that hold
 * at least one of `untracked`. An ignored directory is written back as the
 * directory, not file by file: a generated tree such as `ios/Pods/` is tens
 * of thousands of files, and Git weighs every exclude line against every
 * path it looks at. Each path's ancestors are looked up in a Set, so the cost
 * is the depth of the tree, not the number of ignored directories.
 *
 * @param {string[]} ignored
 * @param {string[]} untracked
 * @return {string[]}
 */
function leftoverEntries(ignored, untracked) {
	const known = new Set(ignored);
	const found = new Set();
	for (const filepath of untracked) {
		if (known.has(filepath)) {
			found.add(filepath);
			continue;
		}
		for (let slash = filepath.indexOf('/'); slash !== -1; slash = filepath.indexOf('/', slash + 1)) {
			const parent = filepath.slice(0, slash + 1);
			if (known.has(parent)) {
				found.add(parent);
				break;
			}
		}
	}
	// A line break in a name would split it into two exclude lines, the
	// second unanchored and able to hide real work anywhere in the tree.
	return [...found].filter((entry) => !/[\r\n]/.test(entry));
}

/**
 * After a switch, the untracked files that were ignored before it, added to
 * the app's block in `.git/info/exclude` so Git stops reporting them (#521).
 * A branch's install or build generated them under that branch's own
 * `.gitignore`, and a forced checkout leaves files it does not track where
 * they are. Without this the branch arrived on reads dirty with work the
 * contributor never did: trunk refuses to be left, and a new ticket parks
 * the files into its WIP commit. Nothing is deleted; they stay on disk for
 * the branch that made them, which ignores them anyway.
 *
 * @param {string}                              dir
 * @param {{dirs: string[], ignored: string[]}} before
 * @return {Promise<string[]>} the entries excluded, directories ending in `/`
 */
async function excludeLeftovers(dir, before) {
	const leftovers = leftoverEntries(before.ignored, await otherPaths(dir, before.dirs));
	if (!leftovers.length) return [];

	const infoDir = path.join(dir, '.git', 'info');
	const excludePath = path.join(infoDir, 'exclude');
	let existing = '';
	try {
		existing = await fs.promises.readFile(excludePath, 'utf8');
	} catch (error) {
		if (!error || error.code !== 'ENOENT') throw error;
	}
	const present = new Set(existing.split(/\r?\n/));
	const lines = leftovers.map(literalExcludeLine).filter((line) => !present.has(line));
	if (!lines.length) return leftovers;
	if (!present.has(LEFTOVERS_MARKER)) lines.unshift(LEFTOVERS_MARKER);
	await fs.promises.mkdir(infoDir, { recursive: true });
	const separator = existing && !existing.endsWith('\n') ? '\n' : '';
	await fs.promises.appendFile(excludePath, `${separator}${lines.join('\n')}\n`);
	return leftovers;
}

/**
 * Every directory above a path the switch deletes, without a trailing `/`,
 * not the root. The candidates for a directory the new tree no longer has
 * (#529); pure, so it costs nothing when the diff deletes nothing.
 *
 * @param {Array[]} rows the tree diff, `[path, before, after]`
 * @return {Set<string>}
 */
function parentsOfDeleted(rows) {
	const dirs = new Set();
	for (const [filepath, , after] of rows) {
		if (after !== 0) continue;
		for (let slash = filepath.indexOf('/'); slash !== -1; slash = filepath.indexOf('/', slash + 1)) {
			dirs.add(filepath.slice(0, slash));
		}
	}
	return dirs;
}

/**
 * Whether `abs` holds nothing but directories, `node_modules` directories and
 * `*.tsbuildinfo` files, however deep: what an install and `tsc --build`
 * leave behind, and nothing a contributor wrote. The build info is
 * TypeScript's incremental cache, rewritten by the next build; a Gutenberg
 * route holds it beside its install once trunk's types are built. Any other
 * file, a symlink or anything else outside a `node_modules` says no.
 *
 * @param {string} abs
 * @return {Promise<boolean>}
 */
async function holdsOnlyInstalls(abs) {
	for (const entry of await fs.promises.readdir(abs, { withFileTypes: true })) {
		if (entry.isFile() && entry.name.endsWith('.tsbuildinfo')) continue;
		if (!entry.isDirectory()) return false;
		if (entry.name === 'node_modules') continue;
		if (!(await holdsOnlyInstalls(path.join(abs, entry.name)))) return false;
	}
	return true;
}

/**
 * After a switch, removes the directories the new tree does not have that
 * are still on disk holding only an install the old branch made (#529).
 * Git takes a directory's tracked files on a checkout and leaves its ignored
 * ones, so a trunk-only `routes/dashboard/` survives a switch to an older
 * pull request as a bare `node_modules`, and `wp-build`, which reads every
 * directory under `routes/` as a route, fails on its missing `package.json`.
 *
 * Deliberately narrow, since this deletes. Only the topmost directory the new
 * tree lacks, only when everything in it is a `node_modules`, or TypeScript
 * build info, that Git ignores:
 * one untracked file (the contributor's, or what #521 excludes) keeps the
 * whole directory. The tree is compared without case, as macOS and Windows
 * compare names: a directory renamed only by case is the same directory on
 * disk, never a leftover. Switching back reinstalls when the directory is a
 * workspace of the root lockfile, as Gutenberg's `routes/*` are. Each
 * directory is best effort on its own.
 *
 * @param {string}      dir
 * @param {Set<string>} candidates from parentsOfDeleted
 * @return {Promise<string[]>} the directories removed
 */
async function removeLeftoverInstalls(dir, candidates) {
	if (!candidates.size) return [];
	const inTree = new Set((await treeDirectories(dir, 'HEAD')).map((d) => d.toLowerCase()));
	const has = (d) => inTree.has(d.toLowerCase());
	const gone = [...candidates].filter((d) => {
		if (has(d)) return false;
		const parent = path.posix.dirname(d);
		return parent === '.' || has(parent);
	}).sort();
	const removed = [];
	for (const d of gone) {
		const abs = path.join(dir, ...d.split('/'));
		try {
			const stat = await fs.promises.lstat(abs);
			if (!stat.isDirectory()) continue;
			if (!(await holdsOnlyInstalls(abs))) continue;
			if ((await otherPaths(dir, [d])).length) continue;
			await fs.promises.rm(abs, { recursive: true, force: true, maxRetries: 3 });
			removed.push(d);
		} catch {
			// Gone already, or a file held open on Windows past the retries,
			// which can leave part of the install deleted and the directory
			// still there: wp-build fails as before, and the next install on
			// the branch that owns it fills it back in.
		}
	}
	return removed;
}

/**
 * Parks the current ticket and checks out `ref`.
 *
 * The guard that matters: leaving *trunk* while it is dirty. Parking cannot
 * rescue that work (invariant 1) and a forced checkout would overwrite it, so
 * this refuses with `code: 'dirty-trunk'` and lets the caller offer the two
 * honest options — start a ticket for the work, or discard it. Silently
 * destroying edits is the one outcome this feature must never produce.
 *
 * Progress (#173) is reported through `onProgress` in this module's own
 * vocabulary — `scan`, `stage`, `commit`, then the checkout's own phase mapped
 * by switch-progress.cjs. The scans are announced before they start, because
 * `git status` says nothing while it runs and is roughly a third of a switch.
 *
 * `deleteTicketBranch` checks out too and is deliberately left silent: it runs
 * under a different busy flag in the panel, so covering it would mean a second
 * progress surface for a rarely-used destructive action.
 *
 * @param {string}   dir
 * @param {string}   ref
 * @param {Object}   [root0]
 * @param {string}   [root0.baseOid]    branch point of the branch being left
 * @param {Object}   [root0.author]
 * @param {Function} [root0.onProgress] told which stage is running (#173)
 * @param {Function} [root0.onChild]    handed the checkout's ChildProcess, so
 *                                      a quit can end it (killChildTree)
 */
async function switchToBranch(dir, ref, { baseOid, author = WIP_AUTHOR, onProgress = null, onChild = null } = {}) {
	const from = await currentBranchName(dir);
	if (from === ref) return { switched: false, from, to: ref, parked: false };

	const branches = await listBranches(dir);
	if (!branches.includes(ref)) {
		const error = new Error(`No such branch: ${ref}`);
		error.code = 'no-such-branch';
		throw error;
	}

	// Every payload carries where the switch is going, so the panel can name the
	// destination without tracking it separately; the park stages add where it
	// came from, which is the ticket whose work is being saved.
	const report = onProgress ? (p) => onProgress({ to: ref, ...p }) : null;

	let parked = false;
	if (from === TRUNK) {
		// A full scan that usually ends in "nothing to do" and occasionally in a
		// refusal — silent either way without this.
		if (report) report({ stage: 'scan', from });
		if (await hasChangesAgainst(dir)) {
			const error = new Error('Uncommitted work on trunk would be lost by switching');
			error.code = 'dirty-trunk';
			throw error;
		}
	} else if (from) {
		({ parked } = await parkCurrentWork(dir, { baseOid, author, onProgress: report }));
	}

	// Read before the checkout, while the branch being left still has its
	// `.gitignore` files on disk (#521). Best effort, here and after the
	// checkout: failing costs only the old behaviour, the files showing up as
	// changes, never the switch itself.
	// The same tree diff also names the directories the switch may leave
	// behind holding only an install (#529).
	let before = null;
	let candidates = new Set();
	try {
		const rows = await changedPathsBetween(dir, 'HEAD', ref);
		candidates = parentsOfDeleted(rows);
		before = await ignoredBeforeSwitch(dir, rows);
	} catch {
		before = null;
	}

	// Tagged with the stage it died in, the same contract updateToLatestTrunk
	// uses, because the two halves fail very differently.
	//
	// Git writes HEAD only after every file operation has succeeded. A failure
	// part-way — an EPERM on Windows from an editor or an antivirus holding a
	// file is the realistic trigger — therefore leaves HEAD on the branch we
	// are leaving, over a half-swapped worktree. Parking again in that state
	// would commit the mixed tree over the good WIP commit and, because parking
	// rewrites rather than appends, put the real work out of reach. The caller
	// has to record that and refuse to park until it is reconciled.
	try {
		await checkoutBranch(dir, ref, {
			...(report ? { onProgress: (p) => report(mapCheckoutPhase(p)) } : {}),
			...(onChild ? { onChild } : {})
		});
	} catch (e) {
		if (e && typeof e === 'object') {
			e.stage = 'checkout';
			e.from = from;
			e.to = ref;
		}
		throw e;
	}
	// Before the exclude: a directory holding what #521 excludes is not only
	// an install, and must be kept, not deleted.
	let removed = [];
	try { removed = await removeLeftoverInstalls(dir, candidates); } catch { removed = []; }
	let excluded = [];
	if (before) {
		try { excluded = await excludeLeftovers(dir, before); } catch { excluded = []; }
	}
	if (report) report({ stage: 'done', from });
	return { switched: true, from, to: ref, parked, excluded, removed };
}

/**
 * Finishes a switch that died in its checkout (#385): the forced checkout to
 * `ref` again, and nothing else. No park and no dirty-trunk check, because
 * the branch being left already parked before the first attempt moved a
 * file (a park always precedes the checkout in `switchToBranch`), and
 * parking again would commit the half-swapped worktree over that good WIP
 * commit, which is the one thing the caller's marker exists to prevent. The
 * forced checkout overwrites the mixture with `ref`'s tree, HEAD included;
 * `ref` may be the branch HEAD is already on, which is how a trunk that a
 * failed switch left half-swapped is put back.
 *
 * Edits made on the mixed tree after the failure go with it: the app told
 * the contributor to retry before making other changes.
 *
 * @param {string}   dir
 * @param {string}   ref
 * @param {Object}   [root0]
 * @param {Function} [root0.onProgress]
 * @param {Function} [root0.onChild]
 */
async function resumeSwitch(dir, ref, { onProgress = null, onChild = null } = {}) {
	const from = await currentBranchName(dir);
	const report = onProgress ? (p) => onProgress({ to: ref, ...p }) : null;
	try {
		await checkoutBranch(dir, ref, {
			...(report ? { onProgress: (p) => report(mapCheckoutPhase(p)) } : {}),
			...(onChild ? { onChild } : {})
		});
	} catch (e) {
		if (e && typeof e === 'object') {
			e.stage = 'checkout';
			e.from = from;
			e.to = ref;
		}
		throw e;
	}
	if (report) report({ stage: 'done', from });
	return { switched: from !== ref, from, to: ref, parked: false };
}

/**
 * Moves a ticket's work onto the current trunk (#385): the one-click form of
 * "save a patch, unlink, delete the branch, link again, apply the patch".
 *
 * The branch holds exactly one WIP commit whose parent is `baseOid`, so the
 * move is one three-way merge of that commit's tree onto trunk from the base
 * (`mergeTree`), a new WIP commit with trunk as its parent, and the ref
 * moved onto it. Invariant 2 holds afterwards: still one commit, still
 * parented on the branch's base, which is now trunk's tip; the caller records
 * that base. All or nothing, like a patch: a conflict is a refusal that names
 * the paths, with nothing written but unreachable objects.
 *
 * If the branch is checked out, loose edits are its work too and are parked
 * into the WIP first, the way a switch parks them; the forced checkout at
 * the end then makes the worktree the rebased tree. A branch that is not
 * checked out is parked already and its files are not on disk.
 *
 * @param {string}   dir
 * @param {string}   ref
 * @param {Object}   root0
 * @param {string}   root0.baseOid      the branch's recorded base
 * @param {Object}   [root0.author]
 * @param {Function} [root0.onProgress] the park's stages, then `rebase`, then the checkout's
 * @param {Function} [root0.onChild]    handed the checkout's ChildProcess
 * @return {Promise<{rebased: boolean, from: string, to: string, parked: boolean, oid: ?string}>}
 */
async function rebaseOntoTrunk(dir, ref, { baseOid, author = WIP_AUTHOR, onProgress = null, onChild = null } = {}) {
	if (!baseOid) {
		const error = new Error('This ticket has no recorded starting point');
		error.code = 'no-base';
		throw error;
	}
	const trunkTip = await trunkOid(dir);
	if (trunkTip === baseOid) return { rebased: false, from: baseOid, to: trunkTip, parked: false, oid: null };

	const report = onProgress ? (p) => onProgress({ to: ref, ...p }) : null;
	const active = (await currentBranchName(dir)) === ref;
	let parked = false;
	if (active) ({ parked } = await parkCurrentWork(dir, { baseOid, author, onProgress: report }));

	const wip = await resolveRef(dir, ref);
	if (!wip) {
		const error = new Error(`No such branch: ${ref}`);
		error.code = 'no-such-branch';
		throw error;
	}
	if (report) report({ stage: 'rebase', from: ref });
	let oid;
	if (wip === baseOid) {
		// A ticket with no work yet: nothing to replay, the branch just starts
		// from the new trunk.
		oid = trunkTip;
	} else {
		const { tree, conflicted, conflicts, kinds } = await mergeTree(dir, { base: baseOid, ours: trunkTip, theirs: wip });
		if (conflicted) {
			const error = new Error(conflicts.length
				? `Trunk and this ticket's work disagree in ${conflicts.length} ${conflicts.length === 1 ? 'file' : 'files'}`
				: 'Trunk and this ticket\'s work disagree');
			error.code = 'rebase-conflict';
			error.conflicts = conflicts;
			// Which way each file disagrees (`content`, `modify/delete`,
			// `add/add`), so the refusal can say so (#351).
			error.kinds = kinds;
			throw error;
		}
		oid = await commitTree(dir, { tree, parent: trunkTip, message: WIP_MESSAGE, author });
	}
	// `expected` is the tip read above: a second writer moving the branch in
	// the meantime fails here rather than being overwritten.
	await updateBranch(dir, ref, oid, { expected: wip });

	if (active) {
		// The tree on disk is the old WIP's; the forced checkout makes it the
		// new one. Tagged the way a switch tags it, so a failure here leaves
		// the caller's marker and `resumeSwitch(ref)` is the retry.
		try {
			await checkoutBranch(dir, ref, {
				...(report ? { onProgress: (p) => report(mapCheckoutPhase(p)) } : {}),
				...(onChild ? { onChild } : {})
			});
		} catch (e) {
			if (e && typeof e === 'object') {
				e.stage = 'checkout';
				e.from = ref;
				e.to = ref;
				// The ref is on the new trunk whatever the tree looks like; the
				// caller records that base now, or every patch until the
				// retry would be measured from the old one.
				e.movedTo = trunkTip;
			}
			throw e;
		}
	}
	if (report) report({ stage: 'done', from: ref });
	return { rebased: true, from: baseOid, to: trunkTip, parked, oid };
}

/**
 * Deletes a ticket branch and everything committed on it — the "delete this
 * ticket's work" action, which under this model is a branch deletion and not a
 * site reset (#108).
 *
 * Refuses `trunk` outright: it is the diff base for every other branch and the
 * only thing standing between the user and a re-clone. Same shape of guard as
 * `isRegisteredSite` in site-registry.js, and for the same reason — the
 * destructive call gets a boundary in front of it rather than trusting callers.
 *
 * @param {string}   dir
 * @param {string}   ref
 * @param {Object}   [root0]
 * @param {Function} [root0.onChild] handed the checkout's ChildProcess, if one runs
 */
async function deleteTicketBranch(dir, ref, { onChild = null } = {}) {
	if (ref === TRUNK || ticketIdFromRef(ref) === null) {
		const error = new Error(`Refusing to delete ${ref === TRUNK ? 'trunk' : 'a branch the app did not create'}`);
		error.code = 'not-a-ticket-branch';
		throw error;
	}
	const branches = await listBranches(dir);
	if (!branches.includes(ref)) {
		const error = new Error(`No such branch: ${ref}`);
		error.code = 'no-such-branch';
		throw error;
	}

	// Leaving the branch checked out while deleting it would strand HEAD on a
	// ref that no longer exists; going to trunk first also restores the worktree
	// the user expects to be looking at afterwards. The checkout is forced
	// because the branch being discarded is dirty by definition.
	if (await currentBranchName(dir) === ref) {
		await checkoutBranch(dir, TRUNK, onChild ? { onChild } : {});
	}
	await deleteBranch(dir, ref);
	return { deleted: true, ref };
}

module.exports = {
	TRUNK,
	WORK_ITEM_BRANCH_PREFIXES,
	WIP_MESSAGE,
	WIP_AUTHOR,
	ticketBranchRef,
	ticketIdFromRef,
	prBranchRef,
	prNumberFromRef,
	currentBranchName,
	listTicketBranches,
	stageWorktree,
	scanWorktree,
	hasChangesAgainst,
	countChangesAgainst,
	parkCurrentWork,
	startTicketBranch,
	switchToBranch,
	leftoverEntries,
	resumeSwitch,
	rebaseOntoTrunk,
	deleteTicketBranch
};
