'use strict';

// Integration tests for src/ticket-branches.js (#108) against real on-disk
// repositories — no mocking of isomorphic-git, same as the trunk-update suite.
//
// The fixture mirrors what a site actually looks like: a `trunk` branch holding
// a wordpress-develop-shaped tree, plus a gitignored `node_modules` standing in
// for the expensive substrate a ticket switch must never touch.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('isomorphic-git');
const {
	TRUNK,
	ticketBranchRef,
	ticketIdFromRef,
	currentBranchName,
	listTicketBranches,
	hasChangesAgainst,
	parkCurrentWork,
	startTicketBranch,
	switchToBranch,
	deleteTicketBranch
} = require('../src/ticket-branches.js');

const AUTHOR = { name: 'test', email: 'test@example.com' };

async function makeSite(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-branches-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: TRUNK });
	fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules/\nbuild/\n');
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // trunk\n');
	fs.writeFileSync(path.join(dir, 'doomed.php'), '<?php // to be deleted\n');
	await git.add({ fs, dir, filepath: ['.gitignore', 'wp-login.php', 'doomed.php'] });
	const baseOid = await git.commit({ fs, dir, message: 'trunk', author: AUTHOR });

	// The substrate: gitignored, expensive, and must survive every switch.
	fs.mkdirSync(path.join(dir, 'node_modules', 'react'), { recursive: true });
	fs.writeFileSync(path.join(dir, 'node_modules', 'react', 'index.js'), 'expensive\n');
	return { dir, baseOid };
}

const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');
const exists = (dir, file) => fs.existsSync(path.join(dir, file));

test('ticketBranchRef/ticketIdFromRef round-trip, and trunk is not a ticket (issue #108)', () => {
	assert.equal(ticketBranchRef(59234), 'ticket/59234');
	assert.equal(ticketIdFromRef('ticket/59234'), 59234);
	assert.equal(ticketIdFromRef(TRUNK), null);
	assert.equal(ticketIdFromRef('ticket/not-a-number'), null);
	assert.equal(ticketIdFromRef(undefined), null);
});

test('starting a ticket carries uncommitted work onto the new branch (issue #108)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	// "I started editing, then realised which ticket this is."
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // my fix\n');

	const started = await startTicketBranch(dir, 59234);
	assert.equal(started.ref, 'ticket/59234');
	assert.equal(started.baseOid, baseOid);
	assert.equal(await currentBranchName(dir), 'ticket/59234');
	assert.equal(read(dir, 'wp-login.php'), '<?php // my fix\n');
});

test('a second ticket on the same site refuses rather than clobbering the first (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	await startTicketBranch(dir, 59234);
	await assert.rejects(() => startTicketBranch(dir, 59234), (e) => e.code === 'branch-exists');
});

test('switching tickets and back restores files, including a deletion (issue #108)', async (t) => {
	const { dir, baseOid } = await makeSite(t);

	// Ticket one: edit a file, add a new one, delete a third.
	const first = await startTicketBranch(dir, 59234);
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // ticket 59234\n');
	fs.writeFileSync(path.join(dir, 'new-file.php'), '<?php // brand new\n');
	fs.unlinkSync(path.join(dir, 'doomed.php'));

	// Ticket two: start from trunk, so it must see none of the above.
	await switchToBranch(dir, TRUNK, { baseOid: first.baseOid });
	const second = await startTicketBranch(dir, 61002);
	assert.equal(read(dir, 'wp-login.php'), '<?php // trunk\n');
	assert.equal(exists(dir, 'new-file.php'), false, 'ticket one\'s new file must not leak');
	assert.equal(exists(dir, 'doomed.php'), true, 'ticket one\'s deletion must not leak');
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // ticket 61002\n');

	// Back to ticket one: every one of the three edits returns.
	await switchToBranch(dir, first.ref, { baseOid: second.baseOid });
	assert.equal(read(dir, 'wp-login.php'), '<?php // ticket 59234\n');
	assert.equal(read(dir, 'new-file.php'), '<?php // brand new\n');
	assert.equal(exists(dir, 'doomed.php'), false, 'the deletion must survive the round trip');

	// And ticket two is still intact.
	await switchToBranch(dir, second.ref, { baseOid: first.baseOid });
	assert.equal(read(dir, 'wp-login.php'), '<?php // ticket 61002\n');
	assert.equal(baseOid, first.baseOid, 'both tickets branch from the same trunk snapshot');
});

test('the gitignored substrate survives every switch (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	const dep = path.join('node_modules', 'react', 'index.js');

	const first = await startTicketBranch(dir, 59234);
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // work\n');
	await switchToBranch(dir, TRUNK, { baseOid: first.baseOid });
	const second = await startTicketBranch(dir, 61002);
	await switchToBranch(dir, first.ref, { baseOid: second.baseOid });

	assert.equal(read(dir, dep), 'expensive\n', 'node_modules must never be rewritten by a switch');
	// It must also stay out of the branch itself, or every switch would carry it.
	const tracked = await git.listFiles({ fs, dir, ref: first.ref });
	assert.equal(tracked.some((f) => f.startsWith('node_modules/')), false);
});

test('parking is idempotent: re-parking rewrites one WIP commit, never stacks (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	const { ref, baseOid } = await startTicketBranch(dir, 59234);

	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // first pass\n');
	const one = await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	assert.equal(one.parked, true);

	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // second pass\n');
	const two = await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	assert.equal(two.parked, true);
	assert.notEqual(one.oid, two.oid, 'the WIP commit is rewritten, not reused');

	const log = await git.log({ fs, dir, ref });
	assert.equal(log.length, 2, 'exactly one WIP commit on top of the branch point');
	assert.equal(log[0].commit.parent[0], baseOid, 'always reparented onto the branch point');
});

test('parking a tree with no changes does nothing (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	const { ref, baseOid } = await startTicketBranch(dir, 59234);
	const result = await parkCurrentWork(dir, { baseOid, author: AUTHOR });
	assert.equal(result.parked, false);
	assert.equal(result.oid, null);
	assert.equal((await git.log({ fs, dir, ref })).length, 1, 'no empty WIP commit was created');
});

test('trunk is never committed to — it is every branch\'s diff base (issue #108)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // loose work on trunk\n');
	await assert.rejects(
		() => parkCurrentWork(dir, { baseOid, author: AUTHOR }),
		(e) => e.code === 'trunk-is-read-only'
	);
	assert.equal((await git.log({ fs, dir, ref: TRUNK })).length, 1);
});

test('switching away from a dirty trunk refuses instead of destroying the work (issue #108)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	const { ref } = await startTicketBranch(dir, 59234);
	await switchToBranch(dir, TRUNK, { baseOid });

	// Work made on trunk cannot be parked, and checkout({force}) would eat it.
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // unsaved\n');
	await assert.rejects(() => switchToBranch(dir, ref, { baseOid }), (e) => e.code === 'dirty-trunk');
	assert.equal(read(dir, 'wp-login.php'), '<?php // unsaved\n', 'the refused switch left the work alone');
});

test('a patch diffed against baseOid contains the ticket\'s work, WIP commit and all (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	const { baseOid } = await startTicketBranch(dir, 59234);
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // committed work\n');
	await parkCurrentWork(dir, { baseOid, author: AUTHOR });

	// The whole point of recording baseOid: against HEAD the parked work has
	// vanished into the commit and the patch would come out empty.
	assert.equal(await hasChangesAgainst(dir, 'HEAD'), false);
	assert.equal(await hasChangesAgainst(dir, baseOid), true);

	// Uncommitted edits on top must show up in the same diff as the parked ones.
	fs.writeFileSync(path.join(dir, 'later.php'), '<?php // not parked yet\n');
	const changed = (await git.statusMatrix({ fs, dir, ref: baseOid }))
		.filter(([, head, workdir]) => head !== workdir)
		.map(([filepath]) => filepath);
	assert.deepEqual(changed.sort(), ['later.php', 'wp-login.php']);
});

test('deleting a ticket branch drops its work and leaves the site on trunk (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	const { ref, baseOid } = await startTicketBranch(dir, 59234);
	fs.writeFileSync(path.join(dir, 'wp-login.php'), '<?php // abandoned\n');
	await parkCurrentWork(dir, { baseOid, author: AUTHOR });

	await deleteTicketBranch(dir, ref);
	assert.equal(await currentBranchName(dir), TRUNK);
	assert.equal(read(dir, 'wp-login.php'), '<?php // trunk\n', 'trunk\'s content is restored');
	assert.deepEqual(await listTicketBranches(dir), []);
});

test('deleting refuses trunk and anything the app did not create (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	await git.branch({ fs, dir, ref: 'my-own-branch', object: TRUNK });

	await assert.rejects(() => deleteTicketBranch(dir, TRUNK), (e) => e.code === 'not-a-ticket-branch');
	await assert.rejects(() => deleteTicketBranch(dir, 'my-own-branch'), (e) => e.code === 'not-a-ticket-branch');
	await assert.rejects(() => deleteTicketBranch(dir, 'ticket/99999'), (e) => e.code === 'no-such-branch');

	const branches = await git.listBranches({ fs, dir });
	assert.equal(branches.includes(TRUNK), true);
	assert.equal(branches.includes('my-own-branch'), true);
});

test('listTicketBranches reports the tickets in the site, never trunk (issue #108)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	assert.deepEqual(await listTicketBranches(dir), []);
	await startTicketBranch(dir, 59234);
	await switchToBranch(dir, TRUNK, { baseOid });
	await startTicketBranch(dir, 61002);
	assert.deepEqual((await listTicketBranches(dir)).sort(), ['ticket/59234', 'ticket/61002']);
});

test('switching to the branch already checked out is a no-op (issue #108)', async (t) => {
	const { dir } = await makeSite(t);
	const { ref, baseOid } = await startTicketBranch(dir, 59234);
	const result = await switchToBranch(dir, ref, { baseOid });
	assert.equal(result.switched, false);
	assert.equal(result.parked, false);
});

test('switching to a branch that does not exist refuses (issue #108)', async (t) => {
	const { dir, baseOid } = await makeSite(t);
	await assert.rejects(
		() => switchToBranch(dir, 'ticket/12345', { baseOid }),
		(e) => e.code === 'no-such-branch'
	);
});
