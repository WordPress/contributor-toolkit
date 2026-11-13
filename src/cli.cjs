'use strict';

// The `toolkit` command (#764): how a script, a facilitator or an AI tool with
// a terminal asks the running app a question.
//
// It is a thin front for the control channel in control-channel.cjs and holds
// no logic of the app's own: it sends one request to the app that is already
// open and prints the answer. It runs on Electron's Node through the shim the
// app writes at startup, the same way the app's `npm` does, so it needs no
// Node on the machine. Only Node built-ins are required here, and nothing from
// Electron.
//
// The strings are English and are not translated: the output is read by tools
// first, and `--json` is the form they should ask for.

const net = require('net');

const USAGE = `Usage: toolkit <command> [--json]

Commands:
  sites    List the sites in the WordPress Contributor Toolkit and what each one is doing
  help     Show this message

Options:
  --json   Print the answer as JSON

The WordPress Contributor Toolkit has to be open: this command asks the running app.
`;

// What each command asks the app for.
const COMMANDS = {
	sites: 'sites.list'
};

const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };

// How long the app gets to answer. A listing reads one branch name per site.
const ANSWER_TIMEOUT_MS = 30000;

/**
 * @param {string[]} argv The arguments after the script.
 * @return {{command: string, json: boolean, endpoint: string|null}|{usageError: string}}
 */
function parseArgs(argv) {
	let command = null;
	let json = false;
	let endpoint = null;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--json') json = true;
		else if (arg === '--help' || arg === '-h') command = command || 'help';
		// Written by the shim, which knows which profile's app it belongs to.
		else if (arg === '--endpoint') endpoint = argv[i += 1] || null;
		else if (arg.startsWith('-')) return { usageError: `Unknown option: ${arg}` };
		else if (command) return { usageError: `Unexpected argument: ${arg}` };
		else command = arg;
	}
	if (!command) command = 'help';
	if (command !== 'help' && !Object.hasOwn(COMMANDS, command)) return { usageError: `Unknown command: ${command}` };
	return { command, json, endpoint };
}

/**
 * Sends one request and resolves with the app's reply. Never rejects: an app
 * that is not there is a reply too, with a code of its own.
 *
 * @param {string} endpoint
 * @param {Object} request
 * @param {Object} [options]
 * @param {number} [options.timeoutMs]
 * @return {Promise<Object>} The reply, `{ok: true, result}` or `{ok: false, code, error}`.
 */
function ask(endpoint, request, { timeoutMs = ANSWER_TIMEOUT_MS } = {}) {
	return new Promise((resolve) => {
		let received = '';
		let settled = false;
		const settle = (reply) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			socket.destroy();
			resolve(reply);
		};
		const socket = net.createConnection(endpoint);
		const timer = setTimeout(() => settle({ ok: false, code: 'timeout', error: 'The WordPress Contributor Toolkit did not answer in time.' }), timeoutMs);
		socket.setEncoding('utf8');
		socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
		socket.on('data', (chunk) => { received += chunk; });
		socket.on('error', (e) => {
			// No socket file, or one nobody is listening on: the app is closed.
			if (e.code === 'ENOENT' || e.code === 'ECONNREFUSED') {
				settle({ ok: false, code: 'not-running', error: 'The WordPress Contributor Toolkit is not running. Open it and try again.' });
			} else {
				settle({ ok: false, code: 'connection-failed', error: `Could not reach the WordPress Contributor Toolkit: ${e.message}` });
			}
		});
		socket.on('end', () => {
			try {
				settle(JSON.parse(received));
			} catch {
				settle({ ok: false, code: 'invalid-reply', error: 'The WordPress Contributor Toolkit sent an answer this command could not read.' });
			}
		});
	});
}

const PROJECT_NAMES = { core: 'WordPress Core', gutenberg: 'Gutenberg' };

function describeWork(site) {
	if (site.pullRequest !== null) return `pull request #${site.pullRequest} (branch ${site.branch})`;
	if (!site.workItem) return `none (branch ${site.branch})`;
	const kind = site.workItem.provider === 'trac' ? 'Trac ticket' : 'GitHub issue';
	return `${kind} #${site.workItem.id} (branch ${site.branch})`;
}

function describeServer(site) {
	if (!site.server.running) return 'stopped';
	return site.server.url ? `running at ${site.server.url}` : 'starting';
}

/**
 * The listing as a person reads it.
 *
 * @param {Object[]} sites The `sites` of a `sites.list` answer.
 * @return {string}
 */
function formatSites(sites) {
	if (sites.length === 0) return 'No sites yet. Create one in the WordPress Contributor Toolkit.\n';
	return sites.map((site) => [
		`${site.label} (${PROJECT_NAMES[site.project] || site.project})`,
		`  Path:    ${site.path}`,
		`  Work:    ${describeWork(site)}`,
		`  Server:  ${describeServer(site)}`,
		...(site.initialized ? [] : ['  Setup:   not finished'])
	].join('\n')).join('\n\n') + '\n';
}

/**
 * @param {string[]} argv
 * @param {Object}   [io]
 * @param {Function} [io.out]  Writes to stdout.
 * @param {Function} [io.err]  Writes to stderr.
 * @param {Function} [io.send] `ask`, replaced in tests.
 * @return {Promise<number>} The exit code.
 */
async function run(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), send = ask } = {}) {
	const args = parseArgs(argv);
	if (args.usageError) {
		err(`${args.usageError}\n\n${USAGE}`);
		return EXIT.USAGE;
	}
	if (args.command === 'help') {
		out(USAGE);
		return EXIT.OK;
	}
	if (!args.endpoint) {
		err('This command has to be run through the `toolkit` file the WordPress Contributor Toolkit writes when it starts.\n');
		return EXIT.USAGE;
	}

	const reply = await send(args.endpoint, { action: COMMANDS[args.command] });
	if (args.json) {
		// The whole answer, failure included, on stdout: a tool that asked
		// for JSON reads one stream.
		out(`${JSON.stringify(reply.ok ? { ok: true, ...reply.result } : reply, null, 2)}\n`);
		return reply.ok ? EXIT.OK : EXIT.FAILED;
	}
	if (!reply.ok) {
		err(`${reply.error}\n`);
		return EXIT.FAILED;
	}
	out(formatSites(reply.result.sites));
	return EXIT.OK;
}

if (require.main === module) {
	run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { parseArgs, ask, formatSites, run, EXIT, USAGE };
