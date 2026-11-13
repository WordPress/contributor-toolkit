'use strict';

// The door a tool outside the window asks the app through (#764).
//
// A local socket: a Unix domain socket in the app's own profile directory on
// macOS and Linux, a named pipe on Windows. Not a TCP port, on purpose. A port
// on loopback is reachable from any page the contributor has open, which is
// the same exposure `wpct://` has and the reason deep-link.cjs keeps that
// scheme to one verb. A socket file and a named pipe can only be opened by a
// process running as the same user, which can already read the settings file
// beside them.
//
// One request per connection: a line of JSON in, a line of JSON out, and the
// connection ends. The actions are handed in by main.js, so this module has no
// Electron import and both sides of every refusal are testable with a real
// socket in a temporary directory.

const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const path = require('path');

// A request is an action name and a few short parameters. Anything longer is
// not a request this app answers, and is not kept in memory to find out.
const MAX_REQUEST_BYTES = 64 * 1024;

// How long a client that connected has to say what it wants.
const REQUEST_TIMEOUT_MS = 5000;

// Every `code` a refusal can carry, for the CLI and for tests.
const REFUSAL_CODES = {
	INVALID_REQUEST: 'invalid-request',
	TOO_LARGE: 'request-too-large',
	UNKNOWN_ACTION: 'unknown-action',
	FAILED: 'failed'
};

/**
 * Where the app listens. The shim the app writes hands this address to the
 * command, which has no other way to find it.
 *
 * On macOS and Linux it is a file in the profile directory, which is the
 * user's own, so nobody else can put a socket there first.
 *
 * A named pipe has no directory. Its name is in a namespace every account on
 * the machine shares, so a name that could be worked out from the profile
 * path could be taken by another account before the app starts, and the
 * command would then be answered by that account. The name is random at every
 * start instead, and is only written where the shim is, in the profile.
 *
 * @param {Object} root0
 * @param {string} root0.userData   What `app.getPath('userData')` answered.
 * @param {string} [root0.platform] `process.platform`.
 * @param {string} [root0.nonce]    The random part of a pipe's name; a new one unless given.
 * @return {string} A socket path, or a pipe name on Windows.
 */
function controlEndpoint({ userData, platform = process.platform, nonce = crypto.randomBytes(16).toString('hex') }) {
	if (platform === 'win32') return `\\\\.\\pipe\\wpct-control-${nonce}`;
	// path.posix, like nodeExecPath in node-shims.cjs: the platform is
	// injected, so the suite runs this branch on Windows too.
	return path.posix.join(userData, 'control.sock');
}

/**
 * The file the `toolkit` command is written to, inside the profile directory.
 *
 * @param {Object} root0
 * @param {string} root0.userData
 * @param {string} [root0.platform]
 * @return {string}
 */
function cliShimPath({ userData, platform = process.platform }) {
	const join = platform === 'win32' ? path.win32.join : path.posix.join;
	return join(userData, 'bin', platform === 'win32' ? 'toolkit.cmd' : 'toolkit');
}

function refusal(code, error) {
	return { ok: false, code, error };
}

/**
 * Answers one request line. Never throws: whatever goes wrong is the reply.
 *
 * @param {string}                                      line    The request, without its newline.
 * @param {Object<string, (params: Object) => Promise>} actions The actions main.js offers, by name.
 * @return {Promise<{ok: true, result: *}|{ok: false, code: string, error: string}>}
 */
async function answerRequest(line, actions) {
	let request;
	try {
		request = JSON.parse(line);
	} catch {
		return refusal(REFUSAL_CODES.INVALID_REQUEST, 'The request is not JSON.');
	}
	if (typeof request !== 'object' || request === null || Array.isArray(request) || typeof request.action !== 'string') {
		return refusal(REFUSAL_CODES.INVALID_REQUEST, 'The request names no action.');
	}
	// Own properties only: `constructor` and `toString` are not actions.
	if (!Object.hasOwn(actions, request.action)) {
		return refusal(REFUSAL_CODES.UNKNOWN_ACTION, `Unknown action: ${request.action.slice(0, 80)}`);
	}
	const { params } = request;
	if (params !== undefined && (typeof params !== 'object' || params === null || Array.isArray(params))) {
		return refusal(REFUSAL_CODES.INVALID_REQUEST, 'The parameters are not an object.');
	}
	try {
		return { ok: true, result: await actions[request.action](params || {}) };
	} catch (e) {
		return refusal(REFUSAL_CODES.FAILED, String(e && e.message ? e.message : e));
	}
}

function serveConnection(socket, actions) {
	let buffered = '';
	let answered = false;

	const reply = (payload) => {
		answered = true;
		clearTimeout(timer);
		socket.end(`${JSON.stringify(payload)}\n`);
	};
	// A client that connects and says nothing is let go, not kept.
	const timer = setTimeout(() => socket.destroy(), REQUEST_TIMEOUT_MS);

	socket.setEncoding('utf8');
	// A client that went away mid-reply has nobody left to tell.
	socket.on('error', () => clearTimeout(timer));
	socket.on('close', () => clearTimeout(timer));
	socket.on('data', (chunk) => {
		// One request per connection: what follows the first line is not read.
		if (answered) return;
		buffered += chunk;
		const end = buffered.indexOf('\n');
		if (end === -1) {
			if (Buffer.byteLength(buffered) > MAX_REQUEST_BYTES) {
				reply(refusal(REFUSAL_CODES.TOO_LARGE, 'The request is too large.'));
			}
			return;
		}
		answered = true;
		answerRequest(buffered.slice(0, end), actions).then(reply);
	});
}

/**
 * Starts listening at `endpoint`.
 *
 * On macOS and Linux a socket file left by a run that did not end cleanly
 * would refuse the listen, so it is removed first. That is only safe for a
 * caller that knows no other copy of the app is serving it: main.js calls this
 * after it has taken the single-instance lock, which is keyed on the same
 * profile directory the socket is in.
 *
 * @param {Object}                   root0
 * @param {string}                   root0.endpoint   From `controlEndpoint`.
 * @param {Object<string, Function>} root0.actions    The actions offered, by name.
 * @param {string}                   [root0.platform]
 * @param {(error: Error) => void}   [root0.onError]  A failure after the listen began.
 * @return {Promise<{close: () => Promise<void>}>} Rejects when the listen fails.
 */
async function startControlServer({ endpoint, actions, platform = process.platform, onError = () => {} }) {
	const posix = platform !== 'win32';
	if (posix) await fs.promises.rm(endpoint, { force: true });

	const server = net.createServer((socket) => serveConnection(socket, actions));
	await new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(endpoint, () => {
			server.off('error', reject);
			server.on('error', onError);
			resolve();
		});
	});
	// The profile directory is the user's own already; this says it of the
	// socket itself, wherever the directory's mode was left.
	if (posix) await fs.promises.chmod(endpoint, 0o600);

	return {
		// Closing a server removes its socket file.
		close: () => new Promise((resolve) => server.close(() => resolve()))
	};
}

module.exports = {
	MAX_REQUEST_BYTES,
	REFUSAL_CODES,
	controlEndpoint,
	cliShimPath,
	answerRequest,
	startControlServer
};
