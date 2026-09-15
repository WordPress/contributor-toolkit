'use strict';

// killChildTree against a real process group: a detached shell whose
// grandchild ignores SIGTERM, the shape of Gutenberg's `npm run dev` tree
// when its native TypeScript binary is mid-build (#251). The unit suite pins
// the plan; this pins that the forced group signal ends what the polite one
// could not. POSIX only by nature (process groups); the Windows plan is a
// `taskkill /F` the unit suite covers by injection.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const { killChildTree } = require('../../src/kill-tree.js');

const posixOnly = process.platform === 'win32' ? { skip: 'process groups are POSIX' } : {};

// A grandchild that installs a SIGTERM handler doing nothing and stays alive,
// and prints its pid so the test can watch it directly.
const STUBBORN = 'process.on("SIGTERM", () => {}); console.log(process.pid); setInterval(() => {}, 1000);';

function alive(pid) {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

function until(check, ms) {
	return new Promise((resolve) => {
		const started = Date.now();
		const tick = () => {
			if (check()) return resolve(true);
			if (Date.now() - started > ms) return resolve(false);
			setTimeout(tick, 50);
		};
		tick();
	});
}

test('a forced group signal ends a descendant that ignored SIGTERM', posixOnly, async (t) => {
	// runner -> sh -> node, the way the app's scripts are runner -> npm -> ... .
	const child = spawn('sh', ['-c', `"${process.execPath}" -e '${STUBBORN}'`], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
	t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
	let out = '';
	const grandchildPid = await new Promise((resolve) => {
		child.stdout.on('data', (d) => { out += d; const m = /^(\d+)/m.exec(out); if (m) resolve(Number(m[1])); });
	});
	assert.ok(alive(grandchildPid));

	// The polite signal reaches the group and the grandchild sits through it.
	assert.equal(killChildTree(child), true);
	assert.equal(await until(() => !alive(grandchildPid), 1500), false, 'the grandchild ignores SIGTERM, which is the premise');

	// The escalation the handler arms three seconds later.
	assert.equal(killChildTree(child, { signal: 'SIGKILL' }), true);
	assert.equal(await until(() => !alive(grandchildPid), 5000), true, 'the forced group signal must end the grandchild');
});
