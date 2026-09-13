'use strict';

// Integration tests for src/pr-checkout.js (#458) against a real origin on
// disk, reached over `file://`, and a site cloned from it the way the app
// clones (partial, promisor config). The origin serves the pull request the
// way GitHub does: as `refs/pull/<number>/head`, which is not a branch.
// Nothing here touches the network.
//
// The assertions read the repository back with commands the module never
// runs (`rev-list`, `rev-parse`, `log --format`), as ticket-branches' suite
// does, so a bug in the module cannot hide behind the code proving it right.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const {
	fetchPullRequestHead,
	describePullRequestHead,
	pullRequestBranchState,
	checkoutPullRequest,
	leavePullRequest
} = require('../../src/pr-checkout.js');
const { TRUNK, WIP_MESSAGE, startTicketBranch, switchToBranch } = require('../../src/ticket-branches.js');
const { cloneSite } = require('../../src/git-clone.cjs');
const { git, gitOk, initRepo, commitFiles, resolveRef, currentBranch, listBranches, commitMeta, tempDir } = require('./helpers/git.cjs');

const LOGIN = path.join('src', 'wp-login.php');
const README = 'readme.txt';
const LOCKFILE = 'package-lock.json';

// --- fixtures --------------------------------------------------------------

function writeFiles(dir, files) {
	for (const [filepath, contents] of Object.entries(files)) {
		fs.mkdirSync(path.dirname(path.join(dir, filepath)), { recursive: true });
		fs.writeFileSync(path.join(dir, filepath), contents);
	}
	return Object.keys(files);
}

// A pull request on the origin: its commits on a branch of their own that is
// deleted once `refs/pull/<number>/head` points at the tip, which is the
// shape GitHub serves. `from` is the commit it branches from, trunk's tip
// by default, so a "written against an older trunk" pull request is one
// made before trunk moved.
function addPullRequest(origin, number, files, { from = TRUNK, message = `PR #${number}`, remove = [] } = {}) {
	const before = currentBranch(origin);
	gitOk(['checkout', '-q', '-b', `scratch-${number}`, from], origin);
	if (remove.length) gitOk(['rm', '-q', '--', ...remove], origin);
	// `rm` has staged the removals; `commitFiles` adds only what was written.
	const oid = commitFiles(origin, writeFiles(origin, files), message);
	gitOk(['update-ref', `refs/pull/${number}/head`, oid], origin);
	gitOk(['checkout', '-q', before], origin);
	gitOk(['branch', '-D', `scratch-${number}`], origin);
	return oid;
}

async function makeSiteAndOrigin(t) {
	const origin = initRepo(tempDir(t, 'pr-checkout-origin-'));
	gitOk(['config', 'uploadpack.allowFilter', 'true'], origin);
	const baseOid = commitFiles(origin, writeFiles(origin, {
		'.gitignore': 'node_modules/\n',
		[LOGIN]: '<?php // trunk\n',
		[README]: 'trunk\n',
		[LOCKFILE]: '{"lockfileVersion":1}\n'
	}), 'base');

	const parent = tempDir(t, 'pr-checkout-site-');
	const dir = path.join(parent, 'site');
	await cloneSite({ url: pathToFileURL(origin).href, dir });
	// The substrate a checkout must never touch.
	fs.mkdirSync(path.join(dir, 'node_modules'));
	fs.writeFileSync(path.join(dir, 'node_modules', 'marker'), 'installed\n');

	return { origin, dir, baseOid };
}

const read = (dir, filepath) => fs.readFileSync(path.join(dir, filepath), 'utf8');
const exists = (dir, filepath) => fs.existsSync(path.join(dir, filepath));
const countCommits = (dir, ref) => Number(gitOk(['rev-list', '--count', ref, '--'], dir));
// Objects reachable from `ref` that the site does not have; `--missing=print`
// lists them instead of fetching them.
const missingObjects = (dir, ref) => gitOk(['rev-list', '--objects', '--missing=print', ref, '--'], dir).split('\n').filter((line) => line.startsWith('?'));

// --- fetch and describe ----------------------------------------------------

test('fetchPullRequestHead: resolves refs/pull/<n>/head on the origin by its short name, and the clone stays partial (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	const prOid = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });

	const { oid } = await fetchPullRequestHead(dir, 7);

	assert.equal(oid, prOid);
	assert.equal(currentBranch(dir), TRUNK, 'a fetch moves no branch');
	assert.deepEqual(listBranches(dir), [TRUNK]);
	assert.ok(missingObjects(dir, oid).length > 0, 'the promisor filter applied to the fetch: the blobs are still on the origin');
	assert.ok(!fs.existsSync(path.join(dir, '.git', 'shallow')), 'and nothing made the clone shallow');
});

test('fetchPullRequestHead: a number that is not one is refused before Git runs, and a pull request the origin does not have is Git\'s own error (#458)', async (t) => {
	const { dir } = await makeSiteAndOrigin(t);

	for (const bad of ['7; rm -rf', '-1', 0, 'seven', undefined, 1.5]) {
		await assert.rejects(fetchPullRequestHead(dir, bad), (error) => error.code === 'bad-pr-number', String(bad));
	}
	await assert.rejects(fetchPullRequestHead(dir, 404), (error) => error.name === 'GitError' && /couldn't find remote ref/i.test(error.stderr));
});

test('describePullRequestHead: the files are the pull request\'s own diff from where it left trunk, and needsInstall compares lockfiles with the current checkout (#458)', async (t) => {
	const { origin, dir, baseOid } = await makeSiteAndOrigin(t);
	// The pull request predates a trunk commit that changes the lockfile.
	const prOid = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n', 'src/new.php': '<?php // new\n' });
	gitOk(['rm', '-q', README], origin);
	commitFiles(origin, writeFiles(origin, { [LOCKFILE]: '{"lockfileVersion":2}\n' }), 'trunk moves');
	await fetchPullRequestHead(dir, 7);

	const before = await describePullRequestHead(dir, prOid);
	assert.equal(before.base, baseOid);
	assert.deepEqual(before.files, [
		{ path: 'src/new.php', kind: 'added' },
		{ path: LOGIN, kind: 'modified' }
	], 'trunk\'s later lockfile change and deletion are not blamed on the pull request');
	assert.equal(before.needsInstall, false, 'the site is on the same lockfile the pull request has');

	// Once the site has updated to the new trunk, going to the pull request
	// means going back to the older lockfile.
	gitOk(['fetch', '-q', 'origin', TRUNK], dir);
	gitOk(['reset', '-q', '--hard', 'FETCH_HEAD'], dir);
	const after = await describePullRequestHead(dir, prOid);
	assert.deepEqual(after.files, before.files);
	assert.equal(after.needsInstall, true);
	assert.equal((await describePullRequestHead(dir, prOid, { currentHead: baseOid })).needsInstall, false, 'currentHead is honoured over HEAD');
});

test('describePullRequestHead: a pull request that moves the lockfile needs an install, decided from the tree without fetching the blob (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	const prOid = addPullRequest(origin, 8, { [LOCKFILE]: '{"lockfileVersion":3}\n' });
	const deleting = addPullRequest(origin, 11, {}, { remove: [README] });
	await fetchPullRequestHead(dir, 8);
	await fetchPullRequestHead(dir, 11);
	const lockfileBlob = gitOk(['rev-parse', `${prOid}:${LOCKFILE}`], origin);
	assert.ok(missingObjects(dir, prOid).some((line) => line === `?${lockfileBlob}`), 'the new lockfile blob is on the origin only');

	const described = await describePullRequestHead(dir, prOid);
	assert.equal(described.needsInstall, true);
	assert.deepEqual(described.files, [{ path: LOCKFILE, kind: 'modified' }]);
	assert.ok(missingObjects(dir, prOid).some((line) => line === `?${lockfileBlob}`), 'and still is: a read decided it, not a download');

	assert.deepEqual((await describePullRequestHead(dir, deleting)).files, [{ path: README, kind: 'deleted' }]);
});

test('describePullRequestHead: a head with no history in common with trunk lists nothing and says so (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	gitOk(['checkout', '-q', '--orphan', 'elsewhere'], origin);
	gitOk(['rm', '-rfq', '.'], origin);
	const alone = commitFiles(origin, writeFiles(origin, { 'alone.txt': 'alone\n' }), 'alone');
	gitOk(['update-ref', 'refs/pull/9/head', alone], origin);
	gitOk(['checkout', '-q', TRUNK], origin);
	await fetchPullRequestHead(dir, 9);

	const described = await describePullRequestHead(dir, alone);
	assert.equal(described.base, null);
	assert.deepEqual(described.files, []);
});

// --- checkout --------------------------------------------------------------

test('checkoutPullRequest from a ticket: the ticket\'s work is parked on its own branch, the worktree is the pull request\'s, the substrate is untouched (#458)', async (t) => {
	const { origin, dir, baseOid } = await makeSiteAndOrigin(t);
	const prOid = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	await startTicketBranch(dir, 60001);
	writeFiles(dir, { [README]: 'my ticket\n', 'src/doomed.php': '<?php // mine\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);
	const progress = [];

	const result = await checkoutPullRequest(dir, 7, { headOid, fromBaseOid: baseOid, onProgress: (p) => progress.push(p) });

	assert.deepEqual(result, { ref: 'pr/7', from: 'ticket/60001', to: 'pr/7', parked: true, created: true, moved: false });
	assert.equal(currentBranch(dir), 'pr/7');
	assert.equal(resolveRef(dir, 'HEAD'), prOid, 'the branch is at the pull request\'s head, its author\'s commit');
	assert.equal(read(dir, LOGIN), '<?php // pr 7\n');
	assert.equal(read(dir, README), 'trunk\n');
	assert.ok(!exists(dir, 'src/doomed.php'), 'the ticket\'s new file is not in the pull request\'s tree');
	assert.equal(read(dir, path.join('node_modules', 'marker')), 'installed\n');
	assert.equal(git(['status', '--porcelain'], dir).stdout, '', 'nothing loose: HEAD, index and worktree agree');

	// The ticket branch holds exactly one WIP commit on its own base.
	const wip = commitMeta(dir, 'ticket/60001');
	assert.equal(wip.message, WIP_MESSAGE);
	assert.deepEqual(wip.parents, [baseOid]);
	assert.equal(gitOk(['show', 'ticket/60001:src/doomed.php'], dir), '<?php // mine');
	assert.equal(countCommits(dir, `${baseOid}..ticket/60001`), 1);
	// And trunk was not committed to.
	assert.equal(resolveRef(dir, TRUNK), baseOid);

	// The progress named both sides the way the panel will say them.
	assert.ok(progress.some((p) => p.stage === 'scan' && p.from === 'ticket/60001' && p.to === 'pr/7'));
	assert.ok(progress.some((p) => p.stage === 'done' && p.to === 'pr/7'));
});

test('checkoutPullRequest from trunk: nothing to park when trunk is clean, and a dirty trunk is refused with nothing written, the new branch included (#458)', async (t) => {
	const { origin, dir, baseOid } = await makeSiteAndOrigin(t);
	const prOid = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);

	writeFiles(dir, { [README]: 'loose edit on trunk\n' });
	await assert.rejects(checkoutPullRequest(dir, 7, { headOid }), (error) => error.code === 'dirty-trunk');
	assert.equal(currentBranch(dir), TRUNK);
	assert.equal(read(dir, README), 'loose edit on trunk\n', 'the edit that would have been lost is still there');
	assert.deepEqual(listBranches(dir), [TRUNK], 'the refusal left no pr/ branch behind');

	writeFiles(dir, { [README]: 'trunk\n' });
	const result = await checkoutPullRequest(dir, 7, { headOid });
	assert.deepEqual(result, { ref: 'pr/7', from: TRUNK, to: 'pr/7', parked: false, created: true, moved: false });
	assert.equal(resolveRef(dir, 'HEAD'), prOid);
	assert.equal(resolveRef(dir, TRUNK), baseOid);
});

test('checkoutPullRequest: the branch that is already checked out is refused, not rewritten under the worktree (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);
	await checkoutPullRequest(dir, 7, { headOid });
	writeFiles(dir, { [README]: 'a tweak on the pull request\n' });

	await assert.rejects(checkoutPullRequest(dir, 7, { headOid, recordedHeadOid: headOid }), (error) => error.code === 'already-checked-out');
	assert.equal(read(dir, README), 'a tweak on the pull request\n');
});

test('checkoutPullRequest: a checkout that dies part-way keeps the branch and says where it put it, so the caller can record the head (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);
	fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '');

	await assert.rejects(checkoutPullRequest(dir, 7, { headOid }), (e) => {
		assert.equal(e.name, 'GitError');
		assert.equal(e.stage, 'checkout');
		assert.equal(e.from, TRUNK);
		assert.equal(e.to, 'pr/7');
		assert.equal(e.ref, 'pr/7');
		assert.equal(e.headOid, headOid);
		assert.equal(e.created, true);
		assert.equal(e.moved, false);
		return true;
	});
	assert.equal(resolveRef(dir, 'pr/7'), headOid, 'the branch stays for the marker\'s retry');
	assert.equal(currentBranch(dir), TRUNK);

	// With the head recorded from the error, the retry is an ordinary checkout.
	fs.rmSync(path.join(dir, '.git', 'index.lock'));
	const result = await checkoutPullRequest(dir, 7, { headOid, recordedHeadOid: headOid });
	assert.equal(result.created, false);
	assert.equal(currentBranch(dir), 'pr/7');
});

test('checkoutPullRequest and leavePullRequest: a commit id that is not one never reaches Git (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);

	for (const bad of ['HEAD@{1}', TRUNK, headOid.slice(0, 39), '', headOid.toUpperCase()]) {
		await assert.rejects(checkoutPullRequest(dir, 7, { headOid: bad }), (e) => e.code === 'bad-oid', bad);
		await assert.rejects(checkoutPullRequest(dir, 7, { headOid, recordedHeadOid: bad }), (e) => e.code === 'bad-oid', bad);
	}
	await assert.rejects(checkoutPullRequest(dir, 7, { headOid: undefined }), (e) => e.code === 'bad-oid');
	assert.deepEqual(listBranches(dir), [TRUNK]);

	await checkoutPullRequest(dir, 7, { headOid });
	await assert.rejects(leavePullRequest(dir, { returnTo: TRUNK, headOid: TRUNK }), (e) => e.code === 'bad-oid');
	assert.equal(currentBranch(dir), 'pr/7');
});

test('checkoutPullRequest: a pr/ branch the app did not make is refused rather than adopted (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);
	// A mentor's own branch, with a commit of their own on it.
	gitOk(['branch', 'pr/7', headOid], dir);
	const theirs = resolveRef(dir, 'pr/7');

	await assert.rejects(checkoutPullRequest(dir, 7, { headOid }), (error) => error.code === 'pr-branch-exists' && error.ref === 'pr/7');
	assert.equal(currentBranch(dir), TRUNK);
	assert.equal(resolveRef(dir, 'pr/7'), theirs, 'and it was not moved');
	assert.deepEqual(await pullRequestBranchState(dir, 7, { headOid }), { ref: 'pr/7', exists: true, tip: theirs, hasEdits: false, moved: false });
});

// --- leave and return ------------------------------------------------------

test('leavePullRequest: edits made on the pull request are parked as one commit on its head, and the ticket comes back byte for byte (#458)', async (t) => {
	const { origin, dir, baseOid } = await makeSiteAndOrigin(t);
	const prOid = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	await startTicketBranch(dir, 60001);
	writeFiles(dir, { [README]: 'my ticket\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);
	await checkoutPullRequest(dir, 7, { headOid, fromBaseOid: baseOid });
	writeFiles(dir, { [LOGIN]: '<?php // pr 7, tweaked\n' });
	const progress = [];

	const result = await leavePullRequest(dir, { returnTo: 'ticket/60001', headOid, onProgress: (p) => progress.push(p) });

	assert.deepEqual(result, { from: 'pr/7', to: 'ticket/60001', parked: true, fellBack: false });
	assert.equal(currentBranch(dir), 'ticket/60001');
	assert.equal(read(dir, README), 'my ticket\n');
	assert.equal(read(dir, LOGIN), '<?php // trunk\n', 'the pull request is gone from the worktree with the branch');
	assert.equal(git(['status', '--porcelain'], dir).stdout, '');

	// pr/7: the author's commit, then exactly one WIP commit on top of it.
	const wip = commitMeta(dir, 'pr/7');
	assert.equal(wip.message, WIP_MESSAGE);
	assert.deepEqual(wip.parents, [prOid], 'parented on the pull request\'s head, not on trunk');
	assert.equal(countCommits(dir, `${prOid}..pr/7`), 1);
	assert.equal(gitOk(['show', 'pr/7:src/wp-login.php'], dir), '<?php // pr 7, tweaked');
	assert.equal(gitOk(['diff', '--name-only', prOid, 'pr/7'], dir), 'src/wp-login.php', 'a diff from the head is only the contributor\'s edit');
	const state = await pullRequestBranchState(dir, 7, { headOid, recordedHeadOid: headOid });
	assert.equal(state.hasEdits, true);

	// Leaving again with nothing changed does not rewrite the WIP commit.
	assert.ok(progress.some((p) => p.stage === 'scan' && p.from === 'pr/7'));
	const wipOid = wip.oid;
	await switchToBranch(dir, 'pr/7', { baseOid });
	assert.equal(read(dir, LOGIN), '<?php // pr 7, tweaked\n', 'the edits come back with the branch');
	await leavePullRequest(dir, { returnTo: 'ticket/60001', headOid });
	assert.equal(resolveRef(dir, 'pr/7'), wipOid);
});

test('leavePullRequest: a return branch that is gone falls back to trunk, and a checkout that is not on a pull request is refused (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);

	await assert.rejects(leavePullRequest(dir, { returnTo: TRUNK, headOid }), (error) => error.code === 'not-on-pr');

	await checkoutPullRequest(dir, 7, { headOid });
	// Without the head there is no right parent for the park, and trunk is
	// the wrong one: refused, with the edit still on disk.
	writeFiles(dir, { [README]: 'tweak\n' });
	for (const missing of [undefined, null]) {
		await assert.rejects(leavePullRequest(dir, { returnTo: TRUNK, headOid: missing }), (error) => error.code === 'no-pr-head');
	}
	assert.equal(currentBranch(dir), 'pr/7');
	assert.equal(read(dir, README), 'tweak\n');
	writeFiles(dir, { [README]: 'trunk\n' });
	const result = await leavePullRequest(dir, { returnTo: 'ticket/60001', headOid });
	assert.deepEqual(result, { from: 'pr/7', to: TRUNK, parked: false, fellBack: true });
	assert.equal(currentBranch(dir), TRUNK);
});

// --- a pull request that moved on GitHub -----------------------------------

test('checkoutPullRequest again after the pull request moved: the branch follows the new head, unless edits sit on it (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: first } = await fetchPullRequestHead(dir, 7);
	await checkoutPullRequest(dir, 7, { headOid: first });
	await leavePullRequest(dir, { returnTo: TRUNK, headOid: first });

	// The author pushes again.
	const second = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7, v2\n' }, { message: 'PR #7 v2' });
	const { oid: headOid } = await fetchPullRequestHead(dir, 7);
	assert.equal(headOid, second);
	assert.deepEqual(await pullRequestBranchState(dir, 7, { headOid, recordedHeadOid: first }), { ref: 'pr/7', exists: true, tip: first, hasEdits: false, moved: true });

	const result = await checkoutPullRequest(dir, 7, { headOid, recordedHeadOid: first });
	assert.deepEqual(result, { ref: 'pr/7', from: TRUNK, to: 'pr/7', parked: false, created: false, moved: true });
	assert.equal(resolveRef(dir, 'HEAD'), second);
	assert.equal(read(dir, LOGIN), '<?php // pr 7, v2\n');

	// Now with edits on the branch: the author pushes a third time.
	writeFiles(dir, { [README]: 'tweak\n' });
	await leavePullRequest(dir, { returnTo: TRUNK, headOid: second });
	const wipOid = resolveRef(dir, 'pr/7');
	const third = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7, v3\n' }, { message: 'PR #7 v3' });
	await fetchPullRequestHead(dir, 7);
	await assert.rejects(checkoutPullRequest(dir, 7, { headOid: third, recordedHeadOid: second }), (error) => error.code === 'pr-has-edits' && error.ref === 'pr/7');
	assert.equal(resolveRef(dir, 'pr/7'), wipOid, 'the edits are still there');
	assert.equal(currentBranch(dir), TRUNK);

	// The same head as recorded, edits or not, is simply checked out again.
	const back = await checkoutPullRequest(dir, 7, { headOid: second, recordedHeadOid: second });
	assert.equal(back.moved, false);
	assert.equal(read(dir, README), 'tweak\n');
});

test('checkoutPullRequest: a branch moved by a second writer since the record was made is not overwritten (#458)', async (t) => {
	const { origin, dir } = await makeSiteAndOrigin(t);
	addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7\n' });
	const { oid: first } = await fetchPullRequestHead(dir, 7);
	await checkoutPullRequest(dir, 7, { headOid: first });
	await leavePullRequest(dir, { returnTo: TRUNK, headOid: first });
	const second = addPullRequest(origin, 7, { [LOGIN]: '<?php // pr 7, v2\n' }, { message: 'v2' });
	await fetchPullRequestHead(dir, 7);
	// A terminal moved pr/7 meanwhile; the app's record still says `first`.
	const theirs = gitOk(['-c', 'user.name=M', '-c', 'user.email=m@example.com', 'commit-tree', `${first}^{tree}`, '-p', first, '-m', 'their own'], dir);
	gitOk(['update-ref', 'refs/heads/pr/7', theirs], dir);

	await assert.rejects(checkoutPullRequest(dir, 7, { headOid: second, recordedHeadOid: first }), (error) => error.code === 'pr-has-edits');
	assert.equal(resolveRef(dir, 'pr/7'), theirs);
});
