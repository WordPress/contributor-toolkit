'use strict';

// The log file is what contributors attach to bug reports, and two other modules
// (src/external-url.js, src/site-registry.js) escape and truncate their untrusted
// strings specifically so those strings cannot forge a line in it. Nothing tested
// the module that actually writes the file, so nothing tested the guarantee they
// depend on: one event per line, each line carrying this app's own timestamp and
// scope. See #148.
//
// These tests assert against the bytes on disk rather than against calls into
// electron-log. The forged entry in `logEvent` was invisible at the call level —
// electron-log was asked to write one message and did exactly that; the second
// line only exists in the file.
//
// The harness replaces `require('electron')` and nothing else. electron-log is
// the real library writing to a real temporary directory, since its formatting
// is half of what is under test here.

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const LOG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'wpct-logging-test-'));

// Only the members electron-log and src/logging.js reach for. A missing one
// throws inside the library, which would read as a formatting failure.
const electronStub = {
	app: {
		getPath: () => LOG_DIR,
		getName: () => 'wordpress-contributor-toolkit',
		getVersion: () => '0.0.0-test',
		getAppPath: () => path.join(__dirname, '..', '..'),
		isPackaged: false,
		isReady: () => true,
		whenReady: () => Promise.resolve(),
		setAppLogsPath() {},
		on() {},
		once() {}
	},
	ipcMain: { on() {}, once() {}, handle() {}, removeHandler() {}, removeAllListeners() {} },
	BrowserWindow: { getAllWindows: () => [] },
	webContents: { getAllWebContents: () => [] }
};

const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
	if (request === 'electron') return electronStub;
	return originalLoad.call(this, request, ...rest);
};

const logging = require('../../src/logging.js');
const electronLog = require('electron-log/main');

// Before initLogging, which writes the session header: the console transport
// would otherwise print every test's fixtures into the suite's output. The file
// transport is the one under test.
electronLog.transports.console.level = false;
// Scope labels are padded to the widest scope electron-log has seen so far, so
// one test's long scope silently indents every later test's message and the
// assertions become order-dependent. Column alignment is the library's
// cosmetics; the guarantees under test here are unaffected by it.
electronLog.scope.labelPadding = false;

logging.initLogging();

test.after(() => {
	Module._load = originalLoad;
	fs.rmSync(LOG_DIR, { recursive: true, force: true });
});

// The file transport writes synchronously (`sync: true` is electron-log's
// default), so what a call produced is on disk by the time it returns.
function readLog() {
	return fs.readFileSync(logging.getLogFilePath(), 'utf8');
}

// The lines a single call appended. Splitting on the line terminator is the
// point: "one event per line" means every element of this array has to be a
// whole entry.
//
// electron-log terminates entries with os.EOL, so the separator is CRLF on
// Windows and LF elsewhere — and CI runs this suite on windows-latest. Splitting
// on '\n' alone would leave a '\r' on every entry and fail the whole file there
// while staying green on macOS. No raw CR can survive inside an entry, since the
// module escapes it, so accepting either terminator gives up nothing.
function linesWrittenBy(write) {
	const before = readLog().length;
	write();
	return readLog().slice(before).split(/\r?\n/).filter((line) => line !== '');
}

// electron-log's own format: '[2026-08-07 09:41:02.123] [info]  (scope) message'.
const ENTRY = /^\[\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(info|warn|error)\] +\((.+?)\) (.*)$/;

function parse(line) {
	const match = ENTRY.exec(line);
	assert.ok(match, `not a log entry: ${JSON.stringify(line)}`);
	return { level: match[1], scope: match[2], message: match[3] };
}

test('an event is one line, stamped, levelled and scoped', () => {
	const [line] = linesWrittenBy(() => logging.logEvent('npm:install', 'spawn npm-runner.js install in /tmp/site'));
	assert.deepEqual(parse(line), {
		level: 'info',
		scope: 'npm:install',
		message: 'spawn npm-runner.js install in /tmp/site'
	});
});

test('logError is written at error level', () => {
	const [line] = linesWrittenBy(() => logging.logError('smtp', 'stream error: ECONNRESET'));
	assert.equal(parse(line).level, 'error');
});

test('a newline in a message cannot forge a second entry', () => {
	// The email subject at the `smtp` scope in main.js is inbound, unescaped and
	// goes straight into a logEvent template — the shape #148 is about. Written
	// verbatim this produced two lines, the second indistinguishable from an
	// entry the app itself had written.
	const forged = '[2020-01-01 00:00:00.000] [info]  (app) never happened';
	const lines = linesWrittenBy(() => logging.logEvent('smtp', `New email: subject="hello\n${forged}"`));

	assert.equal(lines.length, 2);
	// Every line carries this run's own prefix, so the forgery is quoted rather
	// than committed: it appears as the message of a real entry, not as one.
	for (const line of lines) {
		assert.equal(parse(line).scope, 'smtp');
	}
	assert.equal(parse(lines[1]).message, forged + '"');
});

test('a stack trace stays readable, one entry per frame', () => {
	// Splitting rather than escaping '\n' is what keeps this legible: the
	// alternative renders every stack as a single line of literal \n.
	const lines = linesWrittenBy(() => logging.logError('git:update-trunk', 'Error: boom\n    at clone (/src/trunk-update.js:12:3)\n    at async run (/src/main.js:44:1)'));

	assert.equal(lines.length, 3);
	assert.deepEqual(lines.map((line) => parse(line).message), [
		'Error: boom',
		'    at clone (/src/trunk-update.js:12:3)',
		'    at async run (/src/main.js:44:1)'
	]);
});

test('a newline in the scope cannot forge an entry either', () => {
	// Scopes are built from `path.basename(sitePath)` (playgroundLogScope in
	// main.js), and a directory name can contain a newline on macOS and Linux.
	const lines = linesWrittenBy(() => logging.logEvent('playground:site\n[2020-01-01 00:00:00.000] [info]  (app) never happened', 'server ready'));

	assert.equal(lines.length, 1);
	assert.ok(lines[0].includes('playground:site\\x0a'), lines[0]);
	assert.ok(lines[0].endsWith('server ready'));
});

test('control characters are escaped, not written into the file raw', () => {
	// A lone CR, an ANSI sequence and U+2028 all start a new line in some viewer
	// or other, which is the same forgery by a different route. Escaped rather
	// than dropped, so the entry still says what the caller sent.
	const [line] = linesWrittenBy(() => logging.logEvent('npm', 'progress\r\x1b[31mred\x1b[0m\u2028tail\x00'));

	const { message } = parse(line);
	assert.equal(message, 'progress\\x0d\\x1b[31mred\\x1b[0m\\u2028tail\\x00');
	assert.doesNotMatch(message, /[\x00-\x1f\x7f-\x9f\u2028\u2029]/);
});

test('an oversized payload is truncated instead of flooding the file', () => {
	// A single minified line of child output would otherwise be written whole,
	// and the 5 MB rotation would then discard the session header and everything
	// else that made the log worth attaching.
	const [line] = linesWrittenBy(() => logging.logEvent('npm', 'x'.repeat(50_000)));

	const { message } = parse(line);
	assert.ok(message.length < 5000, `message was ${message.length} characters`);
	assert.ok(message.endsWith('…'));
	assert.ok(message.startsWith('xxxx'));
});

test('truncation happens after escaping, so escaping cannot push a line over the bound', () => {
	const [line] = linesWrittenBy(() => logging.logEvent('npm', '\x00'.repeat(50_000)));

	const { message } = parse(line);
	assert.ok(message.length < 5000, `message was ${message.length} characters`);
	assert.ok(message.startsWith('\\x00\\x00'));
});

test('a non-string payload is described on a single line', () => {
	// Nothing in the app passes one today; handed to electron-log directly, a
	// wide object is inspected across several lines, which puts unprefixed text
	// in the file. These are the shapes a stray call would realistically pass —
	// an inspect that wraps anyway (an Error, a hundred-element array) is not
	// unsafe, since every line it produces is still stamped.
	const cases = [
		Buffer.from('npm error'),
		{ code: 'EBADENGINE', required: { node: '>=20.19.0' }, current: { node: '20.9.0' } },
		['a', 'b'],
		null,
		undefined,
		42
	];

	for (const value of cases) {
		const lines = linesWrittenBy(() => logging.logEvent('probe', value));
		assert.equal(lines.length, 1, `${String(value)} produced ${lines.length} lines`);
	}
});

test('child output is one entry per line, stdout at info and stderr at warn', () => {
	const lines = linesWrittenBy(() => {
		logging.logChildOutput('npm:install', 'stdout', 'added 733 packages\nfound 0 vul');
		logging.logChildOutput('npm:install', 'stderr', 'npm warn EBADENGINE\n');
		// The partial stdout line is still held back, so it must not appear yet.
		logging.logChildOutput('npm:install', 'stdout', 'nerabilities\n');
	});

	assert.deepEqual(lines.map(parse), [
		{ level: 'info', scope: 'npm:install', message: 'added 733 packages' },
		{ level: 'warn', scope: 'npm:install', message: 'npm warn EBADENGINE' },
		{ level: 'info', scope: 'npm:install', message: 'found 0 vulnerabilities' }
	]);
});

test('child output is escaped and bounded like every other entry', () => {
	// npm and Playground both emit ANSI colour codes and carriage-return progress
	// bars, and a build can print a single minified line of any length.
	const lines = linesWrittenBy(() => {
		logging.logChildOutput('playground:site', 'stdout', `\x1b[32mok\x1b[0m ${'y'.repeat(50_000)}\n`);
	});

	assert.equal(lines.length, 1);
	const { message } = parse(lines[0]);
	assert.ok(message.startsWith('\\x1b[32mok'));
	assert.ok(message.length < 5000);
	assert.ok(message.endsWith('…'));
});

test('flush emits the unterminated last line and then forgets the scope', () => {
	// The line a server prints as it dies usually has no trailing newline and is
	// usually the one that explains the exit.
	const scope = 'playground:dying';
	const written = linesWrittenBy(() => {
		logging.logChildOutput(scope, 'stderr', 'Error: listen EPERM');
		logging.flushChildOutput(scope);
	});

	assert.deepEqual(written.map(parse), [
		{ level: 'warn', scope, message: 'Error: listen EPERM' }
	]);

	// Flushing again must not repeat it — the buffers are dropped, not reused.
	assert.deepEqual(linesWrittenBy(() => logging.flushChildOutput(scope)), []);
});

test('the log file is named for the platform it came from', () => {
	// A log detached from its app folder and attached to an issue thread has only
	// its own name to say which OS produced it.
	assert.equal(path.dirname(logging.getLogFilePath()), LOG_DIR);
	assert.match(path.basename(logging.getLogFilePath()), /^wordpress-contributor-toolkit-(macos|windows|linux)\.log$/);
});
