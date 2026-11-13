'use strict';

// The `toolkit` command (#764) without an app: what it reads off its
// arguments, what it prints, and what it exits with. The socket itself is
// tests/unit/control-channel.integration.test.cjs.

const test = require('node:test');
const assert = require('node:assert/strict');

const { parseArgs, formatSites, formatLog, formatMail, run, EXIT, USAGE } = require('../../src/cli.cjs');

const ENDPOINT = '/profile/control.sock';

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

// Runs the command with its output kept and the app replaced by `reply`.
async function runWith(argv, reply) {
	const io = { out: '', err: '', sent: [] };
	const code = await run(argv, {
		out: (s) => { io.out += s; },
		err: (s) => { io.err += s; },
		send: async (endpoint, request) => { io.sent.push({ endpoint, request }); return reply; },
		cwd: '/sites/wp/src/wp-includes'
	});
	return { code, ...io };
}

test('the arguments name one command, in any order with its options', () => {
	assert.deepEqual(parseArgs(['sites']), { command: 'sites', json: false, endpoint: null, site: null, lines: null });
	assert.deepEqual(parseArgs(['--endpoint', ENDPOINT, 'sites', '--json']), { command: 'sites', json: true, endpoint: ENDPOINT, site: null, lines: null });
	assert.deepEqual(parseArgs(['--json', 'sites', '--endpoint', ENDPOINT]), { command: 'sites', json: true, endpoint: ENDPOINT, site: null, lines: null });
	// A site's name can have a space in it; it is one argument.
	assert.deepEqual(parseArgs(['log', 'My site', '--lines', '20']), { command: 'log', json: false, endpoint: null, site: 'My site', lines: 20 });
	assert.deepEqual(parseArgs(['mail']), { command: 'mail', json: false, endpoint: null, site: null, lines: null });
	assert.equal(parseArgs([]).command, 'help');
	assert.equal(parseArgs(['--endpoint', ENDPOINT]).command, 'help');
	assert.equal(parseArgs(['sites', '--help']).command, 'sites');
	assert.equal(parseArgs(['-h']).command, 'help');
});

test('what is not a command or an option is a usage error, not a request', async () => {
	assert.match(parseArgs(['delete']).usageError, /Unknown command: delete/);
	assert.match(parseArgs(['constructor']).usageError, /Unknown command/);
	assert.match(parseArgs(['sites', '--force']).usageError, /Unknown option: --force/);
	assert.match(parseArgs(['sites', 'extra']).usageError, /Unexpected argument: extra/);
	assert.match(parseArgs(['log', 'one', 'two']).usageError, /Unexpected argument: two/);
	for (const lines of ['0', '-3', '1.5', 'many']) {
		assert.match(parseArgs(['log', '--lines', lines]).usageError || '', /--lines|Unknown option/, lines);
	}
	assert.match(parseArgs(['log', '--lines']).usageError, /--lines takes a whole number/);
	assert.match(parseArgs(['mail', '--lines', '5']).usageError, /--lines only goes with log/);

	const result = await runWith(['--endpoint', ENDPOINT, 'delete'], { ok: true, result: {} });
	assert.equal(result.code, EXIT.USAGE);
	assert.match(result.err, /Unknown command: delete/);
	assert.deepEqual(result.sent, []);
});

test('help is printed without asking the app', async () => {
	const result = await runWith([], { ok: true, result: {} });
	assert.equal(result.code, EXIT.OK);
	assert.equal(result.out, USAGE);
	assert.deepEqual(result.sent, []);
});

test('run without the address the shim passes, the command says how it is meant to be run', async () => {
	const result = await runWith(['sites'], { ok: true, result: {} });
	assert.equal(result.code, EXIT.USAGE);
	assert.match(result.err, /`toolkit` file/);
	assert.deepEqual(result.sent, []);
});

test('sites asks the app for its list and prints one block per site', async () => {
	const second = { ...SITE, path: '/sites/gb', label: 'Gutenberg', project: 'gutenberg', workItem: null, branch: 'trunk', initialized: false, server: { running: false, url: null } };
	const result = await runWith(['--endpoint', ENDPOINT, 'sites'], { ok: true, result: { sites: [SITE, second] } });

	assert.equal(result.code, EXIT.OK);
	assert.deepEqual(result.sent, [{ endpoint: ENDPOINT, request: { action: 'sites.list' } }]);
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

test('--json prints the answer as one JSON document on stdout', async () => {
	const result = await runWith(['--endpoint', ENDPOINT, 'sites', '--json'], { ok: true, result: { sites: [SITE] } });

	assert.equal(result.code, EXIT.OK);
	assert.deepEqual(JSON.parse(result.out), { ok: true, sites: [SITE] });
	assert.equal(result.err, '');
});

test('a failure exits non-zero: on stderr as a sentence, and with --json on stdout with its code', async () => {
	const failure = { ok: false, code: 'not-running', error: 'The WordPress Contributor Toolkit is not running. Open it and try again.' };

	const text = await runWith(['--endpoint', ENDPOINT, 'sites'], failure);
	assert.equal(text.code, EXIT.FAILED);
	assert.equal(text.out, '');
	assert.equal(text.err, `${failure.error}\n`);

	const json = await runWith(['--endpoint', ENDPOINT, 'sites', '--json'], failure);
	assert.equal(json.code, EXIT.FAILED);
	assert.deepEqual(JSON.parse(json.out), failure);
	assert.equal(json.err, '');
});

test('log and mail ask about the site named, and with none named about the folder the command was run in', async () => {
	const log = { ok: true, result: { site: '/sites/wp', path: '/sites/wp/build/wp-content/debug.log', exists: true, lines: ['[13-Nov-2026 09:00:00 UTC] PHP Notice:  one', '[13-Nov-2026 09:00:01 UTC] PHP Warning:  two'] } };

	const named = await runWith(['--endpoint', ENDPOINT, 'log', 'My site', '--lines', '2'], log);
	assert.deepEqual(named.sent, [{ endpoint: ENDPOINT, request: { action: 'site.log', params: { site: 'My site', lines: 2 } } }]);
	assert.equal(named.out, '[13-Nov-2026 09:00:00 UTC] PHP Notice:  one\n[13-Nov-2026 09:00:01 UTC] PHP Warning:  two\n');

	// The folder is sent as it is. Whether it is in a site is the app's to say.
	const here = await runWith(['--endpoint', ENDPOINT, 'mail'], { ok: true, result: { site: '/sites/wp', emails: [] } });
	assert.deepEqual(here.sent, [{ endpoint: ENDPOINT, request: { action: 'site.mail', params: { site: '/sites/wp/src/wp-includes' } } }]);
	assert.match(here.out, /No mail from this site has been caught yet/);

	const refused = await runWith(['--endpoint', ENDPOINT, 'log', '--json'], { ok: false, code: 'unknown-site', error: 'No such site.' });
	assert.equal(refused.code, EXIT.FAILED);
	assert.deepEqual(JSON.parse(refused.out), { ok: false, code: 'unknown-site', error: 'No such site.' });
});

test('a log that is not there, or is empty, says so and says where it is', () => {
	const path = '/sites/wp/build/wp-content/debug.log';
	assert.match(formatLog({ exists: false, path, lines: [] }), /has not written a debug\.log.*\n.*\/sites\/wp\/build\/wp-content\/debug\.log/);
	assert.match(formatLog({ exists: true, path, lines: [] }), /is empty: \/sites\/wp/);
});

test('mail is printed newest first as it was answered, with its text, and says when the text was cut', () => {
	const out = formatMail({ emails: [
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
});
