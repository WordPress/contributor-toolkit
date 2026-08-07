'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const git = require('isomorphic-git');
const { applyPatchToDir, resolveInside, dominantEol, rollback } = require('../src/patch-apply');

// A real on-disk repo, like trunk-update.integration.test.cjs: applyPatchToDir
// calls ensureAutocrlf, which reads and writes git config, so a bare temp
// directory would not exercise the same path.
async function makeRepo(t, files) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-test-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	await git.init({ fs, dir, defaultBranch: 'trunk' });
	for (const [relPath, content] of Object.entries(files)) {
		const abs = path.join(dir, relPath);
		fs.mkdirSync(path.dirname(abs), { recursive: true });
		fs.writeFileSync(abs, content);
		await git.add({ fs, dir, filepath: relPath });
	}
	await git.commit({
		fs, dir, message: 'base',
		author: { name: 'Test', email: 'test@example.com' }
	});
	return dir;
}

// Snapshot every file so "nothing was written" can be asserted byte for byte
// rather than just on the one file we happen to think about.
function snapshot(dir) {
	const out = {};
	const walk = (rel) => {
		for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
			if (entry.name === '.git') continue;
			const next = path.join(rel, entry.name);
			if (entry.isDirectory()) walk(next);
			else out[next] = fs.readFileSync(path.join(dir, next), 'utf8');
		}
	};
	walk('.');
	return out;
}

const FOO = 'src/wp-includes/foo.php';
const BAR = 'src/wp-includes/bar.php';
const FOO_BODY = 'one\ntwo\nthree\n';
const BAR_BODY = 'alpha\nbeta\ngamma\n';

const FOO_PATCH = `diff --git a/${FOO} b/${FOO}
--- a/${FOO}
+++ b/${FOO}
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
`;

// Second file's context does not match what is on disk, so this hunk fails.
const BAR_PATCH_THAT_FAILS = `diff --git a/${BAR} b/${BAR}
--- a/${BAR}
+++ b/${BAR}
@@ -1,3 +1,3 @@
 nothing
-like
+LIKE
 reality
`;

test('applyPatchToDir: a single-file patch applies (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const res = await applyPatchToDir({ dir, patchText: FOO_PATCH });
	assert.strictEqual(res.ok, true);
	assert.deepStrictEqual(res.applied, [FOO]);
	assert.strictEqual(fs.readFileSync(path.join(dir, FOO), 'utf8'), 'one\nTWO\nthree\n');
});

// The rule the whole module is built around. A patch where the second file
// fails must not leave the first one rewritten.
test('applyPatchToDir: one failing file leaves the whole tree untouched (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY, [BAR]: BAR_BODY });
	const before = snapshot(dir);

	const res = await applyPatchToDir({ dir, patchText: FOO_PATCH + BAR_PATCH_THAT_FAILS });

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /bar\.php/);
	assert.deepStrictEqual(res.applied, []);
	assert.deepStrictEqual(snapshot(dir), before, 'no file may change when any file fails');
});

test('applyPatchToDir: reverting restores the original content (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	await applyPatchToDir({ dir, patchText: FOO_PATCH });
	const res = await applyPatchToDir({ dir, patchText: FOO_PATCH, reverse: true });
	assert.strictEqual(res.ok, true);
	assert.strictEqual(fs.readFileSync(path.join(dir, FOO), 'utf8'), FOO_BODY);
});

// Reverting must undo the patch, not reset the checkout: work the contributor
// did on other files has to survive.
test('applyPatchToDir: reverting keeps unrelated local work (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY, [BAR]: BAR_BODY });
	await applyPatchToDir({ dir, patchText: FOO_PATCH });
	fs.writeFileSync(path.join(dir, BAR), 'my own work\n');

	await applyPatchToDir({ dir, patchText: FOO_PATCH, reverse: true });

	assert.strictEqual(fs.readFileSync(path.join(dir, FOO), 'utf8'), FOO_BODY);
	assert.strictEqual(fs.readFileSync(path.join(dir, BAR), 'utf8'), 'my own work\n');
});

test('applyPatchToDir: a patch creates and removes files (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const addPatch = `diff --git a/src/new.php b/src/new.php
new file mode 100644
--- /dev/null
+++ b/src/new.php
@@ -0,0 +1,2 @@
+hello
+world
`;
	const addRes = await applyPatchToDir({ dir, patchText: addPatch });
	assert.strictEqual(addRes.ok, true);
	assert.strictEqual(fs.readFileSync(path.join(dir, 'src/new.php'), 'utf8'), 'hello\nworld\n');

	// Reversing an addition is a deletion.
	await applyPatchToDir({ dir, patchText: addPatch, reverse: true });
	assert.strictEqual(fs.existsSync(path.join(dir, 'src/new.php')), false);
});

// A patch is untrusted input downloaded from a ticket.
test('applyPatchToDir: a path escaping the site folder is refused (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const outside = path.join(dir, '..', 'escaped.txt');
	const evil = `diff --git a/../escaped.txt b/../escaped.txt
new file mode 100644
--- /dev/null
+++ b/../escaped.txt
@@ -0,0 +1 @@
+pwned
`;
	const res = await applyPatchToDir({ dir, patchText: evil });
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /outside the site folder/);
	assert.strictEqual(fs.existsSync(outside), false);
});

test('applyPatchToDir: a missing target file fails without writing (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const before = snapshot(dir);
	const res = await applyPatchToDir({ dir, patchText: BAR_PATCH_THAT_FAILS });
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /not in this checkout/);
	assert.deepStrictEqual(snapshot(dir), before);
});

test('applyPatchToDir: binary files are skipped and named, not silently dropped (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const withBinary = FOO_PATCH + `diff --git a/src/x.png b/src/x.png
index 111..222 100644
Binary files a/src/x.png and b/src/x.png differ
`;
	const res = await applyPatchToDir({ dir, patchText: withBinary });
	assert.strictEqual(res.ok, true);
	assert.deepStrictEqual(res.applied, [FOO]);
	assert.deepStrictEqual(res.skipped, ['src/x.png']);
});

test('applyPatchToDir: an unreadable patch reports why and changes nothing (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const before = snapshot(dir);
	const res = await applyPatchToDir({ dir, patchText: 'this is not a patch\n' });
	assert.strictEqual(res.ok, false);
	assert.deepStrictEqual(snapshot(dir), before);
});

// Finding from self-review: the pre-validation rejection above is the path that
// cannot write by construction. This is the one that can — a write that throws
// partway through, after earlier files are already on disk.
test('applyPatchToDir: a write failing partway through is rolled back (issue #11)', async (t) => {
	// src/blocker is a regular file, so creating src/blocker/new.php fails with
	// ENOTDIR — deterministically, on every platform — after foo.php has
	// already been written.
	const dir = await makeRepo(t, { [FOO]: FOO_BODY, 'src/blocker': 'not a directory\n' });
	const before = snapshot(dir);

	const blockedAdd = `diff --git a/src/blocker/new.php b/src/blocker/new.php
new file mode 100644
--- /dev/null
+++ b/src/blocker/new.php
@@ -0,0 +1 @@
+hello
`;

	const res = await applyPatchToDir({ dir, patchText: FOO_PATCH + blockedAdd });

	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.rolledBack, true);
	assert.deepStrictEqual(snapshot(dir), before, 'a failed write must leave nothing behind');
});

test('applyPatchToDir: a rename moves the file and its content (issue #11)', async (t) => {
	const dir = await makeRepo(t, { 'src/old.php': 'one\ntwo\n' });
	const renamePatch = `diff --git a/src/old.php b/src/new.php
similarity index 90%
rename from src/old.php
rename to src/new.php
--- a/src/old.php
+++ b/src/new.php
@@ -1,2 +1,2 @@
 one
-two
+TWO
`;
	const res = await applyPatchToDir({ dir, patchText: renamePatch });
	assert.strictEqual(res.ok, true, res.error);
	assert.strictEqual(fs.existsSync(path.join(dir, 'src/old.php')), false);
	assert.strictEqual(fs.readFileSync(path.join(dir, 'src/new.php'), 'utf8'), 'one\nTWO\n');

	await applyPatchToDir({ dir, patchText: renamePatch, reverse: true });
	assert.strictEqual(fs.readFileSync(path.join(dir, 'src/old.php'), 'utf8'), 'one\ntwo\n');
	assert.strictEqual(fs.existsSync(path.join(dir, 'src/new.php')), false);
});

// A 100%-similarity rename has no hunks at all, which used to be rejected as
// "not a patch" — killing the whole apply for any PR that moved a file.
test('applyPatchToDir: a pure rename with no hunks applies (issue #11)', async (t) => {
	const dir = await makeRepo(t, { 'src/old.php': 'unchanged\n' });
	const purePatch = `diff --git a/src/old.php b/src/new.php
similarity index 100%
rename from src/old.php
rename to src/new.php
`;
	const res = await applyPatchToDir({ dir, patchText: purePatch });
	assert.strictEqual(res.ok, true, res.error);
	assert.strictEqual(fs.readFileSync(path.join(dir, 'src/new.php'), 'utf8'), 'unchanged\n');
	assert.strictEqual(fs.existsSync(path.join(dir, 'src/old.php')), false);
});

test('applyPatchToDir: reverting a deletion puts the file back (issue #11)', async (t) => {
	const dir = await makeRepo(t, { 'src/old.php': 'one\ntwo\n' });
	const deletePatch = `diff --git a/src/old.php b/src/old.php
deleted file mode 100644
--- a/src/old.php
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;
	assert.strictEqual((await applyPatchToDir({ dir, patchText: deletePatch })).ok, true);
	assert.strictEqual(fs.existsSync(path.join(dir, 'src/old.php')), false);

	const back = await applyPatchToDir({ dir, patchText: deletePatch, reverse: true });
	assert.strictEqual(back.ok, true, back.error);
	assert.strictEqual(fs.readFileSync(path.join(dir, 'src/old.php'), 'utf8'), 'one\ntwo\n');
});

// wordpress-develop carries fixtures whose line endings are the thing under
// test; rewriting them to LF because a patch touched the file would corrupt
// exactly those.
test('applyPatchToDir: a CRLF file keeps CRLF after patching (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY.replace(/\n/g, '\r\n') });
	const res = await applyPatchToDir({ dir, patchText: FOO_PATCH });
	assert.strictEqual(res.ok, true, res.error);
	assert.strictEqual(fs.readFileSync(path.join(dir, FOO), 'utf8'), 'one\r\nTWO\r\nthree\r\n');
});

test('dominantEol: reports the ending a file actually uses (issue #11)', () => {
	assert.strictEqual(dominantEol('a\nb\n'), '\n');
	assert.strictEqual(dominantEol('a\r\nb\r\n'), '\r\n');
	assert.strictEqual(dominantEol(''), '\n');
	// A mostly-LF file with one stray CRLF stays LF.
	assert.strictEqual(dominantEol('a\nb\nc\r\nd\ne\n'), '\n');
});

// resolveInside is exported so both the lexical and the symlink case can be
// exercised from one machine, the way win-spawn-patch.test.cjs does.
test('resolveInside: refuses paths that climb out, allows ones that stay in (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	assert.notStrictEqual(resolveInside(dir, 'src/wp-includes/foo.php'), null);
	assert.notStrictEqual(resolveInside(dir, 'src/does/not/exist/yet.php'), null);
	assert.strictEqual(resolveInside(dir, '../escaped.txt'), null);
	assert.strictEqual(resolveInside(dir, 'src/../../escaped.txt'), null);
	assert.strictEqual(resolveInside(dir, path.resolve(os.tmpdir(), 'absolute.txt')), null);
});

// path.resolve normalises ".." but not symlinks, so a lexical-only check lets a
// patch write through a symlinked directory to anywhere on disk.
test('resolveInside: refuses a path leading through a symlink out of the tree (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-outside-'));
	t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
	fs.symlinkSync(outside, path.join(dir, 'escape-hatch'), 'dir');

	assert.strictEqual(resolveInside(dir, 'escape-hatch/evil.txt'), null);
});

test('applyPatchToDir: a patch through a symlinked directory is refused (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-outside-'));
	t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
	fs.symlinkSync(outside, path.join(dir, 'escape-hatch'), 'dir');

	const evil = `diff --git a/escape-hatch/evil.txt b/escape-hatch/evil.txt
new file mode 100644
--- /dev/null
+++ b/escape-hatch/evil.txt
@@ -0,0 +1 @@
+pwned
`;
	const res = await applyPatchToDir({ dir, patchText: evil });
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /outside the site folder/);
	assert.strictEqual(fs.existsSync(path.join(outside, 'evil.txt')), false);
});

// existsSync follows a symlink and is false for a dangling one, so a naive
// walk-up steps past a link pointing outside the checkout and hands back its
// lexical path — which writeFileSync would then follow out of the tree. lstat
// closes that hole. (Copilot #1.)
test('applyPatchToDir: an add through a dangling symlink out of the tree is refused (issue #11)', async (t) => {
	const dir = await makeRepo(t, { [FOO]: FOO_BODY });
	const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-dangling-'));
	t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }));
	const outside = path.join(outsideDir, 'target.txt'); // never created → dangling
	fs.symlinkSync(outside, path.join(dir, 'sneaky.txt'));

	const evil = `diff --git a/sneaky.txt b/sneaky.txt
new file mode 100644
--- /dev/null
+++ b/sneaky.txt
@@ -0,0 +1 @@
+pwned
`;
	const res = await applyPatchToDir({ dir, patchText: evil });
	assert.strictEqual(res.ok, false);
	assert.match(res.error, /outside the site folder/);
	assert.strictEqual(fs.existsSync(outside), false, 'nothing may be written through the link');
});

// A pure (100%-similarity) rename carries the bytes unchanged. Git emits binary
// renames with no binary marker, so reading the source as utf8 and writing the
// string back would corrupt it — the bytes must survive intact. (Copilot #5.)
test('applyPatchToDir: a pure rename preserves non-utf8 (binary) bytes (issue #11)', async (t) => {
	const bytes = Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80, 0x0a]);
	const dir = await makeRepo(t, { 'src/logo.bin': bytes });
	const purePatch = `diff --git a/src/logo.bin b/src/moved.bin
similarity index 100%
rename from src/logo.bin
rename to src/moved.bin
`;
	const res = await applyPatchToDir({ dir, patchText: purePatch });
	assert.strictEqual(res.ok, true, res.error);
	assert.ok(fs.readFileSync(path.join(dir, 'src/moved.bin')).equals(bytes), 'bytes must survive the rename');
	assert.strictEqual(fs.existsSync(path.join(dir, 'src/logo.bin')), false);
});

// A deletion with a pre-image must match what is on disk. If the contributor
// edited the file after previewing, deleting it anyway silently discards their
// work; all-or-nothing means failing instead. (Copilot #2.)
test('applyPatchToDir: deleting a file edited since the patch fails all-or-nothing (issue #11)', async (t) => {
	const dir = await makeRepo(t, { 'src/old.php': 'one\ntwo\n' });
	const deletePatch = `diff --git a/src/old.php b/src/old.php
deleted file mode 100644
--- a/src/old.php
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;
	fs.writeFileSync(path.join(dir, 'src/old.php'), 'my own work\n');
	const before = snapshot(dir);

	const res = await applyPatchToDir({ dir, patchText: deletePatch });

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /moved on since the patch was written/);
	assert.deepStrictEqual(snapshot(dir), before, 'the edited file must not be deleted');
});

// A rename that completes and is then undone by a later failure must restore the
// source and remove the destination — registering each action before its
// mutations is what lets rollback see a half-done one. (Copilot #3.)
test('applyPatchToDir: a later failure rolls a completed rename fully back (issue #11)', async (t) => {
	const dir = await makeRepo(t, { 'src/old.php': 'one\ntwo\n', 'src/blocker': 'not a directory\n' });
	const before = snapshot(dir);
	const renameThenBlocked = `diff --git a/src/old.php b/src/new.php
similarity index 100%
rename from src/old.php
rename to src/new.php
diff --git a/src/blocker/child.php b/src/blocker/child.php
new file mode 100644
--- /dev/null
+++ b/src/blocker/child.php
@@ -0,0 +1 @@
+hello
`;
	const res = await applyPatchToDir({ dir, patchText: renameThenBlocked });

	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.rolledBack, true);
	assert.deepStrictEqual(snapshot(dir), before, 'the rename must be fully undone');
});

// A rollback can hit the same fault that broke the write. rollback must report
// what it could not restore so the caller stops claiming a clean tree. Driven
// directly with an un-restorable action (its parent is a file → ENOTDIR), which
// fails the same way whether or not the tests run as root. (Copilot #4.)
test('rollback: reports the paths it could not restore instead of swallowing them (issue #11)', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-rollback-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.writeFileSync(path.join(dir, 'afile'), 'i am a file\n');

	// Restoring this action means writing under `afile`, which is a file, not a
	// directory — mkdirSync/writeFileSync throw ENOTDIR.
	const recovery = rollback([
		{ op: 'write', abs: path.join(dir, 'afile', 'child'), path: 'afile/child', previous: Buffer.from('x') }
	]);

	assert.ok(Array.isArray(recovery) && recovery.length === 1);
	assert.match(recovery[0], /afile\/child/);
});

// The clean path still returns no recovery errors, so the caller reports a real
// rollback as one.
test('rollback: returns an empty list when it restores everything (issue #11)', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'patch-apply-rollback-ok-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.writeFileSync(path.join(dir, 'added'), 'new\n');

	const recovery = rollback([{ op: 'write', abs: path.join(dir, 'added'), path: 'added', previous: null }]);

	assert.deepStrictEqual(recovery, []);
	assert.strictEqual(fs.existsSync(path.join(dir, 'added')), false, 'an added file is removed on rollback');
});
