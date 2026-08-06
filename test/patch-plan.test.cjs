'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
	stripPathPrefix,
	mapToSrcLayout,
	parsePatchFiles,
	planApply
} = require('../src/patch-plan.cjs');
const { updateStepStatuses, SKIP_INSTALL_MESSAGE, planApplySteps, APPLY_STATE_TO_STEP } = require('../src/renderer/update-plan.cjs');

// The four header shapes that actually reach the app. Kept verbatim rather than
// generated: the whole point of these tests is that real-world formatting —
// tabs before "(revision N)", missing a/ b/ prefixes, /dev/null sides — is
// handled, and a generator would only produce the shape we already expect.
const GITHUB_DIFF = `diff --git a/src/wp-includes/foo.php b/src/wp-includes/foo.php
index 384bf9e..dbfa038 100644
--- a/src/wp-includes/foo.php
+++ b/src/wp-includes/foo.php
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`;

const TRAC_SVN_DIFF = `Index: src/wp-includes/foo.php
===================================================================
--- src/wp-includes/foo.php\t(revision 59234)
+++ src/wp-includes/foo.php\t(working copy)
@@ -1,3 +1,3 @@
 a
-b
+B
 c
`;

const OLD_LAYOUT_DIFF = `Index: wp-admin/admin.php
===================================================================
--- wp-admin/admin.php\t(revision 1)
+++ wp-admin/admin.php\t(working copy)
@@ -1,2 +1,2 @@
 x
-y
+Y
`;

const ADD_DIFF = `diff --git a/src/new.php b/src/new.php
new file mode 100644
index 0000000..e69de29
--- /dev/null
+++ b/src/new.php
@@ -0,0 +1,2 @@
+one
+two
`;

const DELETE_DIFF = `diff --git a/src/old.php b/src/old.php
deleted file mode 100644
--- a/src/old.php
+++ /dev/null
@@ -1,2 +0,0 @@
-one
-two
`;

const BINARY_DIFF = `diff --git a/src/x.png b/src/x.png
index 111..222 100644
Binary files a/src/x.png and b/src/x.png differ
`;

test('parsePatchFiles: a GitHub pull request diff resolves to a repo-relative path (issue #11)', () => {
	const res = parsePatchFiles(GITHUB_DIFF);
	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.files.length, 1);
	assert.strictEqual(res.files[0].path, 'src/wp-includes/foo.php');
	assert.strictEqual(res.files[0].kind, 'modify');
});

// The bug this guards: Subversion patches carry no a/ b/ prefix, so stripping
// two characters unconditionally would write to "c/wp-includes/foo.php".
test('parsePatchFiles: a Subversion-style Trac attachment keeps its full path (issue #11)', () => {
	const res = parsePatchFiles(TRAC_SVN_DIFF);
	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.files[0].path, 'src/wp-includes/foo.php');
});

test('parsePatchFiles: both formats agree on the same target path (issue #11)', () => {
	assert.strictEqual(
		parsePatchFiles(GITHUB_DIFF).files[0].path,
		parsePatchFiles(TRAC_SVN_DIFF).files[0].path
	);
});

test('parsePatchFiles: a patch against the pre-src layout is remapped (issue #11)', () => {
	const res = parsePatchFiles(OLD_LAYOUT_DIFF);
	assert.strictEqual(res.files[0].path, 'src/wp-admin/admin.php');
});

test('parsePatchFiles: added and deleted files are classified, not treated as renames (issue #11)', () => {
	const added = parsePatchFiles(ADD_DIFF).files[0];
	assert.strictEqual(added.kind, 'add');
	assert.strictEqual(added.path, 'src/new.php');

	const deleted = parsePatchFiles(DELETE_DIFF).files[0];
	assert.strictEqual(deleted.kind, 'delete');
	// A deletion's target is the file that exists today, not /dev/null.
	assert.strictEqual(deleted.path, 'src/old.php');
});

// jsdiff represents a binary file as an entry with no hunks. Left unchecked
// that reads as "a file with no changes", so applying would report success
// while silently skipping it.
test('parsePatchFiles: a binary file is reported as binary rather than an empty change (issue #11)', () => {
	const res = parsePatchFiles(BINARY_DIFF);
	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.files[0].kind, 'binary');
});

test('parsePatchFiles: empty and unreadable input is rejected with a reason (issue #11)', () => {
	for (const empty of ['', '   ', null, undefined]) {
		const res = parsePatchFiles(empty);
		assert.strictEqual(res.ok, false);
		assert.strictEqual(res.error, 'The patch is empty.');
	}
	const notAPatch = parsePatchFiles('this is just prose, not a diff at all\n');
	assert.strictEqual(notAPatch.ok, false);
});

test('parsePatchFiles: CRLF line endings parse the same as LF (issue #11)', () => {
	const crlf = GITHUB_DIFF.replace(/\n/g, '\r\n');
	const res = parsePatchFiles(crlf);
	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.files[0].path, 'src/wp-includes/foo.php');
});

test('parsePatchFiles: a multi-file patch yields one entry per file (issue #11)', () => {
	const res = parsePatchFiles(GITHUB_DIFF + ADD_DIFF + DELETE_DIFF);
	assert.strictEqual(res.ok, true);
	assert.deepStrictEqual(res.files.map((f) => f.kind), ['modify', 'add', 'delete']);
});

test('stripPathPrefix: only strips when both sides are prefixed (issue #11)', () => {
	assert.deepStrictEqual(
		stripPathPrefix('a/src/foo.php', 'b/src/foo.php'),
		{ oldPath: 'src/foo.php', newPath: 'src/foo.php' }
	);
	assert.deepStrictEqual(
		stripPathPrefix('src/foo.php', 'src/foo.php'),
		{ oldPath: 'src/foo.php', newPath: 'src/foo.php' }
	);
	// /dev/null counts as agreement — an added file has only one real side.
	assert.deepStrictEqual(
		stripPathPrefix('/dev/null', 'b/src/new.php'),
		{ oldPath: '/dev/null', newPath: 'src/new.php' }
	);
});

test('stripPathPrefix: an old Subversion trunk/ prefix is dropped (issue #11)', () => {
	assert.deepStrictEqual(
		stripPathPrefix('trunk/wp-admin/admin.php', 'trunk/wp-admin/admin.php'),
		{ oldPath: 'wp-admin/admin.php', newPath: 'wp-admin/admin.php' }
	);
});

test('mapToSrcLayout: modern paths are left alone (issue #11)', () => {
	for (const p of ['src/wp-includes/foo.php', 'tests/phpunit/bar.php', 'tools/baz.js']) {
		assert.strictEqual(mapToSrcLayout(p), p);
	}
});

test('mapToSrcLayout: root-level build files stay at the root (issue #11)', () => {
	for (const p of ['package.json', 'Gruntfile.js', '.editorconfig', 'wp-cli.yml', 'wp-tests-config-sample.php']) {
		assert.strictEqual(mapToSrcLayout(p), p);
	}
});

// wp-cli.yml and wp-config-sample.php both start with "wp-" but did not move.
// This is the case the bare wp-* rule gets wrong without the exception list.
test('mapToSrcLayout: wp-prefixed files move to src, except the ones that did not (issue #11)', () => {
	assert.strictEqual(mapToSrcLayout('wp-admin/admin.php'), 'src/wp-admin/admin.php');
	assert.strictEqual(mapToSrcLayout('wp-includes/post.php'), 'src/wp-includes/post.php');
	assert.strictEqual(mapToSrcLayout('wp-cli.yml'), 'wp-cli.yml');
	assert.strictEqual(mapToSrcLayout('wp-config-sample.php'), 'wp-config-sample.php');
});

test('mapToSrcLayout: the loose root files that did move are remapped (issue #11)', () => {
	assert.strictEqual(mapToSrcLayout('index.php'), 'src/index.php');
	assert.strictEqual(mapToSrcLayout('xmlrpc.php'), 'src/xmlrpc.php');
	assert.strictEqual(mapToSrcLayout('license.txt'), 'src/license.txt');
});

test('mapToSrcLayout: an unrecognised path is left alone rather than guessed (issue #11)', () => {
	assert.strictEqual(mapToSrcLayout('some/other/thing.php'), 'some/other/thing.php');
});

test('planApply: only files the contributor already edited count as conflicts (issue #11)', () => {
	const { files } = parsePatchFiles(GITHUB_DIFF + ADD_DIFF);
	const plan = planApply({ files, dirtyPaths: ['src/wp-includes/foo.php', 'src/unrelated.php'] });
	assert.deepStrictEqual(plan.paths, ['src/wp-includes/foo.php', 'src/new.php']);
	assert.deepStrictEqual(plan.conflicts, ['src/wp-includes/foo.php']);
});

test('planApply: a clean tree has no conflicts (issue #11)', () => {
	const { files } = parsePatchFiles(GITHUB_DIFF);
	assert.deepStrictEqual(planApply({ files, dirtyPaths: [] }).conflicts, []);
});

test('planApply: binary files are listed as unsupported (issue #11)', () => {
	const { files } = parsePatchFiles(GITHUB_DIFF + BINARY_DIFF);
	assert.deepStrictEqual(planApply({ files }).unsupported, ['src/x.png']);
});

test('planApply: an install is needed only when the lockfile is touched (issue #11)', () => {
	assert.strictEqual(planApply({ files: parsePatchFiles(GITHUB_DIFF).files }).needsInstall, false);

	const lockDiff = `diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
 {
-  "x": 1
+  "x": 2
 }
`;
	assert.strictEqual(planApply({ files: parsePatchFiles(lockDiff).files }).needsInstall, true);
});

test('planApplySteps: the install step is named even when skipped (issue #11)', () => {
	const steps = planApplySteps({ needsInstall: false });
	assert.deepStrictEqual(steps.map((s) => s.key), ['apply', 'install', 'build']);
	assert.strictEqual(steps[1].skipped, true);
	assert.strictEqual(steps[1].skipMessage, SKIP_INSTALL_MESSAGE);
	assert.strictEqual(planApplySteps({ needsInstall: true })[1].skipped, false);
});

// The apply chain reuses the update chain's renderer helper by passing its own
// state map; this is what proves the third parameter actually drives it.
test('planApplySteps: updateStepStatuses drives the apply chain too (issue #11)', () => {
	const steps = planApplySteps({ needsInstall: false });
	const at = (state) => updateStepStatuses(steps, state, APPLY_STATE_TO_STEP).map((s) => s.status);

	assert.deepStrictEqual(at('applying'), ['current', 'pending', 'pending']);
	assert.deepStrictEqual(at('building'), ['complete', 'skipped', 'current']);
	assert.deepStrictEqual(at('done'), ['complete', 'skipped', 'complete']);
	// An unknown state must not mark anything complete.
	assert.deepStrictEqual(at('idle'), ['pending', 'pending', 'pending']);
});

test('planApplySteps: the update chain is unaffected by the new state map (issue #11)', () => {
	const steps = planApplySteps({ needsInstall: true });
	// 'fetching' belongs to the update chain, not this one.
	assert.deepStrictEqual(
		updateStepStatuses(steps, 'fetching', APPLY_STATE_TO_STEP).map((s) => s.status),
		['pending', 'pending', 'pending']
	);
});
