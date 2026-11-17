'use strict';

// The control channel (#764) over a real socket: the server from
// src/control-channel.cjs and the client the `toolkit` command uses, `ask` in
// src/cli.cjs, talking to each other in a temporary directory. A named pipe on
// Windows, a socket file elsewhere, which is the endpoint `controlEndpoint`
// answers for the machine the suite runs on.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const {
	MAX_REQUEST_BYTES,
	REFUSAL_CODES,
	ControlRefusal,
	controlEndpoint,
	cliShimPath,
	startControlServer
} = require('../../src/control-channel.cjs');
const { ask } = require('../../src/cli.cjs');

const POSIX = process.platform !== 'win32';

function profile(t) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-control-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	return dir;
}

async function serve(t, actions, userData = profile(t), options = {}) {
	const endpoint = controlEndpoint({ userData });
	const server = await startControlServer({ endpoint, actions, ...options });
	t.after(() => server.close());
	return { endpoint, server };
}

// What a client that is not the CLI can send: bytes of its choosing.
function sendRaw(endpoint, bytes) {
	return new Promise((resolve) => {
		let received = '';
		const socket = net.createConnection(endpoint, () => socket.write(bytes));
		socket.setEncoding('utf8');
		socket.on('data', (chunk) => { received += chunk; });
		// A server that answers and hangs up while this is still writing is
		// one of the cases under test; what it said is the result either way.
		socket.on('error', () => {});
		socket.on('close', () => resolve(received));
	});
}

test('the endpoint is a socket in the profile, and on Windows a pipe nobody can name ahead of the app', () => {
	assert.equal(
		controlEndpoint({ userData: '/Users/dev/Library/Application Support/Toolkit', platform: 'darwin' }),
		'/Users/dev/Library/Application Support/Toolkit/control.sock'
	);

	// A pipe's name is shared by every account on the machine. One derived
	// from the profile path could be taken first by another account, which
	// would then answer the command; so no two starts have the same name.
	const userData = 'C:\\Users\\dev\\AppData\\Roaming\\Toolkit';
	const first = controlEndpoint({ userData, platform: 'win32' });
	const second = controlEndpoint({ userData, platform: 'win32' });
	assert.match(first, /^\\\\\.\\pipe\\wpct-control-[0-9a-f]{32}$/);
	assert.notEqual(first, second);
	assert.equal(controlEndpoint({ userData, platform: 'win32', nonce: 'abc' }), '\\\\.\\pipe\\wpct-control-abc');
});

test('the command is written into the profile, with the extension Windows needs', () => {
	assert.equal(cliShimPath({ userData: '/Users/dev/Toolkit', platform: 'darwin' }), '/Users/dev/Toolkit/bin/toolkit');
	assert.equal(cliShimPath({ userData: 'C:\\Users\\dev\\Toolkit', platform: 'win32' }), 'C:\\Users\\dev\\Toolkit\\bin\\toolkit.cmd');
});

test('a request is answered by the action it names, with the parameters it sent', async (t) => {
	const asked = [];
	const { endpoint } = await serve(t, {
		'sites.list': async (params) => { asked.push(params); return { sites: [{ path: '/sites/wp' }] }; }
	});

	assert.deepEqual(await ask(endpoint, { action: 'sites.list' }), { ok: true, result: { sites: [{ path: '/sites/wp' }] } });
	assert.deepEqual(await ask(endpoint, { action: 'sites.list', params: { a: 1 } }), { ok: true, result: { sites: [{ path: '/sites/wp' }] } });
	assert.deepEqual(asked, [{}, { a: 1 }]);
});

test('a name that is not an action is refused, and so is one the object only inherits', async (t) => {
	const { endpoint } = await serve(t, { 'sites.list': async () => ({}) });

	for (const action of ['sites.delete', 'constructor', 'toString', '__proto__']) {
		const reply = await ask(endpoint, { action });
		assert.equal(reply.ok, false, action);
		assert.equal(reply.code, REFUSAL_CODES.UNKNOWN_ACTION, action);
	}
});

test('a request that is not one is refused without reaching an action', async (t) => {
	let reached = 0;
	const { endpoint } = await serve(t, { 'sites.list': async () => { reached += 1; return {}; } });

	const refused = async (bytes) => JSON.parse(await sendRaw(endpoint, bytes));
	assert.equal((await refused('not json\n')).code, REFUSAL_CODES.INVALID_REQUEST);
	assert.equal((await refused('["sites.list"]\n')).code, REFUSAL_CODES.INVALID_REQUEST);
	assert.equal((await refused('{"action":7}\n')).code, REFUSAL_CODES.INVALID_REQUEST);
	assert.equal((await refused('{"action":"sites.list","params":"all"}\n')).code, REFUSAL_CODES.INVALID_REQUEST);
	assert.equal(reached, 0);
});

test('a request with no end is refused once it is too long to be one', async (t) => {
	const { endpoint } = await serve(t, { 'sites.list': async () => ({}) });

	const reply = JSON.parse(await sendRaw(endpoint, 'x'.repeat(MAX_REQUEST_BYTES + 1)));
	assert.deepEqual({ ok: reply.ok, code: reply.code }, { ok: false, code: REFUSAL_CODES.TOO_LARGE });
});

test('only the first request on a connection is answered', async (t) => {
	let reached = 0;
	const { endpoint } = await serve(t, { 'sites.list': async () => { reached += 1; return {}; } });

	const received = await sendRaw(endpoint, '{"action":"sites.list"}\n{"action":"sites.list"}\n');
	assert.equal(received.trim().split('\n').length, 1);
	assert.equal(reached, 1);
});

test('an action that throws is an answer, with its own code when it refused, and the next request is still served', async (t) => {
	const { endpoint } = await serve(t, {
		broken: async () => { throw new Error('settings.json is not JSON'); },
		missing: async () => { throw Object.assign(new Error('no such file'), { code: 'ENOENT' }); },
		refuses: async () => { throw new ControlRefusal('unknown-site', 'No such site.'); },
		detailed: async () => { throw Object.assign(new ControlRefusal('script-failed', 'npm run build exited with code 1.'), { detail: { output: 'Error: boom', ok: true, code: 'ok' } }); },
		'sites.list': async () => ({ sites: [] })
	});

	assert.deepEqual(await ask(endpoint, { action: 'broken' }), { ok: false, code: REFUSAL_CODES.FAILED, error: 'settings.json is not JSON' });
	// A code on any other error is not the action's refusal: a failed read
	// carries `ENOENT`, and that is not something to hand a tool as a reason.
	assert.equal((await ask(endpoint, { action: 'missing' })).code, REFUSAL_CODES.FAILED);
	assert.deepEqual(await ask(endpoint, { action: 'refuses' }), { ok: false, code: 'unknown-site', error: 'No such site.' });
	// What a refusal carries beside its sentence travels with it, and cannot
	// replace the three fields every refusal has.
	assert.deepEqual(await ask(endpoint, { action: 'detailed' }), { output: 'Error: boom', ok: false, code: 'script-failed', error: 'npm run build exited with code 1.' });
	assert.equal((await ask(endpoint, { action: 'sites.list' })).ok, true);
});

test('with no app listening, the client says the app is not running', async (t) => {
	const userData = profile(t);
	const endpoint = controlEndpoint({ userData });
	assert.equal((await ask(endpoint, { action: 'sites.list' })).code, 'not-running');

	// And again once an app that was listening has closed.
	const server = await startControlServer({ endpoint, actions: { 'sites.list': async () => ({}) } });
	assert.equal((await ask(endpoint, { action: 'sites.list' })).ok, true);
	await server.close();
	assert.equal((await ask(endpoint, { action: 'sites.list' })).code, 'not-running');
});

test('a client is told when the app takes too long to answer', async (t) => {
	const { endpoint } = await serve(t, { slow: () => new Promise(() => {}) });

	assert.equal((await ask(endpoint, { action: 'slow' }, { timeoutMs: 50 })).code, 'timeout');
});

// The limit on a client is on how long it takes to ask, not on how long the
// app takes to answer: an action slower than that limit is still answered.
test('a client that says nothing is let go, and one that asked is answered however long that takes', async (t) => {
	const { endpoint } = await serve(t, {
		slow: () => new Promise((resolve) => setTimeout(() => resolve({ done: true }), 150))
	}, profile(t), { requestTimeoutMs: 40 });

	assert.deepEqual(await ask(endpoint, { action: 'slow' }), { ok: true, result: { done: true } });
	// Connected, and never sent a line: the server hangs up with no reply.
	assert.equal(await sendRaw(endpoint, ''), '');
});

// A named pipe leaves no file behind and has no mode to set, so these two are
// about the socket file only.
test('a socket file left by a run that did not end cleanly does not refuse the next one', { skip: !POSIX && 'named pipes leave no file' }, async (t) => {
	const userData = profile(t);
	fs.writeFileSync(controlEndpoint({ userData }), '');

	const { endpoint } = await serve(t, { 'sites.list': async () => ({ sites: [] }) }, userData);
	assert.equal((await ask(endpoint, { action: 'sites.list' })).ok, true);
});

test('the socket file is the user\'s alone, and is gone once the server closes', { skip: !POSIX && 'named pipes have no mode' }, async (t) => {
	const userData = profile(t);
	const endpoint = controlEndpoint({ userData });
	const server = await startControlServer({ endpoint, actions: {} });

	// The permission bits, without the file type above them.
	assert.equal(fs.statSync(endpoint).mode % 0o1000, 0o600);
	await server.close();
	assert.equal(fs.existsSync(endpoint), false);
});
