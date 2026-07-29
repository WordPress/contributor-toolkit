// The app's on-disk log. This is the only module that touches electron-log, so
// the rest of the codebase depends on these four functions rather than on the
// library.
//
// Why a file at all: in a packaged GUI build the main process has no terminal,
// so every console.* call and every byte of child-process stdout/stderr goes
// nowhere. Child output is forwarded to the renderer over IPC, which means a
// spawn that fails before producing output — or a renderer that never renders
// what it received — leaves no trace whatsoever. "Nothing happened" and "the
// spawn failed with EPERM" then look identical, and there is nothing to attach
// to a bug report.

const path = require('path');
const { app } = require('electron');
const log = require('electron-log/main');
const { createLineBuffer } = require('./log-lines');

// Friendly platform names rather than process.platform's own values: 'win32'
// reads as 32-bit to most people, and this string ends up in front of
// contributors rather than only in code.
const PLATFORM_NAMES = {
	darwin: 'macos',
	win32: 'windows',
	linux: 'linux'
};

// Not electron-log's default of main.log. The point of this file is that people
// attach it to bug reports, at which moment it is separated from the app-named
// folder that would otherwise identify it — so the name has to stand alone in a
// list of attachments. The platform is in there because a single issue thread
// often collects logs from several contributors, and which OS a log came from is
// the first thing anyone reading it needs to know.
function logFileName(platform = process.platform) {
	return `wordpress-contributor-toolkit-${PLATFORM_NAMES[platform] || platform}.log`;
}

// Rotated to <name>.old.log past this size, so an app left running through many
// npm installs cannot grow the file without bound.
const MAX_LOG_SIZE = 5 * 1024 * 1024;

let initialized = false;

function initLogging() {
	if (initialized) return;
	initialized = true;

	// Must run before the first BrowserWindow is constructed: this preloads the
	// IPC bridge that lets renderer output reach this file. Called later it
	// silently does nothing for windows that already exist. spyRendererConsole
	// is what captures the renderer's own console.* — the blind spot behind the
	// class of bug where the main process is fine and the UI simply never shows
	// what it was sent.
	log.initialize({ spyRendererConsole: true });

	log.transports.file.resolvePathFn = () => path.join(app.getPath('logs'), logFileName());
	log.transports.file.maxSize = MAX_LOG_SIZE;

	// Redirects the existing console.* calls throughout the main process into
	// the log without editing their call sites. They keep printing to stdout in
	// development via the console transport.
	Object.assign(console, log.functions);

	// There were no uncaughtException/unhandledRejection handlers at all, so a
	// main-process crash previously produced an empty log — the exact moment the
	// log is most wanted. showDialog is off deliberately: at a Contributor Day a
	// modal error box derails the session, and the stack is in the file anyway.
	log.errorHandler.startCatching({ showDialog: false });

	writeHeader();
}

// A version/platform block at the top of each run. Nearly every bug report needs
// it and nearly no reporter thinks to include it; asking for the log file should
// be enough on its own.
function writeHeader() {
	const scoped = log.scope('app');
	scoped.info('--- session start ---');
	scoped.info(`app ${app.getVersion()} (${app.getName()})`);
	scoped.info(`electron ${process.versions.electron} · node ${process.versions.node} · chrome ${process.versions.chrome}`);
	scoped.info(`platform ${process.platform} ${process.arch} · ${process.env.NODE_ENV || 'production'}`);
	scoped.info(`log file ${getLogFilePath()}`);
}

// Absolute path to the current log file, for the Help menu entries. Resolving it
// through the transport rather than recomputing it keeps the menu honest if the
// path logic ever changes.
function getLogFilePath() {
	return log.transports.file.getFile().path;
}

// One line buffer per (scope, stream). Chunks arrive mid-line, so writing them
// raw would fragment single messages across timestamped entries.
const buffers = new Map();

function bufferFor(scope, type) {
	const key = `${scope}:${type}`;
	if (!buffers.has(key)) buffers.set(key, createLineBuffer());
	return buffers.get(key);
}

// Mirrors a chunk of child-process output into the log. Callers keep sending the
// same chunk to the renderer over IPC as before — this is an addition, never a
// replacement, so the UI is unaffected.
function logChildOutput(scope, type, chunk) {
	const scoped = log.scope(scope);
	const write = type === 'stderr' ? scoped.warn : scoped.info;
	for (const line of bufferFor(scope, type).push(chunk)) {
		write(line);
	}
}

// Call when the child closes, to emit any line it left unterminated and drop the
// buffers — scopes are keyed by site path or run id and would otherwise
// accumulate for the lifetime of the app.
function flushChildOutput(scope) {
	const scoped = log.scope(scope);
	for (const type of ['stdout', 'stderr']) {
		const key = `${scope}:${type}`;
		const buf = buffers.get(key);
		if (!buf) continue;
		for (const line of buf.flush()) {
			(type === 'stderr' ? scoped.warn : scoped.info)(line);
		}
		buffers.delete(key);
	}
}

// Structured events around a child process: the spawn itself and its exit code.
// These matter more than the output — a spawn that dies immediately (EPERM on
// Windows) produces no stdout at all, and that silence is the bug.
function logEvent(scope, message) {
	log.scope(scope).info(message);
}

function logError(scope, message) {
	log.scope(scope).error(message);
}

module.exports = {
	initLogging,
	getLogFilePath,
	logChildOutput,
	flushChildOutput,
	logEvent,
	logError
};
