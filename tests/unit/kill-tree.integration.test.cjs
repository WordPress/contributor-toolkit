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

const { killChildTree, killTreeByPid } = require('../../src/kill-tree.js');

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

test('a forced group signal by pid ends a descendant that ignored SIGTERM, after the runner itself has died', { ...posixOnly, timeout: 60000 }, async (t) => {
	// runner -> sh -> node, the way the app's scripts are runner -> npm -> ... .
	// `& wait` forces the fork: `sh -c` with a single command exec()s it, and
	// the shell would *be* the node process. Arguments go in positionally so
	// nothing here is quoted through the shell.
	const child = spawn('sh', ['-c', '"$0" -e "$1" & wait', process.execPath, STUBBORN], {
		detached: true,
		stdio: ['ignore', 'pipe', 'ignore'],
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
	});
	t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
	let out = '';
	const grandchildPid = await new Promise((resolve, reject) => {
		child.on('error', reject);
		child.on('exit', (code, signal) => reject(new Error(`the shell exited before its child reported a pid (${code}, ${signal})`)));
		child.stdout.on('data', (d) => { out += d; const m = /^(\d+)/m.exec(out); if (m) resolve(Number(m[1])); });
	});
	assert.notEqual(grandchildPid, child.pid, 'the premise is a descendant, not the direct child');
	assert.ok(alive(grandchildPid));

	// The polite signal reaches the group: the shell dies of it, the grandchild
	// sits through it. Exactly the state the escalation timer fires into.
	assert.equal(killChildTree(child), true);
	assert.equal(await until(() => child.exitCode !== null || child.signalCode, 5000), true, 'the shell, like the runner, dies of SIGTERM');
	assert.equal(await until(() => !alive(grandchildPid), 1500), false, 'the grandchild ignores SIGTERM, which is the premise');

	// What a ChildProcess-based escalation would do now: nothing.
	assert.equal(killChildTree(child), false, 'the exited runner reads as nothing to do, which is why the escalation goes by pid');

	// The escalation the handler arms three seconds later.
	assert.equal(killTreeByPid(child.pid, 'SIGKILL'), true);
	assert.equal(await until(() => !alive(grandchildPid), 5000), true, 'the forced group signal must end the grandchild');
});
