// Kills a spawned child together with its descendants.
//
// The processes worth stopping are rarely the direct child: the runners spawn
// npm, which spawns a shell, which spawns grunt, which spawns node. A plain
// child.kill() signals only the first link, so quitting the app left watchers
// and servers running (#83).
//
// Two platform mechanisms, chosen by killTreePlan so the decision is testable
// without spawning anything:
//
// - win32: `taskkill /pid <pid> /T /F` — the only stock way to end a process
//   tree on Windows, where signals do not exist and job objects are not
//   available to an already-spawned tree.
// - POSIX: signal the process group (negative pid). This requires the child to
//   have been spawned with `detached: true`, which makes it a group leader its
//   descendants stay inside; falls back to signalling the child alone when the
//   group signal fails (e.g. the child was not detached).

'use strict';

/**
 * Pure decision: how to kill the tree rooted at `pid` on `platform`.
 * Returns null for a pid that cannot identify a live process.
 */
function killTreePlan(platform, pid) {
	if (!Number.isInteger(pid) || pid <= 0) return null;
	if (platform === 'win32') {
		return { type: 'command', command: 'taskkill', args: ['/pid', String(pid), '/T', '/F'] };
	}
	return { type: 'signal', signal: 'SIGTERM', target: -pid, fallback: pid };
}

/**
 * Applies killTreePlan to a ChildProcess. Never throws: this runs during
 * quit, where a failure to kill one child must not stop the sweep of the rest.
 * Returns true when a kill was attempted.
 */
function killChildTree(child, {
	platform = process.platform,
	spawnSync = require('child_process').spawnSync,
	kill = process.kill
} = {}) {
	if (!child || !child.pid) return false;
	// exitCode/signalCode are set once the child has exited; nothing to do then.
	if (child.exitCode !== null || child.signalCode) return false;
	const plan = killTreePlan(platform, child.pid);
	if (!plan) return false;
	if (plan.type === 'command') {
		try { spawnSync(plan.command, plan.args, { windowsHide: true }); } catch {}
		return true;
	}
	try {
		kill(plan.target, plan.signal);
	} catch {
		try { kill(plan.fallback, plan.signal); } catch {}
	}
	return true;
}

module.exports = { killTreePlan, killChildTree };
