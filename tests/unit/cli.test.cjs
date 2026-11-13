'use strict';

// The `toolkit` command (#764) without an app: what it reads off its
// arguments, what it sends, what it prints, and what it exits with. The
// socket itself is tests/unit/control-channel.integration.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { COMMANDS, parseArgs, requestFor, endpointInShim, formatSites, formatLog, formatMail, run, EXIT, USAGE } = require('../../src/cli.cjs');

const ENDPOINT = '/profile/control.sock';
const CWD = path.resolve('/sites/wp/src/wp-includes');

const SITE = {
	path: '/sites/wp',
	label: 'wp',
	project: 'core',
	workItem: { provider: 'trac', id: 62281 },
	branch: 'ticket/62281',
	pullRequest: null,
	initialized: true,
	server: { running: true, url: 'http://127.0.0.1:9400' }
};

// Runs the command with its output kept and the app replaced by `reply`, or
// by one reply after another when given a list.
async function runWith(argv, reply, extra = {}) {
	const io = { out: '', err: '', sent: [], launched: [] };
	const replies = Array.isArray(reply) ? [...reply] : null;
	const code = await run(argv, {
		out: (s) => { io.out += s; },
		err: (s) => { io.err += s; },
		send: async (endpoint, request, options) => {
			io.sent.push({ endpoint, request, timeoutMs: options.timeoutMs });
			return replies ? replies.shift() : reply;
		},
		cwd: CWD,
		launch: (app) => io.launched.push(app),
		readFile: () => '',
		sleep: async () => {},
		...extra
	});
	return { code, ...io };
}

const sent = (argv) => { const args = parseArgs(argv); return args.usageError ? args : requestFor(args, CWD); };

test('each command sends its action, with what it takes and the site it is about', () => {
	assert.deepEqual(sent(['sites']), { action: 'sites.list' });
	assert.deepEqual(sent(['log', 'My site', '--lines', '20']), { action: 'site.log', params: { site: 'My site', lines: 20 } });
	assert.deepEqual(sent(['mail']), { action: 'site.mail', params: { site: CWD } });
	assert.deepEqual(sent(['server', 'start', 'My site']), { action: 'site.server.start', params: { site: 'My site' } });
	assert.deepEqual(sent(['server', 'stop']), { action: 'site.server.stop', params: { site: CWD } });
	assert.deepEqual(sent(['run', 'build']), { action: 'site.script.run', params: { script: 'build', site: CWD } });
	assert.deepEqual(sent(['run', 'test', 'My site']), { action: 'site.script.run', params: { script: 'test', site: 'My site' } });
	assert.deepEqual(sent(['install']), { action: 'site.script.run', params: { script: 'install', site: CWD } });
	assert.deepEqual(sent(['ticket', 'link', '62281', 'My site', '--carry']), { action: 'site.ticket.link', params: { ref: '62281', site: 'My site', carry: true } });
	assert.deepEqual(sent(['ticket', 'link', 'https://core.trac.wordpress.org/ticket/62281']), { action: 'site.ticket.link', params: { ref: 'https://core.trac.wordpress.org/ticket/62281', site: CWD } });
	assert.deepEqual(sent(['ticket', 'unlink']), { action: 'site.ticket.unlink', params: { site: CWD } });
	assert.deepEqual(sent(['patch', 'apply']), { action: 'site.patch.apply-latest', params: { site: CWD } });
	assert.deepEqual(sent(['pr', 'checkout', '9000']), { action: 'site.pr.checkout', params: { number: 9000, site: CWD } });
	assert.deepEqual(sent(['pr', 'leave']), { action: 'site.pr.leave', params: { site: CWD } });
	assert.deepEqual(sent(['update']), { action: 'site.trunk.update', params: { site: CWD } });
	assert.deepEqual(sent(['create', 'Demo site', '--project', 'gutenberg']), { action: 'sites.create', params: { name: 'Demo site', project: 'gutenberg' } });
});

test('a folder written relative to where the command was run is sent whole', () => {
	// Only this process knows what `.` is relative to. A name is sent as it is.
	assert.equal(sent(['mail', '..']).params.site, path.resolve(CWD, '..'));
	assert.equal(sent(['log', './src']).params.site, path.resolve(CWD, 'src'));
	assert.equal(sent(['log', 'src']).params.site, 'src');
	assert.equal(sent(['create', 'Demo', '--folder', 'sites']).params.folder, path.resolve(CWD, 'sites'));
});

test('the options and the command can come in any order, and help needs no app', async () => {
	assert.deepEqual(sent(['--json', 'log', '--lines', '5', 'wp']), { action: 'site.log', params: { site: 'wp', lines: 5 } });
	assert.equal(parseArgs(['--json', 'sites', '--endpoint', ENDPOINT]).json, true);
	assert.equal(parseArgs(['--json', 'sites', '--endpoint', ENDPOINT]).endpoint, ENDPOINT);
	for (const argv of [[], ['-h'], ['--endpoint', ENDPOINT], ['help']]) assert.equal(parseArgs(argv).command, 'help');

	const result = await runWith([], { ok: true, result: {} });
	assert.equal(result.code, EXIT.OK);
	assert.equal(result.out, USAGE);
	assert.deepEqual(result.sent, []);
	// Every command there is, is in what help prints.
	for (const name of Object.keys(COMMANDS)) assert.ok(USAGE.includes(`\n  ${name}`), name);
});

test('what is not a command, or does not go with one, is a usage error and not a request', async () => {
	const error = (argv) => parseArgs(argv).usageError || '';
	assert.match(error(['delete']), /Unknown command: delete/);
	assert.match(error(['constructor']), /Unknown command/);
	assert.match(error(['server']), /Unknown command: server/);
	assert.match(error(['server', 'restart']), /Unknown command: server restart/);
	assert.match(error(['sites', '--force']), /Unknown option: --force/);
	assert.match(error(['sites', 'extra']), /Unexpected argument: extra/);
	assert.match(error(['log', 'one', 'two']), /Unexpected argument: two/);
	assert.match(error(['run']), /run takes a script/);
	assert.match(error(['ticket', 'link']), /ticket link takes a ref/);
	assert.match(error(['create']), /create takes a name/);
	for (const lines of ['0', '1.5', 'many']) assert.match(error(['log', '--lines', lines]), /--lines takes a whole number/, lines);
	assert.match(error(['log', '--lines']), /--lines takes a value/);
	assert.match(error(['mail', '--lines', '5']), /--lines does not go with mail/);
	assert.match(error(['sites', '--carry']), /--carry does not go with sites/);
	for (const number of ['x', '0', '1.5']) assert.match(error(['pr', 'checkout', number]), /takes a pull request's number/, number);

	const result = await runWith(['--endpoint', ENDPOINT, 'delete'], { ok: true, result: {} });
	assert.equal(result.code, EXIT.USAGE);
	assert.match(result.err, /Unknown command: delete/);
	assert.deepEqual(result.sent, []);
});

test('run without the address the shim passes, the command says how it is meant to be run', async () => {
	const result = await runWith(['sites'], { ok: true, result: {} });
	assert.equal(result.code, EXIT.USAGE);
	assert.match(result.err, /`toolkit` file/);
	assert.deepEqual(result.sent, []);
});

test('sites prints one block per site', async () => {
	const second = { ...SITE, path: '/sites/gb', label: 'Gutenberg', project: 'gutenberg', workItem: null, branch: 'trunk', initialized: false, server: { running: false, url: null } };
	const result = await runWith(['--endpoint', ENDPOINT, 'sites'], { ok: true, result: { sites: [SITE, second] } });

	assert.equal(result.code, EXIT.OK);
	assert.equal(result.sent[0].endpoint, ENDPOINT);
	assert.equal(result.out, [
		'wp (WordPress Core)',
		'  Path:    /sites/wp',
		'  Work:    Trac ticket #62281 (branch ticket/62281)',
		'  Server:  running at http://127.0.0.1:9400',
		'',
		'Gutenberg (Gutenberg)',
		'  Path:    /sites/gb',
		'  Work:    none (branch trunk)',
		'  Server:  stopped',
		'  Setup:   not finished',
		''
	].join('\n'));
	assert.equal(result.err, '');
});

test('the listing names an issue, a pull request and a server that has no address yet', () => {
	assert.match(formatSites([{ ...SITE, project: 'gutenberg', workItem: { provider: 'github-issue', id: 70123 }, branch: 'issue/70123' }]), /Work: {4}GitHub issue #70123 \(branch issue\/70123\)/);
	assert.match(formatSites([{ ...SITE, branch: 'pr/9000', pullRequest: 9000 }]), /Work: {4}pull request #9000 \(branch pr\/9000\)/);
	assert.match(formatSites([{ ...SITE, server: { running: true, url: null } }]), /Server: {2}starting/);
	assert.match(formatSites([]), /No sites yet/);
});

test('a log that is not there, or is empty, says so and says where it is', () => {
	const file = '/sites/wp/build/wp-content/debug.log';
	assert.match(formatLog({ exists: false, path: file, lines: [] }), /has not written a debug\.log.*\n.*\/sites\/wp\/build\/wp-content\/debug\.log/);
	assert.match(formatLog({ exists: true, path: file, lines: [] }), /is empty: \/sites\/wp/);
	assert.equal(formatLog({ exists: true, path: file, lines: ['one', 'two'] }), 'one\ntwo\n');
});

test('mail is printed with its text, says when a text was cut, and when there is more than was answered', () => {
	const out = formatMail({ total: 2, emails: [
		{ sentAt: '2026-11-13T09:00:00.000Z', from: 'wordpress@example.test', to: 'admin@example.test', subject: 'Password Reset', text: 'Someone asked.\nhttp://127.0.0.1:9400/wp-login.php?action=rp\n', textTruncated: false },
		{ sentAt: null, from: '', to: '', subject: '', text: 'long', textTruncated: true }
	] });
	assert.equal(out, [
		'Password Reset',
		'  Sent:  2026-11-13T09:00:00.000Z',
		'  From:  wordpress@example.test',
		'  To:    admin@example.test',
		'',
		'  Someone asked.',
		'  http://127.0.0.1:9400/wp-login.php?action=rp',
		'',
		'(no subject)',
		'  Sent:  unknown',
		'  From:  ',
		'  To:    ',
		'',
		'  long',
		'  […]',
		''
	].join('\n'));
	assert.match(formatMail({ total: 0, emails: [] }), /No mail from this site has been caught yet/);
	assert.match(formatMail({ total: 120, emails: [{ sentAt: null, from: '', to: '', subject: 'One', text: '', textTruncated: false }] }), /The newest 1 of 120 mails\./);
});

test('--json prints the answer as one JSON document on stdout, a failure included', async () => {
	const good = await runWith(['--endpoint', ENDPOINT, 'sites', '--json'], { ok: true, result: { sites: [SITE] } });
	assert.equal(good.code, EXIT.OK);
	assert.deepEqual(JSON.parse(good.out), { ok: true, sites: [SITE] });
	assert.equal(good.err, '');

	const failure = { ok: false, code: 'unknown-site', error: 'No such site.' };
	const bad = await runWith(['--endpoint', ENDPOINT, 'log', '--json'], failure);
	assert.equal(bad.code, EXIT.FAILED);
	assert.deepEqual(JSON.parse(bad.out), failure);
	assert.equal(bad.err, '');
});

test('without --json a failure is a sentence on stderr, under the output of a command that failed', async () => {
	const off = await runWith(['--endpoint', ENDPOINT, 'server', 'start'], { ok: false, code: 'tools-not-allowed', error: 'Changing a site from a tool is turned off.' });
	assert.equal(off.code, EXIT.FAILED);
	assert.equal(off.out, '');
	assert.equal(off.err, 'Changing a site from a tool is turned off.\n');

	const failed = await runWith(['--endpoint', ENDPOINT, 'run', 'build'], { ok: false, code: 'script-failed', error: 'npm run build exited with code 1.', output: 'Error: Cannot find module' });
	assert.equal(failed.err, 'Error: Cannot find module\nnpm run build exited with code 1.\n');
});

test('a change says what was done, in a sentence', async () => {
	const says = async (argv, result) => (await runWith(['--endpoint', ENDPOINT, ...argv], { ok: true, result })).out;

	assert.equal(await says(['server', 'start'], { url: 'http://127.0.0.1:9400', started: true }), 'The server is running at http://127.0.0.1:9400\n');
	assert.equal(await says(['server', 'start'], { url: 'http://127.0.0.1:9400', started: false }), 'The server was already running at http://127.0.0.1:9400\n');
	assert.equal(await says(['server', 'stop'], { stopped: true }), 'The server is stopped.\n');
	assert.equal(await says(['server', 'stop'], { stopped: false }), 'The server was not running.\n');
	assert.equal(await says(['ticket', 'link', '62281'], { ticket: 62281, branch: 'ticket/62281' }), 'Linked #62281, on branch ticket/62281.\n');
	assert.equal(await says(['ticket', 'unlink'], { ticket: null }), 'No ticket is linked. The site is on trunk.\n');
	assert.equal(await says(['pr', 'checkout', '9000'], { pullRequest: 9000, checkedOut: true }), 'Checked out pull request #9000.\n');
	assert.equal(await says(['pr', 'checkout', '9000'], { pullRequest: 9000, checkedOut: false }), 'Pull request #9000 was already checked out.\n');
	assert.equal(await says(['pr', 'leave'], { left: true }), 'Left the pull request.\n');
	assert.equal(await says(['patch', 'apply'], { appliedPatch: '62281.2.diff' }), 'Applied 62281.2.diff.\n');
	assert.equal(await says(['patch', 'apply'], { pullRequest: 9000, checkedOut: true }), 'Checked out pull request #9000.\n');
	assert.equal(await says(['update'], { updated: true }), 'Updated to the latest trunk.\n');
	assert.equal(await says(['update'], { updated: false }), 'Already up to date with trunk.\n');
	assert.equal(await says(['run', 'build'], { command: 'npm run build', code: 0, output: 'Done.' }), 'Done.\nnpm run build finished.\n');
	assert.equal(await says(['create', 'Demo'], { site: '/sites/demo', name: 'Demo', project: 'core' }), 'Created Demo at /sites/demo. It is installed and built.\n');
	// What went less than well without failing is said under the answer.
	assert.equal(await says(['pr', 'checkout', '9000'], { pullRequest: 9000, checkedOut: true, warning: 'The change was made, but the build failed after it.' }), 'Checked out pull request #9000.\nThe change was made, but the build failed after it.\n');
});

test('a change is given far longer to answer than a read, and a new site longer still', async () => {
	const waits = async (argv) => (await runWith(['--endpoint', ENDPOINT, ...argv], { ok: false, code: 'x', error: 'x' })).sent[0].timeoutMs;
	const read = await waits(['sites']);
	const change = await waits(['server', 'start']);
	const create = await waits(['create', 'Demo']);
	assert.ok(change > read * 10);
	assert.ok(create > change);
});

test('with the app closed, an installed app is opened and asked again where it then listens', async () => {
	const notRunning = { ok: false, code: 'not-running', error: 'The WordPress Contributor Toolkit is not running. Open it and try again.' };
	const installed = ['--endpoint', '\\\\.\\pipe\\wpct-control-old', '--shim', 'C:\\profile\\bin\\toolkit.cmd', '--app', 'C:\\Program Files\\Toolkit\\Toolkit.exe'];

	// The address is new at every start on Windows: it is read again off the
	// shim the app rewrites.
	const opened = await runWith([...installed, 'sites'], [notRunning, notRunning, { ok: true, result: { sites: [] } }], {
		readFile: () => '"C:\\app\\cli.cjs" "--endpoint" "\\\\.\\pipe\\wpct-control-new" "--shim" "C:\\profile\\bin\\toolkit.cmd" %*'
	});
	assert.equal(opened.code, EXIT.OK);
	assert.deepEqual(opened.launched, ['C:\\Program Files\\Toolkit\\Toolkit.exe']);
	assert.deepEqual(opened.sent.map((s) => s.endpoint), ['\\\\.\\pipe\\wpct-control-old', '\\\\.\\pipe\\wpct-control-new', '\\\\.\\pipe\\wpct-control-new']);
	assert.match(opened.err, /Opening the WordPress Contributor Toolkit/);

	// From source, or under a test's profile, the shim names no app: the
	// command says the app is closed and starts nothing.
	const source = await runWith(['--endpoint', ENDPOINT, 'sites'], notRunning);
	assert.equal(source.code, EXIT.FAILED);
	assert.deepEqual(source.launched, []);
	assert.equal(source.sent.length, 1);

	// Any other failure is not a closed app, and opens nothing.
	const refused = await runWith([...installed, 'log'], { ok: false, code: 'unknown-site', error: 'No such site.' });
	assert.deepEqual(refused.launched, []);

	// An app that never starts answering is given up on.
	let clock = 0;
	const never = await runWith([...installed, 'sites'], notRunning, { now: () => { clock += 20000; return clock; } });
	assert.equal(never.code, EXIT.FAILED);
	assert.equal(never.launched.length, 1);
	assert.match(never.err, /did not start answering/);
});

test('the address is read off a shim of either platform, and not off one without it', () => {
	assert.equal(endpointInShim('ELECTRON_RUN_AS_NODE=1 "/app/Helper" "/app/cli.cjs" "--endpoint" "/Users/dev/Library/Application Support/Toolkit/control.sock" "$@"\n'), '/Users/dev/Library/Application Support/Toolkit/control.sock');
	assert.equal(endpointInShim('"C:\\app\\cli.cjs" "--endpoint" "\\\\.\\pipe\\wpct-control-abc" %*\r\n'), '\\\\.\\pipe\\wpct-control-abc');
	// And off the shims the app itself writes, with what an installed app adds.
	const { cliShim } = require('../../src/node-shims.cjs');
	for (const [platform, endpoint] of [['darwin', '/Users/dev/Library/Application Support/Toolkit/control.sock'], ['win32', '\\\\.\\pipe\\wpct-control-abc']]) {
		const shim = cliShim({ execPath: '/app/Helper', compatPath: null, cliPath: '/app/cli.cjs', cliArgs: ['--endpoint', endpoint, '--shim', '/profile/bin/toolkit', '--app', '/app/Toolkit'], platform });
		assert.equal(endpointInShim(shim), endpoint, platform);
	}
	assert.equal(endpointInShim(''), null);
	assert.equal(endpointInShim(undefined), null);
});
