'use strict';

// The mechanism #498 rests on, against a real process: a runner whose
// descendant outlives it keeps the stdio pipes open, so `exit` fires and
// `close` does not; destroying the pipes on our side is what makes Node emit
// `close`, with the exit code the runner gave, and a forced group signal by
// pid ends the orphan although the leader is gone. The unit suite pins the
// wiring in main.js; this pins the Node and POSIX facts it relies on. POSIX
// only by nature (process groups and `sh`); on Windows the orphan runs on and
// the destroyed pipes still deliver `close`, which the wiring test covers.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const { killTreeByPid } = require('../../src/kill-tree.js');

const posixOnly = process.platform === 'win32' ? { skip: 'process groups are POSIX' } : {};

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

test('a runner whose orphan holds the pipes exits without closing, and closes once the pipes are destroyed', { ...posixOnly, timeout: 30000 }, async (t) => {
	// runner (sh) -> orphan (node) that inherits stdout and keeps it open past
	// the runner's own exit 3, the way wp-build outlives npm (#498). `& exit`
	// backgrounds it so the shell itself ends at once.
	const runner = spawn('sh', ['-c', `"$0" -e "$1" & exit 3`, process.execPath, 'console.log(process.pid); setInterval(() => {}, 1000);'], {
		detached: true,
		stdio: ['pipe', 'pipe', 'pipe']
	});
	// Straight to the group, never the bare pid: once the body has reaped the
	// group, the runner's pid may be someone else's.
	let orphanPid = null;
	t.after(() => {
		try { process.kill(-runner.pid, 'SIGKILL'); } catch {}
		if (orphanPid !== null) { try { process.kill(orphanPid, 'SIGKILL'); } catch {} }
	});

	runner.stdout.on('data', (data) => { if (orphanPid === null) orphanPid = Number(String(data).trim()); });
	const exited = new Promise((resolve) => runner.once('exit', resolve));
	let closed = null;
	runner.once('close', (code, signal) => { closed = { code, signal }; });

	assert.equal(await exited, 3, 'the runner exits with its own code');
	assert.ok(await until(() => orphanPid !== null, 5000), 'the orphan never reported its pid');
	assert.ok(alive(orphanPid), 'the orphan should outlive the runner');
	assert.equal(await until(() => closed !== null, 1000), false, 'close must not come while the orphan holds the pipes');

	// What main.js does when the grace runs out.
	killTreeByPid(runner.pid, 'SIGKILL');
	for (const stream of [runner.stdout, runner.stderr, runner.stdin]) stream.destroy();

	assert.ok(await until(() => closed !== null, 5000), 'destroying the pipes did not deliver close');
	assert.deepEqual(closed, { code: 3, signal: null }, 'close carries the code the runner exited with');
	assert.ok(await until(() => !alive(orphanPid), 5000), 'the group signal by pid did not end the orphan');
});
