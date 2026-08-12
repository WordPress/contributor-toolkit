'use strict';

// The carry itself (#305), against real on-disk repositories.
//
// Nothing here is stubbed, and `applyPatchToDir` in particular is not: a
// collision has to come from real bytes in a real repo, or the test proves that
// a mock returned what it was told to. Same reason the classifier's suite runs
// against real commits — this is a feature about what is actually on disk
// afterwards, and every assertion below is about that.
//
// The fixture mirrors ticket-branches.integration.test.cjs's `makeSite` — a
// `trunk` branch over a wordpress-develop-shaped tree, a gitignored
// `node_modules`, a file to delete — and adds the one thing the carry needs:
// trunk can be advanced by a second commit while the ticket stays where it was.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('isomorphic-git');
const {
	carryTicketForward,
	reconcileCarry,
	collectTicketChanges,
	buildCarryPatch,
	CARRY_FAILURE,
	REFUSAL
} = require('../src/ticket-carry.js');
const { startTicketBranch, parkCurrentWork, currentBranchName } = require('../src/ticket-branches.js');
const { applyPatchToDir } = require('../src/patch-apply.js');

const TRUNK = 'trunk';
const TICKET = 'ticket/59234';
const AUTHOR = { name: 'test', email: 'test@example.com' };

const BASE_TIME = Math.floor(Date.UTC(2026, 0, 10) / 1000);
const LATER_TIME = Math.floor(Date.UTC(2026, 1, 20) / 1000);
const stamped = (timestamp) => ({ ...AUTHOR, timestamp, timezoneOffset: 0 });

const abs = (dir, file) => path.join(dir, file);
const read = (dir, file) => fs.readFileSync(abs(dir, file), 'utf8');
const exists = (dir, file) => fs.existsSync(abs(dir, file));

async function makeSite(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carry-forward-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: TRUNK });
	fs.writeFileSync(abs(dir, '.gitignore'), 'node_modules/\nbuild/\n');
	fs.writeFileSync(abs(dir, 'wp-login.php'), '<?php // trunk\n');
	fs.writeFileSync(abs(dir, 'doomed.php'), '<?php // to be deleted\n');
	fs.writeFileSync(abs(dir, 'untouched.php'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\neight\n');
	// A `src/` file too, because a handed-over patch's paths are read through
	// `mapToSrcLayout` — a layer fixture outside it would never resolve.
	fs.mkdirSync(abs(dir, 'src'), { recursive: true });
	fs.writeFileSync(abs(dir, 'src/wp-settings.php'), '<?php // settings\n');
	await git.add({ fs, dir, filepath: ['.gitignore', 'wp-login.php', 'doomed.php', 'untouched.php', 'src/wp-settings.php'] });
	const baseOid = await git.commit({
		fs, dir, message: 'trunk', author: stamped(BASE_TIME), committer: stamped(BASE_TIME)
	});

	// The substrate: gitignored, expensive, and must survive the carry.
	fs.mkdirSync(abs(dir, 'node_modules/react'), { recursive: true });
	fs.writeFileSync(abs(dir, 'node_modules/react/index.js'), 'expensive\n');
	return { dir, baseOid };
}

/**
 * Advances `trunk` by a second commit, later in time, and returns the site to
 * whatever was checked out — the shape "Update to latest trunk" leaves behind.
 *
 * @param {string}   dir
 * @param {Function} mutate Called with `dir`; makes trunk's own changes.
 * @return {Promise<string>} The new trunk oid.
 */
async function advanceTrunk(dir, mutate) {
	const restore = (await currentBranchName(dir)) || TRUNK;
	await git.checkout({ fs, dir, ref: TRUNK, force: true });
	await mutate(dir);
	for (const [filepath, , workdir] of await git.statusMatrix({ fs, dir })) {
		if (workdir === 0) await git.remove({ fs, dir, filepath });
		else await git.add({ fs, dir, filepath });
	}
	const oid = await git.commit({
		fs, dir, message: 'upstream', author: stamped(LATER_TIME), committer: stamped(LATER_TIME)
	});
	await git.checkout({ fs, dir, ref: restore, force: true });
	return oid;
}

/**
 * A site with a ticket branch holding the contributor's work, and a trunk that
 * has moved past it — the state the carry exists for.
 *
 * @param {Object}   t
 * @param {Function} ticketWork   Called with `dir` on the ticket branch.
 * @param {Function} upstreamWork Called with `dir` on trunk.
 */
async function siteBehindTrunk(t, ticketWork, upstreamWork) {
	const { dir, baseOid } = await makeSite(t);
	await startTicketBranch(dir, 59234);
	await ticketWork(dir);
	await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	const trunkOid = await advanceTrunk(dir, upstreamWork);
	return { dir, baseOid, trunkOid };
}

/** Collects everything the carry would persist, without any electron-store. */
function recorder() {
	const state = { marker: null, base: null, markers: [] };
	return {
		state,
		setMarker: async (marker) => { state.marker = marker; state.markers.push(marker); },
		setBase: async (base) => { state.base = base; }
	};
}

/**
 * The patch this ticket would produce now, built by the app's own machinery
 * against whatever base it is on.
 *
 * @param {string} dir
 * @param {string} baseOid
 * @return {Promise<string>}
 */
async function patchOfTicketWork(dir, baseOid) {
	const changes = await collectTicketChanges(dir, baseOid);
	return buildCarryPatch(dir, {
		baseOid,
		wipOid: await git.resolveRef({ fs, dir, ref: TICKET }),
		paths: changes.filter((c) => !c.binary && !c.unreadable).map((c) => c.path)
	});
}

// --- the point of the whole feature ---------------------------------------

// Before the carry, the ticket's patch is written against a trunk that has
// moved: applying it upstream fails, and generating it against today's trunk
// would embed reversed upstream hunks. Afterwards it contains the contributor's
// change and nothing else. That assertion *is* the feature.
test('a disjoint change carries, and the patch afterwards holds only the contributor\'s work (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.writeFileSync(abs(d, 'wp-login.php'), '<?php // trunk\n// my fix\n'),
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'one\ntwo\nthree\nfour\nfive\nsix\nseven\nupstream\n')
	);
	const store = recorder();

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...store });
	assert.equal(res.ok, true);
	assert.equal(res.baseOid, trunkOid);
	assert.deepEqual(store.state.base, { baseOid: trunkOid, oid: res.oid });
	assert.equal(store.state.marker, null, 'the marker is cleared once the new state exists');

	// On the ticket, with both changes present.
	assert.equal(await currentBranchName(dir), TICKET);
	assert.equal(read(dir, 'wp-login.php'), '<?php // trunk\n// my fix\n');
	assert.equal(read(dir, 'untouched.php').endsWith('upstream\n'), true, 'upstream\'s change came with the new base');

	// And the branch really is based on the new trunk.
	const log = await git.log({ fs, dir, ref: TICKET });
	assert.equal(log[0].commit.parent[0], trunkOid);

	const patch = await patchOfTicketWork(dir, trunkOid);
	assert.match(patch, /\+\/\/ my fix/);
	assert.doesNotMatch(patch, /untouched\.php/, 'the patch must not mention a file only trunk changed');
	assert.doesNotMatch(patch, /^-upstream$/m, 'and it must not reverse an upstream hunk');
});

// The case the rejected patch-only design could never have handled: a unified
// diff cannot carry bytes, so the checkout onto new trunk would have deleted
// this file outright.
test('a binary file carries byte-identically (#305)', async (t) => {
	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02, 0xff, 0x00]);
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => {
			fs.mkdirSync(abs(d, 'assets'), { recursive: true });
			fs.writeFileSync(abs(d, 'assets/logo.png'), bytes);
		},
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n')
	);

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...recorder() });
	assert.equal(res.ok, true);
	assert.deepEqual(fs.readFileSync(abs(dir, 'assets/logo.png')), bytes);

	// And it is committed, not merely left on disk: the next switch must not lose it.
	const { blob } = await git.readBlob({ fs, dir, oid: res.oid, filepath: 'assets/logo.png' });
	assert.deepEqual(Buffer.from(blob), bytes);
});

// #311's case, and the reason the carry reads absence from trees rather than
// bytes: both sides of an empty add compare equal as text.
test('an empty added file survives the carry (#305, #311)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.writeFileSync(abs(d, 'placeholder.php'), ''),
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n')
	);

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...recorder() });
	assert.equal(res.ok, true);
	assert.equal(exists(dir, 'placeholder.php'), true, 'an empty file the ticket added must not vanish');
	assert.equal(read(dir, 'placeholder.php'), '');
	assert.ok((await git.listFiles({ fs, dir, ref: TICKET })).includes('placeholder.php'));
});

test('a deletion carries (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.unlinkSync(abs(d, 'doomed.php')),
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n')
	);

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...recorder() });
	assert.equal(res.ok, true);
	assert.equal(exists(dir, 'doomed.php'), false, 'the file must stay deleted on the new trunk');
	assert.equal((await git.listFiles({ fs, dir, ref: TICKET })).includes('doomed.php'), false);
});

// Asserted on the recorded mode rather than on the filesystem, so it holds on
// Windows — where there is no executable bit to read and `git.add` would demote
// a 100755 file to 100644 on the way through.
test('the executable bit is preserved, in the commit not just on disk (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => {
			fs.mkdirSync(abs(d, 'tools'), { recursive: true });
			fs.writeFileSync(abs(d, 'tools/build.sh'), '#!/bin/sh\necho hi\n', { mode: 0o755 });
		},
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n')
	);
	// Parked on POSIX, so the branch really does record 100755 going in. On a
	// platform that cannot express it there is nothing to preserve, and the
	// assertion below would be about the fixture rather than the carry.
	const before = await git.walk({
		fs, dir,
		trees: [git.TREE({ ref: TICKET })],
		map: async (filepath, [entry]) => (filepath === 'tools/build.sh' ? entry.mode() : undefined)
	});
	if (before[0] !== 0o100755) {
		t.skip('this filesystem does not record an executable bit');
		return;
	}

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...recorder() });
	assert.equal(res.ok, true);

	const after = await git.walk({
		fs, dir,
		trees: [git.TREE({ ref: res.oid })],
		map: async (filepath, [entry]) => (filepath === 'tools/build.sh' ? entry.mode() : undefined)
	});
	assert.equal(after[0], 0o100755, 'the mode git recorded has to survive, whatever the filesystem says');

	// And on disk too, or the very next park — which reads the mode off lstat —
	// takes the bit straight back off the file the carry just preserved it on.
	// eslint-disable-next-line no-bitwise -- 0o111 is the executable bit; masking is how a POSIX mode is read.
	assert.notEqual(fs.statSync(abs(dir, 'tools/build.sh')).mode & 0o111, 0);
	fs.appendFileSync(abs(dir, 'tools/build.sh'), 'echo again\n');
	await parkCurrentWork(dir, { baseOid: trunkOid, author: AUTHOR });
	const afterPark = await git.walk({
		fs, dir,
		trees: [git.TREE({ ref: TICKET })],
		map: async (filepath, [entry]) => (filepath === 'tools/build.sh' ? entry.mode() : undefined)
	});
	assert.equal(afterPark[0], 0o100755, 'and it has to survive the next save, not just the carry');
});

test('the gitignored substrate is never touched (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.writeFileSync(abs(d, 'wp-login.php'), '<?php // trunk\n// my fix\n'),
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n')
	);
	const dep = abs(dir, 'node_modules/react/index.js');
	const before = fs.statSync(dep).mtimeMs;

	await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...recorder() });

	assert.equal(fs.readFileSync(dep, 'utf8'), 'expensive\n');
	assert.equal(fs.statSync(dep).mtimeMs, before, 'node_modules must not be rewritten by a carry');
	assert.equal((await git.listFiles({ fs, dir, ref: TICKET })).some((f) => f.startsWith('node_modules/')), false);
});

// --- when it will not go through ------------------------------------------

// The refusal that matters most: a real conflict, from real bytes. Both sides
// edit the same lines, so the replay genuinely cannot apply — and the ticket
// has to come out of it byte-for-byte and commit-for-commit unchanged.
test('a collision refuses and leaves the ticket exactly as it was (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'one\ntwo\nMINE\nfour\nfive\nsix\nseven\neight\n'),
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'one\ntwo\nTHEIRS\nfour\nfive\nsix\nseven\neight\n')
	);
	const store = recorder();
	const oidBefore = await git.resolveRef({ fs, dir, ref: TICKET });
	const contentsBefore = read(dir, 'untouched.php');

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...store });
	assert.equal(res.ok, false);
	assert.equal(res.code, CARRY_FAILURE.CONFLICT);
	assert.deepEqual(res.merge, ['untouched.php'], 'the report names the file that no longer takes the change');

	// The oid, not just the contents: a rewritten WIP commit with identical
	// bytes would still have thrown the contributor's history away.
	assert.equal(await git.resolveRef({ fs, dir, ref: TICKET }), oidBefore);
	assert.equal(await currentBranchName(dir), TICKET);
	assert.equal(read(dir, 'untouched.php'), contentsBefore);
	assert.equal(read(dir, 'wp-login.php'), '<?php // trunk\n');
	assert.equal(store.state.marker, null, 'a failed carry leaves no marker behind');
	assert.equal(store.state.base, null, 'and does not move the recorded base');
	assert.ok(store.state.markers.length >= 1, 'but it did set one while the tree was in motion');
});

test('a file upstream deleted that the ticket edited gets its own refusal (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.writeFileSync(abs(d, 'doomed.php'), '<?php // still working on this\n'),
		(d) => fs.unlinkSync(abs(d, 'doomed.php'))
	);
	const store = recorder();
	const oidBefore = await git.resolveRef({ fs, dir, ref: TICKET });

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...store });
	assert.equal(res.ok, false);
	assert.equal(res.code, CARRY_FAILURE.REFUSED);
	assert.deepEqual(res.refused, [{ path: 'doomed.php', reason: REFUSAL.UPSTREAM_DELETED }]);

	// Refused before anything moved at all, so not even a marker was written.
	assert.equal(await git.resolveRef({ fs, dir, ref: TICKET }), oidBefore);
	assert.equal(read(dir, 'doomed.php'), '<?php // still working on this\n');
	assert.deepEqual(store.state.markers, []);
});

// --- nothing to carry ------------------------------------------------------

test('a ticket with no work moves its base and goes nowhere near the patch code (#305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	await startTicketBranch(dir, 59234);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n'));
	const store = recorder();

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...store });
	assert.equal(res.ok, true);
	assert.deepEqual(res.merge, [], 'nothing to replay means the patch machinery is never reached');
	assert.deepEqual(res.wholesale, []);
	assert.equal(store.state.base.baseOid, trunkOid);
	assert.equal(await git.resolveRef({ fs, dir, ref: TICKET }), trunkOid, 'the branch is trunk, with no WIP commit on it');
	assert.equal(read(dir, 'untouched.php'), 'upstream only\n');
});

// --- with a patch applied on top (#306) ------------------------------------

// The patch a mentor handed over, in the shape the app stores it: text kept, so
// it can be lifted out. Written against the ticket's own base.
const LAYER_PATCH = [
	'--- a/src/wp-settings.php',
	'+++ b/src/wp-settings.php',
	'@@ -1 +1,2 @@',
	' <?php // settings',
	'+// from the pull request',
	''
].join('\n');

test('with a liftable patch applied, both layers come across (#305, #306)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	await startTicketBranch(dir, 59234);
	// The contributor's own work, then somebody else's patch on top of it.
	fs.writeFileSync(abs(dir, 'my-notes.php'), '<?php // mine\n');
	const applied = await applyPatchToDir({ dir, patchText: LAYER_PATCH });
	assert.equal(applied.ok, true, 'the fixture has to really apply, or this proves nothing');
	await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n'));

	const res = await carryTicketForward({
		dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR,
		appliedPatch: { label: 'Pull request #1234', text: LAYER_PATCH },
		...recorder()
	});
	assert.equal(res.ok, true);
	assert.equal(res.patchKept, true);
	assert.equal(read(dir, 'my-notes.php'), '<?php // mine\n', 'the contributor\'s own work came across');
	assert.match(read(dir, 'src/wp-settings.php'), /from the pull request/, 'and the layer went back on top');
	assert.equal(read(dir, 'untouched.php'), 'upstream only\n', 'on the new trunk');
});

test('a stored patch that no longer applies loses its record, not the contributor\'s work (#305, #306)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	await startTicketBranch(dir, 59234);
	fs.writeFileSync(abs(dir, 'my-notes.php'), '<?php // mine\n');
	assert.equal((await applyPatchToDir({ dir, patchText: LAYER_PATCH })).ok, true);
	await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	// Upstream rewrote the very line the patch anchors on, so it lifts out
	// cleanly here and refuses to go back on over there. Real bytes, no stub.
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(abs(d, 'src/wp-settings.php'), '<?php // upstream rewrote this file entirely\n'));

	const res = await carryTicketForward({
		dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR,
		appliedPatch: { label: 'Pull request #1234', text: LAYER_PATCH },
		...recorder()
	});
	assert.equal(res.ok, true, 'the contributor\'s own work still carried');
	assert.equal(res.patchKept, false);
	assert.equal(res.patchLabel, 'Pull request #1234', 'the message can name the pull request');
	assert.equal(read(dir, 'my-notes.php'), '<?php // mine\n');
	assert.match(read(dir, 'src/wp-settings.php'), /upstream rewrote this file entirely/);
});

// The cell the other tests do not reach: a lift succeeded, so the ref has
// already moved to the contributor's work *without* the layer — and then the
// replay collides. "Nothing moved" has to be literally true, layer included.
test('a collision after the layer was lifted out puts the layer back too (#305, #306)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	await startTicketBranch(dir, 59234);
	// Work on a file trunk is about to move underneath, plus a patch on another.
	fs.writeFileSync(abs(dir, 'untouched.php'), 'one\ntwo\nMINE\nfour\nfive\nsix\nseven\neight\n');
	assert.equal((await applyPatchToDir({ dir, patchText: LAYER_PATCH })).ok, true);
	await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	const oidBefore = await git.resolveRef({ fs, dir, ref: TICKET });
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(abs(d, 'untouched.php'), 'one\ntwo\nTHEIRS\nfour\nfive\nsix\nseven\neight\n'));
	const store = recorder();

	const res = await carryTicketForward({
		dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR,
		appliedPatch: { label: 'Pull request #1234', text: LAYER_PATCH },
		...store
	});
	assert.equal(res.ok, false);
	assert.equal(res.code, CARRY_FAILURE.CONFLICT);

	// Every part of "exactly as it was", including the part the lift moved.
	assert.equal(await git.resolveRef({ fs, dir, ref: TICKET }), oidBefore, 'the WIP commit must be the one the ticket had');
	assert.equal(await currentBranchName(dir), TICKET);
	assert.equal(read(dir, 'untouched.php'), 'one\ntwo\nMINE\nfour\nfive\nsix\nseven\neight\n');
	assert.match(read(dir, 'src/wp-settings.php'), /from the pull request/, 'the lifted layer has to come back');
	assert.equal(store.state.marker, null);
});

// A refusal names the file that actually collided, not every file that happened
// to take the replay route — `applyPatchToDir` is all-or-nothing, so one bad
// file stops the good ones with it.
test('a collision reports which file collided, not the whole replay set (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => {
			fs.writeFileSync(abs(d, 'untouched.php'), 'one\ntwo\nMINE\nfour\nfive\nsix\nseven\neight\n');
			fs.writeFileSync(abs(d, 'wp-login.php'), '<?php // trunk\n// mine too\n');
		},
		(d) => {
			fs.writeFileSync(abs(d, 'untouched.php'), 'one\ntwo\nTHEIRS\nfour\nfive\nsix\nseven\neight\n');
			fs.writeFileSync(abs(d, 'wp-login.php'), '<?php // trunk\n// and a line upstream added at the end\n');
		}
	);

	const res = await carryTicketForward({ dir, ref: TICKET, baseOid, trunkOid, author: AUTHOR, ...recorder() });
	assert.equal(res.ok, false);
	assert.equal(res.merge.length, 2, 'both files took the replay route');
	assert.deepEqual(res.conflictPaths, ['untouched.php'], 'only one of them actually collided');
});

// --- recovery --------------------------------------------------------------

// The window the marker exists for: the branch ref has moved and no ref points
// at the contributor's work any more. Set by hand, as a crash would leave it.
test('reconciling an interrupted carry puts the branch back where the marker says (#305)', async (t) => {
	const { dir, baseOid, trunkOid } = await siteBehindTrunk(
		t,
		(d) => fs.writeFileSync(abs(d, 'wp-login.php'), '<?php // trunk\n// my fix\n'),
		(d) => fs.writeFileSync(abs(d, 'untouched.php'), 'upstream only\n')
	);
	const oldOid = await git.resolveRef({ fs, dir, ref: TICKET });

	// Exactly the state a crash between step 4 and step 7 leaves: the ref moved
	// onto trunk, the worktree trunk's, and only the marker knowing better.
	await git.writeRef({ fs, dir, ref: `refs/heads/${TICKET}`, value: trunkOid, force: true });
	await git.checkout({ fs, dir, ref: TICKET, force: true });
	assert.equal(read(dir, 'wp-login.php'), '<?php // trunk\n', 'the fixture must really have lost the work');

	const res = await reconcileCarry({ dir, marker: { ref: TICKET, oldOid, trunkOid, baseOid } });
	assert.deepEqual(res, { ok: true, ref: TICKET, oid: oldOid });
	assert.equal(await git.resolveRef({ fs, dir, ref: TICKET }), oldOid);
	assert.equal(await currentBranchName(dir), TICKET);
	assert.equal(read(dir, 'wp-login.php'), '<?php // trunk\n// my fix\n', 'and the worktree comes back with it');
});

test('a marker with nothing to point at refuses rather than guessing (#305)', async (t) => {
	const { dir } = await makeSite(t);
	await assert.rejects(
		() => reconcileCarry({ dir, marker: { ref: TICKET } }),
		(e) => e.code === 'carry-marker-incomplete'
	);
});
