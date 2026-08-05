'use strict';

// Integration tests for src/trunk-update.js against real on-disk repositories
// (no network — updateToLatestTrunk's fetch path is covered by manual testing
// against GitHub; see PR #111). Windows line-ending scenarios are simulated
// by writing CRLF bytes directly, which is exactly what a native-git
// autocrlf checkout leaves on disk.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const git = require('isomorphic-git');
const { collectDirtyFiles, discardChanges, readTrunkInfo } = require('../src/trunk-update.js');

const AUTHOR = { name: 'test', email: 'test@example.com' };

async function makeRepo(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trunk-update-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\nline2\n');
	// Big5-style bytes: not valid UTF-8, the encoding-fixture case.
	fs.writeFileSync(path.join(dir, 'big5.txt'), Buffer.from([0xa4, 0xa4, 0x0a, 0xa4, 0xe5, 0x0a]));
	await git.add({ fs, dir, filepath: ['text.txt', 'big5.txt'] });
	await git.commit({ fs, dir, message: 'init', author: AUTHOR });
	return dir;
}

test('collectDirtyFiles: a pristine repo is clean (issue #94)', async (t) => {
	const dir = await makeRepo(t);
	assert.deepStrictEqual(await collectDirtyFiles(dir), []);
});

test('collectDirtyFiles: CRLF-smudged files, UTF-8 or not, are not dirty (issue #94)', async (t) => {
	const dir = await makeRepo(t);
	// What a native-git checkout with core.autocrlf=true leaves on disk.
	fs.writeFileSync(path.join(dir, 'text.txt'), 'line1\r\nline2\r\n');
	fs.writeFileSync(path.join(dir, 'big5.txt'), Buffer.from([0xa4, 0xa4, 0x0d, 0x0a, 0xa4, 0xe5, 0x0d, 0x0a]));
	assert.deepStrictEqual(await collectDirtyFiles(dir), []);
});

test('collectDirtyFiles: real edits and untracked files are detected (issue #94)', async (t) => {
	const dir = await makeRepo(t);
	fs.appendFileSync(path.join(dir, 'text.txt'), 'line3\n');
	fs.appendFileSync(path.join(dir, 'big5.txt'), Buffer.from([0xff, 0xfe]));
	fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new\n');
	assert.deepStrictEqual((await collectDirtyFiles(dir)).sort(), ['big5.txt', 'text.txt', 'untracked.txt']);
});

test('discardChanges: restores tracked files and deletes untracked ones, even staged (issue #94)', async (t) => {
	const dir = await makeRepo(t);
	fs.appendFileSync(path.join(dir, 'text.txt'), 'local edit\n');
	fs.writeFileSync(path.join(dir, 'untracked.txt'), 'new\n');
	fs.writeFileSync(path.join(dir, 'staged-untracked.txt'), 'staged by patch generation\n');
	await git.add({ fs, dir, filepath: 'staged-untracked.txt' });

	await discardChanges(dir);

	assert.strictEqual(fs.readFileSync(path.join(dir, 'text.txt'), 'utf8'), 'line1\nline2\n');
	assert.strictEqual(fs.existsSync(path.join(dir, 'untracked.txt')), false);
	assert.strictEqual(fs.existsSync(path.join(dir, 'staged-untracked.txt')), false);
	assert.deepStrictEqual(await collectDirtyFiles(dir), []);
});

test('readTrunkInfo: returns the HEAD oid and its committer date (issue #94)', async (t) => {
	const dir = await makeRepo(t);
	const { trunkOid, trunkDate } = await readTrunkInfo(dir);
	assert.strictEqual(trunkOid, await git.resolveRef({ fs, dir, ref: 'HEAD' }));
	const { commit } = await git.readCommit({ fs, dir, oid: trunkOid });
	assert.strictEqual(trunkDate, new Date(commit.committer.timestamp * 1000).toISOString());
});
