const test = require('node:test');
const assert = require('node:assert/strict');

const { patchNetListen, withLoopbackHost } = require('../src/bind-loopback.js');

// A stand-in for the net module that records how `listen` was called, so the
// patch can be exercised without binding a real socket.
function fakeNet() {
	const calls = [];
	class Server {
		listen(...args) {
			calls.push(args);
			return this;
		}
	}
	return { calls, Server };
}

// The exact call @wp-playground/cli makes: a port and a callback, no address.
test('a port with no address gets 127.0.0.1', () => {
	const noop = () => {};
	assert.deepEqual(withLoopbackHost([8080, noop]), [8080, '127.0.0.1', noop]);
	assert.deepEqual(withLoopbackHost([8080]), [8080, '127.0.0.1']);
});

test('an ephemeral port still gets a host', () => {
	// listen(0) is the "pick a free port" form the runners rely on; 0 is a
	// perfectly valid port and must not be mistaken for "no port given".
	assert.deepEqual(withLoopbackHost([0]), [0, '127.0.0.1']);
});

test('a numeric string port is treated as a port', () => {
	// Node accepts '8080' as readily as 8080, and so does the CLI when the port
	// comes from argv.
	assert.deepEqual(withLoopbackHost(['8080']), ['8080', '127.0.0.1']);
});

test('the host goes in front of a backlog', () => {
	// listen(port, backlog, cb) — a number in second position is the backlog, so
	// the host cannot simply be appended.
	const noop = () => {};
	assert.deepEqual(withLoopbackHost([8080, 511, noop]), [8080, '127.0.0.1', 511, noop]);
});

test('an explicit address is left alone', () => {
	// Including a deliberate 0.0.0.0: the caller asked for it, and this patch is
	// a default, not a lock.
	assert.deepEqual(withLoopbackHost([8080, '0.0.0.0']), [8080, '0.0.0.0']);
	assert.deepEqual(withLoopbackHost([8080, '::1']), [8080, '::1']);
});

test('an options object gains a host without being mutated', () => {
	// The caller may reuse the object, so the copy matters.
	const options = { port: 8080, backlog: 511 };
	const patched = withLoopbackHost([options]);
	assert.deepEqual(patched[0], { port: 8080, backlog: 511, host: '127.0.0.1' });
	assert.deepEqual(options, { port: 8080, backlog: 511 });
	assert.notEqual(patched[0], options);
});

test('an options object that already has a host is left alone', () => {
	const args = [{ port: 8080, host: '0.0.0.0' }];
	assert.equal(withLoopbackHost(args), args);
});

test('IPC and handle forms are left alone', () => {
	// listen(path) and listen({ path }) are unix sockets / named pipes, and
	// listen(handle) carries its own binding — a host would break all three.
	const noop = () => {};
	assert.deepEqual(withLoopbackHost(['/tmp/app.sock', noop]), ['/tmp/app.sock', noop]);
	assert.deepEqual(withLoopbackHost([{ path: '/tmp/app.sock' }]), [{ path: '/tmp/app.sock' }]);
	const handle = { fd: 3 };
	assert.equal(withLoopbackHost([handle])[0], handle);
	assert.deepEqual(withLoopbackHost([]), []);
});

test('patching the prototype redirects a real listen call', () => {
	const net = fakeNet();
	patchNetListen(net);
	const noop = () => {};
	new net.Server().listen(8080, noop);
	assert.deepEqual(net.calls[0], [8080, '127.0.0.1', noop]);
});

test('patching twice wraps only once', () => {
	// Both runners require this module, and so may anything they load.
	const net = fakeNet();
	patchNetListen(net);
	const wrapped = net.Server.prototype.listen;
	patchNetListen(net);
	assert.equal(net.Server.prototype.listen, wrapped);
});

test('the host is configurable', () => {
	const net = fakeNet();
	patchNetListen(net, '::1');
	new net.Server().listen(8080);
	assert.deepEqual(net.calls[0], [8080, '::1']);
});
