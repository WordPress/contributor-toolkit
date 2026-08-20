'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { shouldClearAttributes, removeTree } = require('../../src/remove-tree.js');

test('shouldClearAttributes: a permission error calls for the attribute pass', () => {
	assert.equal(shouldClearAttributes({ code: 'EPERM' }), true);
	assert.equal(shouldClearAttributes({ code: 'EACCES' }), true);
});

test('shouldClearAttributes: anything else would fail the same way twice', () => {
	assert.equal(shouldClearAttributes({ code: 'ENOTDIR' }), false);
	assert.equal(shouldClearAttributes({ code: 'EIO' }), false);
	assert.equal(shouldClearAttributes(null), false);
	assert.equal(shouldClearAttributes(undefined), false);
});

/**
 * A tree shaped like the case #381 is about: a checkout whose `.git/objects`
 * a real Git protected. Both protections are staged — the read-only file that
 * matters on Windows and the write-bit-less directory that matters on POSIX —
 * so the module is exercised end to end on either CI runner.
 *
 * @param {Object} t The node:test context, for cleanup.
 * @return {string} The root of the staged tree.
 */
function makeProtectedTree(t) {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-'));
	t.after(() => {
		// Belt and braces for a failing run: restore what the test locked so
		// the tmpdir does not outlive the suite.
		try { fs.chmodSync(path.join(root, 'objects'), 0o777); } catch {}
		try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
	});
	const objects = path.join(root, 'objects');
	fs.mkdirSync(path.join(objects, 'ab'), { recursive: true });
	const loose = path.join(objects, 'ab', 'cdef0123');
	fs.writeFileSync(loose, 'blob');
	fs.writeFileSync(path.join(root, 'ordinary.txt'), 'fine');
	fs.chmodSync(loose, 0o444);
	fs.chmodSync(path.join(objects, 'ab'), 0o555);
	return root;
}

test('removeTree: deletes a tree a real Git protected', async (t) => {
	const root = makeProtectedTree(t);

	// The staging is real on POSIX: plain rm refuses to unlink inside the
	// 0o555 directory, so this test is red without the attribute pass. Not on
	// Windows — Node's rm chmods a read-only entry and retries by itself (CI
	// proved it: this guard held a rejection that never came) — so there the
	// tree only exercises the module end to end, and the failure this module
	// answers on Windows is the held handle the retry budget covers.
	if (process.platform !== 'win32') {
		await assert.rejects(fs.promises.rm(root, { recursive: true, force: true }));
	}

	await removeTree(root);
	assert.equal(fs.existsSync(root), false);
});

test('removeTree: a tree with nothing wrong costs one rm call', async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-plain-'));
	t.after(() => { try { fs.rmSync(root, { recursive: true, force: true }); } catch {} });
	fs.writeFileSync(path.join(root, 'file.txt'), 'x');

	const calls = [];
	const counting = {
		promises: {
			rm: (p, o) => { calls.push(p); return fs.promises.rm(p, o); },
			chmod: fs.promises.chmod.bind(fs.promises),
			readdir: fs.promises.readdir.bind(fs.promises)
		}
	};
	await removeTree(root, { fs: counting });
	assert.equal(calls.length, 1);
	assert.equal(fs.existsSync(root), false);
});

test('removeTree: the attribute pass does not follow a symlink out of the tree', { skip: process.platform === 'win32' && 'symlink creation needs privileges on Windows' }, async (t) => {
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-outside-'));
	t.after(() => { try { fs.rmSync(outside, { recursive: true, force: true }); } catch {} });
	const script = path.join(outside, 'bin.sh');
	fs.writeFileSync(script, '#!/bin/sh\n');
	fs.chmodSync(script, 0o755);

	// A protected tree, so the attribute pass actually runs — and a symlink
	// pointing at the executable outside, placed *inside* the unwritable
	// directory so the first (failing) rm cannot unlink it before the walk
	// runs. chmod follows symlinks, so a walk that touches the link would
	// strip the target's exec bit (a populated node_modules/.bin is exactly
	// this shape).
	const root = makeProtectedTree(t);
	const locked = path.join(root, 'objects', 'ab');
	fs.chmodSync(locked, 0o755);
	fs.symlinkSync(script, path.join(locked, 'linked-bin'));
	fs.chmodSync(locked, 0o555);

	await removeTree(root);
	assert.equal(fs.existsSync(root), false);
	// eslint-disable-next-line no-bitwise -- masking is how a POSIX mode is read; the same idiom as pr-files.cjs.
	assert.equal(fs.statSync(script).mode & 0o777, 0o755, 'the symlink target must keep its mode');
});

/**
 * An `fs` whose `rm` always refuses with EPERM, over the real `chmod`,
 * `readdir` and `lstat`. The attribute pass then runs for real against a real
 * tree while nothing is ever deleted — which is exactly the state a caller is
 * told about when a removal half-fails, and the only state in which the modes
 * the pass leaves behind are observable.
 *
 * @return {Object} The injectable fs.
 */
function refusingFs() {
	return {
		promises: {
			rm: async () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); },
			chmod: fs.promises.chmod.bind(fs.promises),
			readdir: fs.promises.readdir.bind(fs.promises),
			lstat: fs.promises.lstat.bind(fs.promises)
		}
	};
}

// eslint-disable-next-line no-bitwise -- masking is how a POSIX mode is read; the same idiom as pr-files.cjs.
const modeOf = (p) => fs.statSync(p).mode & 0o777;

test('removeTree: the attribute pass adds the write bit without replacing the mode', { skip: process.platform === 'win32' && 'POSIX modes are not what Windows stores' }, async (t) => {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-modes-'));
	const locked = path.join(root, 'objects');
	fs.mkdirSync(locked);
	const script = path.join(locked, 'bin.sh');
	const loose = path.join(locked, 'cdef0123');
	fs.writeFileSync(script, '#!/bin/sh\n');
	fs.writeFileSync(loose, 'blob');
	fs.chmodSync(script, 0o755);
	fs.chmodSync(loose, 0o444);
	fs.chmodSync(locked, 0o555);
	t.after(() => {
		try { fs.chmodSync(locked, 0o777); } catch {}
		try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
	});

	// The removal never succeeds, so the tree survives the pass — the half
	// deletion this module reports rather than hides.
	await assert.rejects(removeTree(root, { fs: refusingFs() }));

	assert.equal(modeOf(script), 0o755, 'an executable survivor must keep its exec bit');
	assert.equal(modeOf(loose), 0o644, 'the read-only file gains owner write and keeps the rest');
	assert.equal(modeOf(locked), 0o755, 'the directory gains owner rwx and keeps the rest');
});

test('removeTree: the attribute pass does not follow a symlink given as the root', { skip: process.platform === 'win32' && 'symlink creation needs privileges on Windows' }, async (t) => {
	const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-root-target-'));
	const inside = path.join(outside, 'private.txt');
	fs.writeFileSync(inside, 'not yours');
	fs.chmodSync(inside, 0o444);
	fs.chmodSync(outside, 0o555);
	const home = fs.mkdtempSync(path.join(os.tmpdir(), 'remove-tree-root-link-'));
	t.after(() => {
		try { fs.chmodSync(outside, 0o777); } catch {}
		try { fs.rmSync(outside, { recursive: true, force: true }); } catch {}
		try { fs.rmSync(home, { recursive: true, force: true }); } catch {}
	});

	// A registered site path that is itself a link. The removal refuses, so the
	// attribute pass runs on the root — and the root is the one entry no
	// per-child check ever sees.
	const link = path.join(home, 'site');
	fs.symlinkSync(outside, link);
	await assert.rejects(removeTree(link, { fs: refusingFs() }));

	assert.equal(modeOf(outside), 0o555, 'the link target must keep its mode');
	assert.equal(modeOf(inside), 0o444, 'and so must everything inside it');
});

test('removeTree: a missing directory is not an error', async () => {
	await removeTree(path.join(os.tmpdir(), 'remove-tree-never-existed-xyz'));
});

test('removeTree: a failure that survives the attribute pass propagates', async () => {
	const stubborn = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
	const failing = {
		promises: {
			rm: async () => { throw stubborn; },
			chmod: async () => {},
			readdir: async () => [],
			lstat: async () => ({ isSymbolicLink: () => false, isDirectory: () => true, mode: 0o700 })
		}
	};
	await assert.rejects(
		removeTree(path.join(os.tmpdir(), 'remove-tree-stubborn'), { fs: failing }),
		(e) => e === stubborn
	);
});

test('removeTree: a non-permission failure is not retried', async () => {
	const io = Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
	let attempts = 0;
	const failing = {
		promises: {
			rm: async () => { attempts += 1; throw io; },
			chmod: async () => { throw new Error('the attribute pass must not run'); },
			readdir: async () => { throw new Error('the attribute pass must not run'); },
			lstat: async () => { throw new Error('the attribute pass must not run'); }
		}
	};
	await assert.rejects(
		removeTree(path.join(os.tmpdir(), 'remove-tree-io'), { fs: failing }),
		(e) => e === io
	);
	assert.equal(attempts, 1);
});
