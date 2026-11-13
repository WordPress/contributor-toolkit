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

const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');

const USAGE = `Usage: toolkit <command> [site] [options]

Commands that read:
  sites                       List the sites in the WordPress Contributor Toolkit and what each one is doing
  log [site]                  Print the end of a site's WordPress debug.log
  mail [site]                 Print the mail a site sent, which the app caught

Commands that change a site (turned on in the app: Settings, Tools):
  create <name>               Create a site, and wait until it is installed and built
  ticket link <ticket> [site] Link a Trac ticket or a GitHub issue, by number or address
  ticket unlink [site]        Unlink the ticket and go back to trunk
  patch apply [site]          Apply the latest patch or pull request on the linked ticket
  pr checkout <number> [site] Check out a pull request
  pr leave [site]             Leave the pull request that is checked out
  update [site]               Update to the latest trunk, then install and build as needed
  install [site]              Run npm install
  run <script> [site]         Run one of the site's npm scripts, such as build
  server start [site]         Start the development server, and wait until it has an address
  server stop [site]          Stop the development server

  help                        Show this message

A site is named by its path, by a folder inside it, or by its name in the app.
Left out, it is the site the current folder is in.

Options:
  --json                      Print the answer as JSON
  --lines <n>                 With log: how many lines to print (100 unless given)
  --carry                     With ticket link: bring edits made on trunk into the ticket
  --project <core|gutenberg>  With create: what the site is a checkout of (core unless given)
  --folder <path>             With create: the folder to make the site in

Each command waits until what it asked for has ended, which for a create, an
update or a build is minutes. If the app is closed, the command opens it.
`;

// How long the app gets to answer. A read is one lookup; a change is a press
// of a button in the app, answered when what it started has ended, and a
// first server start can sit behind a full build. A new site is a clone, an
// install and a build.
const READ_TIMEOUT_MS = 30000;
const CHANGE_TIMEOUT_MS = 35 * 60 * 1000;
const CREATE_TIMEOUT_MS = 90 * 60 * 1000;

// What each command asks the app for. `site` is whether it is about one
// site; `operand` names the one thing it takes before the site, and what it
// is sent as; `fixed` is sent as it is; `options` are the flags it takes. A
// command of two words is keyed by both.
const COMMANDS = {
	sites: { action: 'sites.list', site: false, timeoutMs: READ_TIMEOUT_MS },
	log: { action: 'site.log', site: true, options: ['lines'], timeoutMs: READ_TIMEOUT_MS },
	mail: { action: 'site.mail', site: true, timeoutMs: READ_TIMEOUT_MS },
	create: { action: 'sites.create', site: false, operand: 'name', options: ['project', 'folder'], timeoutMs: CREATE_TIMEOUT_MS },
	'ticket link': { action: 'site.ticket.link', site: true, operand: 'ref', options: ['carry'], timeoutMs: CHANGE_TIMEOUT_MS },
	'ticket unlink': { action: 'site.ticket.unlink', site: true, timeoutMs: CHANGE_TIMEOUT_MS },
	'patch apply': { action: 'site.patch.apply-latest', site: true, timeoutMs: CHANGE_TIMEOUT_MS },
	'pr checkout': { action: 'site.pr.checkout', site: true, operand: 'number', timeoutMs: CHANGE_TIMEOUT_MS },
	'pr leave': { action: 'site.pr.leave', site: true, timeoutMs: CHANGE_TIMEOUT_MS },
	update: { action: 'site.trunk.update', site: true, timeoutMs: CHANGE_TIMEOUT_MS },
	install: { action: 'site.script.run', site: true, fixed: { script: 'install' }, timeoutMs: CHANGE_TIMEOUT_MS },
	run: { action: 'site.script.run', site: true, operand: 'script', timeoutMs: CHANGE_TIMEOUT_MS },
	'server start': { action: 'site.server.start', site: true, timeoutMs: CHANGE_TIMEOUT_MS },
	'server stop': { action: 'site.server.stop', site: true, timeoutMs: CHANGE_TIMEOUT_MS }
};

// The first words that take a second.
const GROUPS = new Set(Object.keys(COMMANDS).filter((name) => name.includes(' ')).map((name) => name.split(' ')[0]));

// The flags a command can take, and whether each takes a value.
const OPTIONS = { lines: true, carry: false, project: true, folder: true };

const EXIT = { OK: 0, FAILED: 1, USAGE: 2 };

/**
 * @param {string[]} argv The arguments after the script.
 * @return {Object} `{ command, json, operand, site, options, endpoint, shim, app }`, or `{ usageError }`.
 */
function parseArgs(argv) {
	const parsed = { command: null, json: false, operand: null, site: null, options: {}, endpoint: null, shim: null, app: null };
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i];
		if (arg === '--json') parsed.json = true;
		else if (arg === '--help' || arg === '-h') parsed.command = parsed.command || 'help';
		// The next three are written by the shim, which knows which profile's
		// app it belongs to, where it is itself, and how that app is started.
		else if (arg === '--endpoint') parsed.endpoint = argv[i += 1] || null;
		else if (arg === '--shim') parsed.shim = argv[i += 1] || null;
		else if (arg === '--app') parsed.app = argv[i += 1] || null;
		else if (arg.startsWith('--') && Object.hasOwn(OPTIONS, arg.slice(2))) {
			const name = arg.slice(2);
			if (!OPTIONS[name]) parsed.options[name] = true;
			else if (i + 1 >= argv.length) return { usageError: `${arg} takes a value` };
			else parsed.options[name] = argv[i += 1];
		} else if (arg.startsWith('-')) return { usageError: `Unknown option: ${arg}` };
		else if (!parsed.command) parsed.command = arg;
		else if (GROUPS.has(parsed.command)) parsed.command = `${parsed.command} ${arg}`;
		else if (Object.hasOwn(COMMANDS, parsed.command) && COMMANDS[parsed.command].operand && parsed.operand === null) parsed.operand = arg;
		else if (Object.hasOwn(COMMANDS, parsed.command) && COMMANDS[parsed.command].site && parsed.site === null) parsed.site = arg;
		else return { usageError: `Unexpected argument: ${arg}` };
	}
	if (!parsed.command) parsed.command = 'help';
	if (parsed.command === 'help') return parsed;
	if (!Object.hasOwn(COMMANDS, parsed.command)) return { usageError: `Unknown command: ${parsed.command}` };

	const spec = COMMANDS[parsed.command];
	if (spec.operand && parsed.operand === null) return { usageError: `${parsed.command} takes a ${spec.operand}` };
	for (const name of Object.keys(parsed.options)) {
		if (!(spec.options || []).includes(name)) return { usageError: `--${name} does not go with ${parsed.command}` };
	}
	if (parsed.options.lines !== undefined) {
		parsed.options.lines = Number(parsed.options.lines);
		if (!Number.isInteger(parsed.options.lines) || parsed.options.lines < 1) return { usageError: '--lines takes a whole number, 1 or more' };
	}
	if (spec.operand === 'number') {
		parsed.operand = Number(parsed.operand);
		if (!Number.isInteger(parsed.operand) || parsed.operand < 1) return { usageError: `${parsed.command} takes a pull request's number` };
	}
	return parsed;
}

/**
 * What a parsed command sends: the action and its parameters.
 *
 * @param {Object} args From `parseArgs`.
 * @param {string} cwd  The folder the command was run in.
 * @return {{action: string, params?: Object}}
 */
function requestFor(args, cwd) {
	const spec = COMMANDS[args.command];
	const params = { ...(spec.fixed || {}) };
	if (spec.operand) params[spec.operand] = args.operand;
	if (spec.site) {
		// A command about one site, run with none named, is about the site the
		// tool is standing in; the app decides whether that folder is one. `.`
		// and `./src` are folders too, and only this process knows what they
		// are relative to.
		params.site = args.site && args.site.startsWith('.') ? path.resolve(cwd, args.site) : (args.site || cwd);
	}
	for (const [name, value] of Object.entries(args.options)) {
		// A folder is sent whole, for the same reason.
		params[name] = name === 'folder' ? path.resolve(cwd, value) : value;
	}
	return Object.keys(params).length ? { action: spec.action, params } : { action: spec.action };
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
function ask(endpoint, request, { timeoutMs = READ_TIMEOUT_MS } = {}) {
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

// A line under an answer for what went less than well without failing.
const warned = (result, text) => (result.warning ? `${text}${result.warning}\n` : text);

const FORMATTERS = {
	sites: (result) => formatSites(result.sites),
	log: formatLog,
	mail: formatMail,
	create: (result) => `Created ${result.name} at ${result.site}. It is installed and built.\n`,
	'ticket link': (result) => warned(result, `Linked #${result.ticket}, on branch ${result.branch}.\n`),
	'ticket unlink': (result) => warned(result, 'No ticket is linked. The site is on trunk.\n'),
	'patch apply': (result) => warned(result, result.appliedPatch ? `Applied ${result.appliedPatch}.\n` : `Checked out pull request #${result.pullRequest}.\n`),
	'pr checkout': (result) => warned(result, result.checkedOut ? `Checked out pull request #${result.pullRequest}.\n` : `Pull request #${result.pullRequest} was already checked out.\n`),
	'pr leave': (result) => warned(result, result.left ? 'Left the pull request.\n' : 'No pull request was checked out.\n'),
	update: (result) => (result.updated ? 'Updated to the latest trunk.\n' : 'Already up to date with trunk.\n'),
	install: (result) => `${result.output}${result.output.endsWith('\n') || !result.output ? '' : '\n'}${result.command} finished.\n`,
	run: (result) => `${result.output}${result.output.endsWith('\n') || !result.output ? '' : '\n'}${result.command} finished.\n`,
	'server start': (result) => `${result.started ? 'The server is running at' : 'The server was already running at'} ${result.url}\n`,
	'server stop': (result) => (result.stopped ? 'The server is stopped.\n' : 'The server was not running.\n')
};

// How long an app that was just started gets to begin answering.
const START_TIMEOUT_MS = 60000;
const START_POLL_MS = 500;

/**
 * Where the app listens now, read off the shim: on Windows the address is
 * new at every start of the app, and the app rewrites the shim with it.
 *
 * @param {string} shimText
 * @return {?string}
 */
function endpointInShim(shimText) {
	const match = /"--endpoint" "([^"]+)"/.exec(String(shimText));
	return match ? match[1] : null;
}

/**
 * Sends a request, and opens the app first if it is closed.
 *
 * Only an installed app is opened: the shim names one to open only then, so
 * a command run against `npm start` or a test's throwaway profile never
 * starts some other copy of the app.
 *
 * @param {Object}   args         From `parseArgs`.
 * @param {Object}   request
 * @param {Object}   io
 * @param {Function} io.send
 * @param {Function} io.err
 * @param {number}   io.timeoutMs
 * @param {Function} io.launch
 * @param {Function} io.readFile
 * @param {Function} io.sleep
 * @param {Function} io.now
 * @return {Promise<Object>} The reply.
 */
async function askOpeningTheApp(args, request, { send, err, timeoutMs, launch, readFile, sleep, now }) {
	const first = await send(args.endpoint, request, { timeoutMs });
	if (first.ok || first.code !== 'not-running' || !args.app) return first;

	err('Opening the WordPress Contributor Toolkit…\n');
	launch(args.app);
	const deadline = now() + START_TIMEOUT_MS;
	while (now() < deadline) {
		await sleep(START_POLL_MS);
		let endpoint = args.endpoint;
		try {
			endpoint = (args.shim && endpointInShim(readFile(args.shim))) || endpoint;
		} catch {
			// The shim is being rewritten this moment; the next turn reads it.
		}
		const reply = await send(endpoint, request, { timeoutMs });
		if (reply.ok || reply.code !== 'not-running') return reply;
	}
	return { ok: false, code: 'not-running', error: 'The WordPress Contributor Toolkit was opened but did not start answering. Check that it is running, then try again.' };
}

// Starts the app and lets go of it: it outlives this command. The variable
// that makes this process Node would make the app Node too.
function launchApp(app) {
	const env = { ...process.env };
	delete env.ELECTRON_RUN_AS_NODE;
	const child = spawn(app, [], { detached: true, stdio: 'ignore', env });
	child.on('error', () => {});
	child.unref();
}

/**
 * @param {string[]} argv
 * @param {Object}   [io]
 * @param {Function} [io.out]      Writes to stdout.
 * @param {Function} [io.err]      Writes to stderr.
 * @param {Function} [io.send]     `ask`, replaced in tests.
 * @param {string}   [io.cwd]      The folder the command was run in.
 * @param {Function} [io.launch]   Starts the app; replaced in tests.
 * @param {Function} [io.readFile] Reads the shim; replaced in tests.
 * @param {Function} [io.sleep]
 * @param {Function} [io.now]
 * @return {Promise<number>} The exit code.
 */
async function run(argv, {
	out = (s) => process.stdout.write(s),
	err = (s) => process.stderr.write(s),
	send = ask,
	cwd = process.cwd(),
	launch = launchApp,
	readFile = (file) => fs.readFileSync(file, 'utf8'),
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now = Date.now
} = {}) {
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

	const { timeoutMs } = COMMANDS[args.command];
	const reply = await askOpeningTheApp(args, requestFor(args, cwd), { send, err, timeoutMs, launch, readFile, sleep, now });
	if (args.json) {
		// The whole answer, failure included, on stdout: a tool that asked
		// for JSON reads one stream.
		out(`${JSON.stringify(reply.ok ? { ok: true, ...reply.result } : reply, null, 2)}\n`);
		return reply.ok ? EXIT.OK : EXIT.FAILED;
	}
	if (!reply.ok) {
		// A command that failed says why in its output, above the sentence.
		if (typeof reply.output === 'string' && reply.output) err(`${reply.output}${reply.output.endsWith('\n') ? '' : '\n'}`);
		err(`${reply.error}\n`);
		return EXIT.FAILED;
	}
	out(FORMATTERS[args.command](reply.result));
	return EXIT.OK;
}

if (require.main === module) {
	run(process.argv.slice(2)).then((code) => { process.exitCode = code; });
}

module.exports = { COMMANDS, parseArgs, requestFor, ask, endpointInShim, formatSites, formatLog, formatMail, run, EXIT, USAGE };
