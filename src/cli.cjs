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
const path = require('path');

const USAGE = `Usage: toolkit <command> [site] [options]

Commands:
  sites          List the sites in the WordPress Contributor Toolkit and what each one is doing
  log [site]     Print the end of a site's WordPress debug.log
  mail [site]    Print the mail a site sent, which the app caught
  help           Show this message

A site is named by its path, by a folder inside it, or by its name in the app.
Left out, it is the site the current folder is in.

Options:
  --json         Print the answer as JSON
  --lines <n>    With log: how many lines to print (100 unless given)

The WordPress Contributor Toolkit has to be open: this command asks the running app.
`;

// What each command asks the app for, and whether it is about one site.
const COMMANDS = {
	sites: { action: 'sites.list', site: false },
	log: { action: 'site.log', site: true },
	mail: { action: 'site.mail', site: true }
};

const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };

// How long the app gets to answer. A listing reads one branch name per site.
const ANSWER_TIMEOUT_MS = 30000;

/**
 * @param {string[]} argv The arguments after the script.
 * @return {{command: string, json: boolean, endpoint: string|null, site: string|null, lines: number|null}|{usageError: string}}
 */
function parseArgs(argv) {
	let command = null;
	let json = false;
	let endpoint = null;
	let site = null;
	let lines = null;
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--json') json = true;
		else if (arg === '--help' || arg === '-h') command = command || 'help';
		// Written by the shim, which knows which profile's app it belongs to.
		else if (arg === '--endpoint') endpoint = argv[i += 1] || null;
		else if (arg === '--lines') {
			lines = Number(argv[i += 1]);
			if (!Number.isInteger(lines) || lines < 1) return { usageError: '--lines takes a whole number, 1 or more' };
		} else if (arg.startsWith('-')) return { usageError: `Unknown option: ${arg}` };
		else if (!command) command = arg;
		else if (site === null && Object.hasOwn(COMMANDS, command) && COMMANDS[command].site) site = arg;
		else return { usageError: `Unexpected argument: ${arg}` };
	}
	if (!command) command = 'help';
	if (command !== 'help' && !Object.hasOwn(COMMANDS, command)) return { usageError: `Unknown command: ${command}` };
	if (lines !== null && command !== 'log') return { usageError: '--lines only goes with log' };
	return { command, json, endpoint, site, lines };
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
 * The end of a debug.log as a person reads it: the lines, as they are.
 *
 * @param {Object} result A `site.log` answer.
 * @return {string}
 */
function formatLog(result) {
	if (!result.exists) return `WordPress has not written a debug.log for this site yet.\nIt would be at ${result.path}\n`;
	if (result.lines.length === 0) return `The debug.log is empty: ${result.path}\n`;
	return `${result.lines.join('\n')}\n`;
}

/**
 * The caught mail as a person reads it, newest first.
 *
 * @param {Object} result A `site.mail` answer.
 * @return {string}
 */
function formatMail(result) {
	if (result.emails.length === 0) return 'No mail from this site has been caught yet.\n';
	return result.emails.map((email) => [
		`${email.subject || '(no subject)'}`,
		`  Sent:  ${email.sentAt || 'unknown'}`,
		`  From:  ${email.from}`,
		`  To:    ${email.to}`,
		'',
		...email.text.trimEnd().split(/\r?\n/).map((line) => `  ${line}`),
		...(email.textTruncated ? ['  […]'] : [])
	].join('\n')).join('\n\n') + '\n' + (result.total > result.emails.length ? `\nThe newest ${result.emails.length} of ${result.total} mails.\n` : '');
}

const FORMATTERS = {
	sites: (result) => formatSites(result.sites),
	log: formatLog,
	mail: formatMail
};

/**
 * @param {string[]} argv
 * @param {Object}   [io]
 * @param {Function} [io.out]  Writes to stdout.
 * @param {Function} [io.err]  Writes to stderr.
 * @param {Function} [io.send] `ask`, replaced in tests.
 * @param {string}   [io.cwd]  The folder the command was run in.
 * @return {Promise<number>} The exit code.
 */
async function run(argv, { out = (s) => process.stdout.write(s), err = (s) => process.stderr.write(s), send = ask, cwd = process.cwd() } = {}) {
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

	const { action, site } = COMMANDS[args.command];
	// A command about one site, run with none named, is about the site the
	// tool is standing in. The app decides whether that folder is one.
	// `.` and `./src` are folders too, and only this process knows what they
	// are relative to.
	const named = args.site && args.site.startsWith('.') ? path.resolve(cwd, args.site) : args.site;
	const params = site ? { site: named || cwd, ...(args.lines === null ? {} : { lines: args.lines }) } : undefined;
	const reply = await send(args.endpoint, params ? { action, params } : { action });
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
	out(FORMATTERS[args.command](reply.result));
	return EXIT.OK;
}

if (require.main === module) {
	run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { parseArgs, ask, formatSites, formatLog, formatMail, run, EXIT, USAGE };
