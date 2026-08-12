'use strict';

// Integration tests for src/ticket-carry.js (#305) against real on-disk
// repositories — no mocking of isomorphic-git, same as the ticket-branches and
// trunk-update suites.
//
// The two questions under test are both answered from commit objects, so a
// stub would be mocking the thing being tested: whether trunk has moved past a
// ticket's branch point, and what each of the ticket's changed paths would mean
// on the new trunk.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('isomorphic-git');
const { trunkMovedPast, classifyCarry, carryStatus } = require('../src/ticket-carry.js');
const { CARRY_STATE, REFUSAL } = require('../src/renderer/carry-note.cjs');

const TRUNK = 'trunk';
const AUTHOR = { name: 'test', email: 'test@example.com' };

// Explicit timestamps, because the whole detection rests on them and two
// commits made in the same test run land in the same second otherwise — which
// is precisely the tie the module answers "not behind" to.
const BASE_TIME = Math.floor(Date.UTC(2026, 0, 10) / 1000);
const LATER_TIME = Math.floor(Date.UTC(2026, 1, 20) / 1000);

const stamped = (timestamp) => ({ ...AUTHOR, timestamp, timezoneOffset: 0 });

/**
 * A site as the app makes one: a `trunk` branch over a wordpress-develop-shaped
 * tree, plus the gitignored substrate a ticket must never disturb.
 *
 * @param {Object} t node:test's context, for the temp-directory cleanup.
 */
async function makeSite(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-carry-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: TRUNK });
	fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\nbuild/\n');
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // trunk\n');
	fs.writeFileSync(path.join(dir, 'doomed.php'), '<?php // to be deleted\n');
	fs.writeFileSync(path.join(dir, 'settled.php'), '<?php // nobody touches this\n');
	await git.add({ fs, dir, filepath: ['.gitignore', 'wp-login.php', 'doomed.php', 'settled.php'] });
	const baseOid = await git.commit({
		fs, dir, message: 'trunk', author: stamped(BASE_TIME), committer: stamped(BASE_TIME)
	});

	fs.mkdirSync(path.join(dir, 'node_modules', 'react'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'node_modules', 'react', 'index.js'), 'expensive\n');
	return { dir, baseOid };
}

/**
 * Moves `trunk` on the way the site update does — a second commit, later in
 * time — and puts the worktree back where it was, so a test can go on reading
 * the ticket's side.
 *
 * @param {string}   dir
 * @param {Function} mutate      Called with `dir`; makes trunk's own changes.
 * @param {number}   [timestamp]
 * @return {Promise<string>} The new trunk oid.
 */
async function advanceTrunk(dir, mutate, timestamp = LATER_TIME) {
	const restore = (await git.currentBranch({ fs, dir, fullname: false })) || TRUNK;
	await git.checkout({ fs, dir, ref: TRUNK, force: true });
	await mutate(dir);
	const matrix = await git.statusMatrix({ fs, dir });
	for (const [filepath, , workdir] of matrix) {
		if (workdir === 0) await git.remove({ fs, dir, filepath });
		else await git.add({ fs, dir, filepath });
	}
	const oid = await git.commit({
		fs, dir, message: 'upstream', author: stamped(timestamp), committer: stamped(timestamp)
	});
	await git.checkout({ fs, dir, ref: restore, force: true });
	return oid;
}

// --- is this ticket behind? ------------------------------------------------

test('a ticket on the trunk the site has is current (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const moved = await trunkMovedPast(dir, { baseOid, trunkOid: baseOid });
	assert.equal(moved.state, CARRY_STATE.CURRENT);
});

test('a trunk commit newer than the ticket\'s base is behind, with both dates (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	const moved = await trunkMovedPast(dir, { baseOid, trunkOid });
	assert.equal(moved.state, CARRY_STATE.BEHIND);
	assert.equal(moved.baseDate, new Date(BASE_TIME * 1000).toISOString());
	assert.equal(moved.trunkDate, new Date(LATER_TIME * 1000).toISOString());
});

// Depth-1 clones are the whole reason this is a timestamp comparison: the two
// commits share no reachable history, so an ancestry check would answer wrongly
// or throw. Asserted by making trunk a commit with no parent at all — exactly
// what a shallow re-fetch produces.
test('detection does not need the two commits to share history (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const blob = await git.writeBlob({ fs, dir, blob: Buffer.from('<?php // unrelated\n') });
	const tree = await git.writeTree({ fs, dir, tree: [{ mode: '100644', path: 'wp-login.php', oid: blob, type: 'blob' }] });
	const trunkOid = await git.writeCommit({
		fs, dir,
		commit: {
			tree, parent: [],
			author: stamped(LATER_TIME), committer: stamped(LATER_TIME),
			message: 'shallow tip\n'
		}
	});
	// Ancestry has no signal to give here: the new tip is not reachable from the
	// old base and never will be on a shallow clone, so a descendant check says
	// "no" about a trunk that is plainly newer. The timestamps do not.
	assert.equal(
		await git.isDescendent({ fs, dir, oid: trunkOid, ancestor: baseOid }),
		false,
		'the fixture must really be an unrelated tip, or this proves nothing'
	);

	assert.equal((await trunkMovedPast(dir, { baseOid, trunkOid })).state, CARRY_STATE.BEHIND);
});

test('a trunk no newer than the base is not behind, tie included (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const sameSecond = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // same second\n'), BASE_TIME);
	assert.equal((await trunkMovedPast(dir, { baseOid, trunkOid: sameSecond })).state, CARRY_STATE.CURRENT);
});

test('a base commit that will not read answers unknown, never current (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const missing = '0'.repeat(40);
	assert.equal((await trunkMovedPast(dir, { baseOid: missing, trunkOid: baseOid })).state, CARRY_STATE.UNKNOWN);
	assert.equal((await trunkMovedPast(dir, { baseOid: null, trunkOid: baseOid })).state, CARRY_STATE.UNKNOWN);
});

// --- what each path would mean --------------------------------------------

test('a path upstream never touched carries wholesale (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'wp-login.php' }], baseOid, trunkOid });
	assert.deepEqual(out, { wholesale: ['wp-login.php'], merge: [], settled: [], refused: [] });
});

test('a file neither side has — the ticket added it — carries wholesale (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'src/brand-new.php' }], baseOid, trunkOid });
	assert.deepEqual(out.wholesale, ['src/brand-new.php']);
	assert.deepEqual(out.refused, []);
});

test('a path upstream has also changed goes through the patch route (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'wp-login.php'), '<?php // upstream edit\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'wp-login.php' }], baseOid, trunkOid });
	assert.deepEqual(out, { wholesale: [], merge: ['wp-login.php'], settled: [], refused: [] });
});

test('a file upstream deleted that the ticket has work in is refused (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.unlinkSync(path.join(d, 'doomed.php')));

	const out = await classifyCarry(dir, { files: [{ path: 'doomed.php' }], baseOid, trunkOid });
	assert.deepEqual(out.refused, [{ path: 'doomed.php', reason: REFUSAL.UPSTREAM_DELETED }]);
	assert.deepEqual(out.wholesale, []);
});

test('a path both sides added is refused rather than overwritten (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => {
		fs.mkdirSync(path.join(d, 'src'), { recursive: true });
		fs.writeFileSync(path.join(d, 'src', 'contested.php'), '<?php // upstream added this\n');
	});

	const out = await classifyCarry(dir, { files: [{ path: 'src/contested.php' }], baseOid, trunkOid });
	assert.deepEqual(out.refused, [{ path: 'src/contested.php', reason: REFUSAL.ADDED_BOTH }]);
});

test('a binary only the ticket changed still carries wholesale (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	// The route a patch-only carry could never take: no diff is involved, so
	// binariness is irrelevant when upstream has not touched the file.
	const out = await classifyCarry(dir, { files: [{ path: 'logo.png', binary: true }], baseOid, trunkOid });
	assert.deepEqual(out.wholesale, ['logo.png']);
	assert.deepEqual(out.refused, []);
});

test('a binary both sides changed is refused — nothing can combine the two (issue #305)', async (t) => {
	const { dir } = await makeSite(t);
	fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
	await git.add({ fs, dir, filepath: 'logo.png' });
	const withBinary = await git.commit({
		fs, dir, message: 'base with binary', author: stamped(BASE_TIME), committer: stamped(BASE_TIME)
	});
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'logo.png'), Buffer.from([0x89, 0x50, 0x00, 0x02])));

	const out = await classifyCarry(dir, { files: [{ path: 'logo.png', binary: true }], baseOid: withBinary, trunkOid });
	assert.deepEqual(out.refused, [{ path: 'logo.png', reason: REFUSAL.BINARY_CONFLICT }]);
	assert.deepEqual(out.merge, [], 'a binary must never reach the patch route');
});

// Whether the ticket removed a file is a question about the walk's status codes,
// not about its bytes (#85, #311). Without the flag, both of the cases below
// look identical to "the ticket edited a file trunk deleted" — and the first
// would refuse the whole carry over two sides that agree.
test('a file both sides deleted needs no carrying and blocks nothing (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.unlinkSync(path.join(d, 'doomed.php')));

	const out = await classifyCarry(dir, { files: [{ path: 'doomed.php', deleted: true }], baseOid, trunkOid });
	assert.deepEqual(out.settled, ['doomed.php']);
	assert.deepEqual(out.refused, [], 'two sides agreeing is not a conflict');
	assert.deepEqual(out.wholesale, []);
});

test('a file the ticket deleted that upstream never touched carries wholesale (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'doomed.php', deleted: true }], baseOid, trunkOid });
	assert.deepEqual(out.wholesale, ['doomed.php']);
	assert.deepEqual(out.refused, []);
});

test('a file the ticket deleted that upstream has since changed is refused (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'doomed.php'), '<?php // upstream still wants this\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'doomed.php', deleted: true }], baseOid, trunkOid });
	assert.deepEqual(out.refused, [{ path: 'doomed.php', reason: REFUSAL.DELETED_BUT_CHANGED }]);
});

// A read that failed is not absence. Folded together, a damaged object store
// reads as "neither side has this path" — which classifies wholesale and would
// write the ticket's version over whatever upstream really has there.
test('a base commit that will not read refuses rather than reading as absence (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'wp-login.php' }], baseOid: '0'.repeat(40), trunkOid });
	assert.deepEqual(out.refused, [{ path: 'wp-login.php', reason: REFUSAL.UNREADABLE }]);
	assert.deepEqual(out.wholesale, [], 'an unreadable side must never come out as "upstream never touched it"');
	assert.notEqual(baseOid, null);
});

test('a file the app could not read is refused before any comparison (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'settled.php'), '<?php // upstream\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'wp-login.php', unreadable: true }], baseOid, trunkOid });
	assert.deepEqual(out.refused, [{ path: 'wp-login.php', reason: REFUSAL.UNREADABLE }]);
	assert.deepEqual(out.wholesale, []);
});

test('a directory upstream put where the ticket has a file is not read as that file (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => {
		fs.mkdirSync(path.join(d, 'notes'), { recursive: true });
		fs.writeFileSync(path.join(d, 'notes', 'inner.php'), '<?php // upstream\n');
	});

	// `notes` is a tree upstream and a blob the ticket added: refused as an
	// addition on both sides, not silently treated as an untouched path.
	const out = await classifyCarry(dir, { files: [{ path: 'notes' }], baseOid, trunkOid });
	assert.deepEqual(out.refused, [{ path: 'notes', reason: REFUSAL.ADDED_BOTH }]);
});

// The mirror of the case above: upstream has a *file* where the ticket has a
// directory, so `notes/inner.php` genuinely does not exist upstream. It must
// come out as absence — descending into a blob throws, and a throw here means
// "unreadable", which would refuse a carry that has no problem.
test('a file under a path upstream turned into a file reads as absent, not unreadable (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => fs.writeFileSync(path.join(d, 'notes'), '<?php // upstream made this a file\n'));

	const out = await classifyCarry(dir, { files: [{ path: 'notes/inner.php' }], baseOid, trunkOid });
	assert.deepEqual(out.refused, []);
	assert.deepEqual(out.wholesale, ['notes/inner.php']);
});

// --- the whole answer ------------------------------------------------------

test('carryStatus never walks the worktree for a ticket that is not behind (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	let walked = 0;
	const status = await carryStatus(dir, {
		baseOid,
		trunkOid: baseOid,
		loadFiles: async () => { walked++; return [{ path: 'wp-login.php' }]; }
	});
	assert.equal(status.state, CARRY_STATE.CURRENT);
	assert.equal(walked, 0, 'the expensive scan must not be paid for the common answer');
	assert.deepEqual(status.wholesale, []);
});

test('carryStatus reports the gap and the per-file classification together (issue #305)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const trunkOid = await advanceTrunk(dir, (d) => {
		fs.writeFileSync(path.join(d, 'wp-login.php'), '<?php // upstream edit\n');
		fs.unlinkSync(path.join(d, 'doomed.php'));
	});

	const status = await carryStatus(dir, {
		baseOid,
		trunkOid,
		loadFiles: async () => [{ path: 'wp-login.php' }, { path: 'settled.php' }, { path: 'doomed.php' }]
	});
	assert.equal(status.state, CARRY_STATE.BEHIND);
	assert.deepEqual(status.merge, ['wp-login.php']);
	assert.deepEqual(status.wholesale, ['settled.php']);
	assert.deepEqual(status.refused, [{ path: 'doomed.php', reason: REFUSAL.UPSTREAM_DELETED }]);
});
