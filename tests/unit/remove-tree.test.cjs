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
 * a real Git protected. On Windows the read-only file is what blocks the
 * unlink; on POSIX it is the directory without its write bit. Both are staged
 * so the same test is the red one on either CI runner.
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

	// The staging is real: the cheap removal this module wraps must fail on
	// this tree, or the test proves nothing. (Windows refuses the read-only
	// file; POSIX refuses to unlink inside the 0o555 directory.)
	await assert.rejects(fs.promises.rm(root, { recursive: true, force: true }));

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

test('removeTree: a missing directory is not an error', async () => {
	await removeTree(path.join(os.tmpdir(), 'remove-tree-never-existed-xyz'));
});

test('removeTree: a failure that survives the attribute pass propagates', async () => {
	const stubborn = Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
	const failing = {
		promises: {
			rm: async () => { throw stubborn; },
			chmod: async () => {},
			readdir: async () => []
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
			readdir: async () => { throw new Error('the attribute pass must not run'); }
		}
	};
	await assert.rejects(
		removeTree(path.join(os.tmpdir(), 'remove-tree-io'), { fs: failing }),
		(e) => e === io
	);
	assert.equal(attempts, 1);
});
