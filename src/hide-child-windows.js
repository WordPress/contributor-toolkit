// Keeps Windows from flashing a console window for every grandchild process.
//
// electron.exe is a GUI-subsystem binary, so the runners we spawn from main.js
// have no console of their own — `windowsHide: true` there only stops Windows
// from showing one, it doesn't create one to inherit. When npm's run-script
// then spawns `cmd.exe /d /s /c "grunt build"` (and cmd in turn runs the
// grunt.cmd shim), each of those console applications finds nothing to inherit
// and Windows allocates a brand new *visible* console for it.
//
// The runners load npm's CLI in-process, so patching child_process here — before
// requiring that CLI — reaches those spawns. `windowsHide: true` maps to
// CREATE_NO_WINDOW, which gives cmd.exe a console that is never displayed and
// which its own descendants inherit, so one patch covers the whole subtree.
//
// Who must NOT call this: the main process. The patch is deliberately blunt. It
// forces the flag on every child_process entry point of the process, overriding
// even an explicit `windowsHide: false`, and main.js is the process that spawns
// the contributor's editor — a GUI application, which the flag starts with no
// window while the spawn still reports success (#181; the comment above
// openSiteInEditor in src/editor-launch.js has the mechanism). Whether a given
// call site escapes depends on whether it captured its `spawn` binding before
// the patch ran, which is exactly the kind of thing nobody should have to
// reason about. "Hide the console flashes everywhere, once at startup" is the
// plausible-looking change that reinstates that bug; the ipc-wiring suite
// asserts main.js does not make it. Only the four runners — install, script,
// server, playground-web — take this patch, and only because they load npm's or
// Playground's CLI in-process.

const PATCHED = Symbol.for('wp-dev-env.windowsHidePatched');

const METHODS = [
	'spawn',
	'spawnSync',
	'exec',
	'execSync',
	'execFile',
	'execFileSync',
	'fork'
];

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// These functions have incompatible signatures — spawn(cmd, args, opts),
// exec(cmd, opts, cb), execFile(file, args, opts, cb) — so instead of special
// casing each one we find the options object positionally: it is the last
// argument that is a plain object, ignoring any trailing callback. spawn's
// `args` is an array, so it is never mistaken for options.
function withWindowsHide(args) {
	const next = args.slice();
	let index = next.length - 1;
	while (index >= 0 && typeof next[index] === 'function') index -= 1;

	if (index >= 0 && isPlainObject(next[index])) {
		next[index] = { ...next[index], windowsHide: true };
		return next;
	}

	next.splice(index + 1, 0, { windowsHide: true });
	return next;
}

// Forces `windowsHide: true` on every child_process entry point of `cp`.
// A no-op off Windows, and idempotent so requiring this twice can't double-wrap.
function patchChildProcess(cp, platform = process.platform) {
	if (platform !== 'win32') return cp;
	if (cp[PATCHED]) return cp;

	for (const name of METHODS) {
		const original = cp[name];
		if (typeof original !== 'function') continue;
		cp[name] = function patched(...args) {
			return original.apply(this, withWindowsHide(args));
		};
	}

	Object.defineProperty(cp, PATCHED, { value: true, enumerable: false });
	return cp;
}

// Patches the live child_process module for this process and everything it
// requires afterwards.
function hideChildWindows() {
	return patchChildProcess(require('child_process'));
}

module.exports = { patchChildProcess, hideChildWindows, withWindowsHide };
