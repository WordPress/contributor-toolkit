// Keeps the Playground servers on the loopback interface.
//
// `@wp-playground/cli` starts its server with `server.listen(port, callback)` —
// no address — and Node then listens on `::`/`0.0.0.0`, i.e. every interface.
// That makes the contributor's WordPress, admin/admin credentials and all,
// reachable from the local network, and on Windows it is what raises the
// firewall prompt asking to allow public and private networks.
//
// `runCLI()` has no `host` option to pass instead (`RunCLIArgs` only knows
// `db-host`), so the only place to fix it from the outside is `listen` itself.
// Patching `net.Server.prototype.listen` before the CLI is required covers every
// server it creates — `http.Server` extends `net.Server` and doesn't override
// `listen`. Same "patch the built-in first" shape as `hide-child-windows.js`.
//
// Delete this once `runCLI` accepts a host.

const PATCHED = Symbol.for('wp-dev-env.loopbackPatched');

const LOOPBACK = '127.0.0.1';

function isPlainObject(value) {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Node treats a numeric string port the same as a number.
function isPort(value) {
	if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
	return typeof value === 'string' && /^\d+$/.test(value);
}

// Given the arguments of `net.Server.prototype.listen`, returns them with a
// loopback host filled in — but only when the caller asked for a TCP port and
// left the address out. Every other overload is passed through untouched:
// `listen(path, ...)` is an IPC socket, `listen(handle, ...)` carries its own
// binding, and an explicit host (even a deliberate '0.0.0.0') wins.
function withLoopbackHost(args, host = LOOPBACK) {
	if (args.length === 0) return args;

	const [first] = args;

	if (isPlainObject(first)) {
		// Options form. `path` means IPC; anything already bound to a host or
		// carrying its own handle is left alone.
		if (!isPort(first.port)) return args;
		if (first.host !== undefined || first.path !== undefined) return args;
		const next = args.slice();
		next[0] = { ...first, host };
		return next;
	}

	if (!isPort(first)) return args;

	// listen(port[, host][, backlog][, callback]) — a string in second position
	// is the host, so there is nothing to add. A number there is the backlog,
	// and the host belongs in front of it.
	if (typeof args[1] === 'string') return args;

	const next = args.slice();
	next.splice(1, 0, host);
	return next;
}

// Wraps `listen` on the given `net` module's Server prototype. Idempotent, so
// requiring this from two places can't double-wrap.
function patchNetListen(net, host = LOOPBACK) {
	if (net[PATCHED]) return net;

	const proto = net.Server && net.Server.prototype;
	const original = proto && proto.listen;
	if (typeof original !== 'function') return net;

	proto.listen = function listen(...args) {
		return original.apply(this, withLoopbackHost(args, host));
	};

	Object.defineProperty(net, PATCHED, { value: true, enumerable: false });
	return net;
}

// Patches the live net module for this process and everything it requires
// afterwards. Applied on every platform: only the firewall prompt is
// Windows-only, the exposure isn't.
function bindLoopbackOnly() {
	return patchNetListen(require('net'));
}

module.exports = { patchNetListen, bindLoopbackOnly, withLoopbackHost, LOOPBACK };
