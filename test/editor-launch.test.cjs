'use strict';

// What this suite is really testing is the reason the first attempt was removed
// (#24 → #26): detection went through the shell's PATH, which a packaged
// Electron app does not have, so an installed editor read as missing in the
// shipped build and only there. Nothing in the module may consult PATH, and the
// tests below are written so that a change reintroducing it fails here rather
// than in someone's downloaded artifact.
//
// Everything the module touches — the filesystem, the child process — is
// injected, so these run with no editor installed, no Electron, and on a
// platform other than the one under test.

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
	REFUSAL_REASONS,
	editorCandidates,
	detectEditors,
	knownEditorName,
	isLaunchableEditorPath,
	resolveLaunch,
	openSiteInEditor
} = require('../src/editor-launch.js');

// A filesystem of exactly the paths named, and a record of everything asked
// about — the record is what lets a test assert that detection looked only at
// absolute locations.
function fakeFs(entries) {
	const asked = [];
	const map = new Map(Object.entries(entries));
	return {
		asked,
		// Both probes are async, like the real ones: the module runs on the process
		// that draws the window, so it may not stat synchronously.
		async exists(p) {
			asked.push(p);
			return map.has(p);
		},
		async statPath(p) {
			asked.push(p);
			const kind = map.get(p);
			if (!kind) return null;
			// 'file' is a document — present, not executable. 'exe' is something the
			// OS will run. The distinction is what the Linux branch turns on.
			return {
				isDirectory: kind === 'dir',
				isFile: kind === 'file' || kind === 'exe',
				isExecutable: kind === 'exe' || kind === 'dir'
			};
		}
	};
}

// A stand-in for child_process.spawn that behaves like the real one in the way
// that matters here: it returns a handle first and reports success or failure
// afterwards, on an event. `outcome` says which event, and it is emitted on a
// later turn — a fake that emitted synchronously would pass whether or not the
// code under test ever attached a listener.
function recordingSpawn(outcome = { event: 'ok' }) {
	const calls = [];
	const spawn = (command, args, options) => {
		const call = { command, args, options, unrefed: false };
		calls.push(call);
		const child = new EventEmitter();
		child.unref = () => { call.unrefed = true; };
		setImmediate(() => {
			if (outcome.event === 'error') {
				child.emit('error', outcome.error || new Error('EACCES: permission denied'));
				return;
			}
			// What a working launch looks like on both shapes: the OS accepted the
			// command, and on macOS `open` then exits with a code.
			child.emit('spawn');
			child.emit('close', outcome.code ?? 0);
		});
		return child;
	};
	return { calls, spawn };
}

const MAC_ENV = { HOME: '/Users/dev' };
const WIN_ENV = {
	LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
	ProgramFiles: 'C:\\Program Files'
};

// --- detection -----------------------------------------------------------

test('detection asks the filesystem about absolute paths only — never PATH', async () => {
	const fs = fakeFs({ '/Applications/Visual Studio Code.app': 'dir' });

	const found = await detectEditors({ platform: 'darwin', env: { ...MAC_ENV, PATH: '' }, exists: fs.exists });

	assert.deepEqual(found, [
		{ id: 'vscode', name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' }
	]);
	assert.ok(fs.asked.length > 0);
	for (const p of fs.asked) {
		assert.ok(p.startsWith('/'), `detection probed a non-absolute location: ${p}`);
	}
});

// The #24 regression, stated as a test: the environment a packaged app actually
// gets has no useful PATH, and detection must not care.
test('an empty PATH does not change what is detected', async () => {
	const installed = { 'C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe': 'exe' };

	const withPath = await detectEditors({
		platform: 'win32',
		env: { ...WIN_ENV, PATH: 'C:\\Windows\\System32' },
		exists: fakeFs(installed).exists
	});
	const withoutPath = await detectEditors({
		platform: 'win32',
		env: { ...WIN_ENV },
		exists: fakeFs(installed).exists
	});

	assert.deepEqual(withPath, withoutPath);
	assert.equal(withPath.length, 1);
	assert.equal(withPath[0].id, 'vscode');
});

test('nothing installed detects nothing, and does not throw', async () => {
	const fs = fakeFs({});
	assert.deepEqual(await detectEditors({ platform: 'darwin', env: MAC_ENV, exists: fs.exists }), []);
	assert.deepEqual(await detectEditors({ platform: 'win32', env: WIN_ENV, exists: fs.exists }), []);
	assert.deepEqual(await detectEditors({ platform: 'linux', env: {}, exists: fs.exists }), []);
});

test('an unreadable location is a location we do not have, not a crash', async () => {
	const exists = (p) => {
		if (p === '/Applications/Visual Studio Code.app') throw new Error('EACCES');
		return p === '/Applications/Cursor.app';
	};

	const found = await detectEditors({ platform: 'darwin', env: MAC_ENV, exists });

	assert.deepEqual(found.map((e) => e.id), ['cursor']);
});

test('an editor found in more than one location reports the first', async () => {
	const fs = fakeFs({
		'/Applications/Cursor.app': 'dir',
		'/Users/dev/Applications/Cursor.app': 'dir'
	});

	const found = await detectEditors({ platform: 'darwin', env: MAC_ENV, exists: fs.exists });

	assert.deepEqual(found, [{ id: 'cursor', name: 'Cursor', path: '/Applications/Cursor.app' }]);
});

test('a location whose environment variable is unset is dropped, not guessed at', () => {
	const paths = editorCandidates({ platform: 'win32', env: {} }).flatMap((e) => e.paths);
	assert.deepEqual(paths, []);

	const homeless = editorCandidates({ platform: 'darwin', env: {} }).flatMap((e) => e.paths);
	assert.ok(homeless.every((p) => p.startsWith('/Applications/')));
});

test('Windows environment variables are read whatever their casing', async () => {
	const fs = fakeFs({ 'C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe': 'exe' });

	const found = await detectEditors({
		platform: 'win32',
		env: { localappdata: 'C:\\Users\\dev\\AppData\\Local' },
		exists: fs.exists
	});

	assert.deepEqual(found.map((e) => e.id), ['cursor']);
});

// --- what may be launched ------------------------------------------------

test('a relative command is not launchable — that is how PATH would come back', async () => {
	const fs = fakeFs({ code: 'file' });

	assert.equal(await isLaunchableEditorPath('code', { platform: 'linux', statPath: fs.statPath }), false);
	assert.equal(await isLaunchableEditorPath('Code.exe', { platform: 'win32', statPath: fs.statPath }), false);
});

test('the shape has to match the platform', async () => {
	const fs = fakeFs({
		'/Applications/Cursor.app': 'dir',
		'/Applications/notes.txt': 'file',
		'C:\\Program Files\\Sublime Text\\sublime_text.exe': 'exe',
		'C:\\Program Files\\Sublime Text\\readme.md': 'file'
	});

	assert.equal(await isLaunchableEditorPath('/Applications/Cursor.app', { platform: 'darwin', statPath: fs.statPath }), true);
	// A file rather than a bundle, and a bundle name is not enough on its own.
	assert.equal(await isLaunchableEditorPath('/Applications/notes.txt', { platform: 'darwin', statPath: fs.statPath }), false);
	assert.equal(await isLaunchableEditorPath('/Applications/Missing.app', { platform: 'darwin', statPath: fs.statPath }), false);

	assert.equal(await isLaunchableEditorPath('C:\\Program Files\\Sublime Text\\sublime_text.exe', { platform: 'win32', statPath: fs.statPath }), true);
	assert.equal(await isLaunchableEditorPath('C:\\Program Files\\Sublime Text\\readme.md', { platform: 'win32', statPath: fs.statPath }), false);
});

// The Linux picker cannot filter by extension — there is no extension to filter
// on — so "a regular file" is not enough: a document would be remembered as the
// contributor's editor and then fail with EACCES at the spawn.
test('on Linux a file the OS will not execute is not an application', async () => {
	const fs = fakeFs({ '/home/dev/notes.txt': 'file', '/usr/bin/code': 'exe' });

	assert.equal(await isLaunchableEditorPath('/home/dev/notes.txt', { platform: 'linux', statPath: fs.statPath }), false);
	assert.equal(await isLaunchableEditorPath('/usr/bin/code', { platform: 'linux', statPath: fs.statPath }), true);
});

// --- what the editor is called -------------------------------------------

// The button promises to name the editor. On Windows the filename does not:
// 'Code.exe' is Visual Studio Code and 'phpstorm64.exe' is PhpStorm.
test('a known application is named the way the picker named it', () => {
	assert.equal(
		knownEditorName('C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe', { platform: 'win32', env: WIN_ENV }),
		'Visual Studio Code'
	);
	assert.equal(
		knownEditorName('C:\\Users\\dev\\AppData\\Local\\Programs\\PhpStorm\\bin\\phpstorm64.exe', { platform: 'win32', env: WIN_ENV }),
		'PhpStorm'
	);
	assert.equal(knownEditorName('/Applications/Cursor.app', { platform: 'darwin', env: MAC_ENV }), 'Cursor');
});

// Windows and macOS filesystems are case-insensitive: the same application
// reached through a differently-cased path is the same application.
test('the lookup is case-insensitive where the filesystem is', () => {
	assert.equal(
		knownEditorName('c:\\users\\dev\\appdata\\local\\programs\\cursor\\cursor.exe', { platform: 'win32', env: WIN_ENV }),
		'Cursor'
	);
	assert.equal(knownEditorName('/applications/zed.app', { platform: 'darwin', env: MAC_ENV }), 'Zed');
	// Linux is not, and two paths differing in case are two different files.
	assert.equal(knownEditorName('/USR/BIN/CODE', { platform: 'linux', env: {} }), null);
});

test('an application the table does not know has no name to give', () => {
	assert.equal(knownEditorName('/Applications/Some Editor.app', { platform: 'darwin', env: MAC_ENV }), null);
	assert.equal(knownEditorName('', { platform: 'darwin', env: MAC_ENV }), null);
	assert.equal(knownEditorName(null, { platform: 'darwin', env: MAC_ENV }), null);
});

test('junk input is refused rather than thrown', async () => {
	const fs = fakeFs({});
	for (const value of [null, undefined, 42, '', {}]) {
		assert.equal(await isLaunchableEditorPath(value, { platform: 'darwin', statPath: fs.statPath }), false);
	}
	assert.equal(await isLaunchableEditorPath('/Applications/Cursor.app', { platform: 'darwin' }), false);
});

// --- the command that gets run -------------------------------------------

test('macOS opens the bundle through a fixed absolute /usr/bin/open', () => {
	const { command, args } = resolveLaunch('/Applications/Cursor.app', '/Users/dev/sites/wp', { platform: 'darwin' });

	assert.equal(command, '/usr/bin/open');
	assert.deepEqual(args, ['-a', '/Applications/Cursor.app', '/Users/dev/sites/wp']);
});

test('elsewhere the executable takes the folder as an argument', () => {
	assert.deepEqual(
		resolveLaunch('C:\\Program Files\\Sublime Text\\sublime_text.exe', 'C:\\sites\\wp', { platform: 'win32' }),
		{ command: 'C:\\Program Files\\Sublime Text\\sublime_text.exe', args: ['C:\\sites\\wp'] }
	);
	assert.deepEqual(
		resolveLaunch('/usr/bin/code', '/home/dev/wp', { platform: 'linux' }),
		{ command: '/usr/bin/code', args: ['/home/dev/wp'] }
	);
});

// --- the guard -----------------------------------------------------------

const SITE = '/Users/dev/sites/wp';
const EDITOR = '/Applications/Cursor.app';

function launchDeps(overrides = {}, outcome = { event: 'ok' }) {
	const fs = fakeFs({ [EDITOR]: 'dir' });
	const { calls, spawn } = recordingSpawn(outcome);
	const refusals = [];
	return {
		calls,
		refusals,
		options: {
			sites: [SITE],
			platform: 'darwin',
			statPath: fs.statPath,
			spawn,
			onRefused: (reason, description) => refusals.push({ reason, description }),
			...overrides
		}
	};
}

test('a registered site opens in the chosen editor', async () => {
	const { calls, refusals, options } = launchDeps();

	const result = await openSiteInEditor(SITE, EDITOR, options);

	assert.deepEqual(result, { ok: true });
	assert.deepEqual(refusals, []);
	assert.equal(calls.length, 1);
	assert.equal(calls[0].command, '/usr/bin/open');
	assert.deepEqual(calls[0].args, ['-a', EDITOR, SITE]);
});

// The same boundary `sites:delete` uses: the app's own record of what it created
// or adopted. "Open this site" must not become "open this arbitrary directory".
test('a path the registry does not hold is not opened', async () => {
	const { calls, refusals, options } = launchDeps({ sites: ['/Users/dev/sites/other'] });

	const result = await openSiteInEditor(SITE, EDITOR, options);

	assert.equal(result.ok, false);
	assert.equal(result.reason, REFUSAL_REASONS.UNREGISTERED_SITE);
	assert.deepEqual(calls, []);
	assert.equal(refusals.length, 1);
	assert.equal(refusals[0].reason, REFUSAL_REASONS.UNREGISTERED_SITE);
});

test('an editor that is gone, or was never an application, is not spawned', async () => {
	for (const editorPath of ['/Applications/Uninstalled.app', 'code', '/Users/dev/notes.txt']) {
		const { calls, refusals, options } = launchDeps();

		const result = await openSiteInEditor(SITE, editorPath, options);

		assert.equal(result.ok, false, `${editorPath} should not launch`);
		assert.equal(result.reason, REFUSAL_REASONS.UNLAUNCHABLE_EDITOR);
		assert.deepEqual(calls, []);
		assert.equal(refusals.length, 1);
	}
});

test('a refusal is logged on one bounded line', async () => {
	const { refusals, options } = launchDeps();

	await openSiteInEditor(`/tmp/${'\n'.repeat(500)}`, EDITOR, options);

	const { description } = refusals[0];
	assert.ok(!description.includes('\n'));
	assert.ok(description.length <= 121);
});

test('the child is detached, shell-free and hidden, and its handle released', async () => {
	const { calls, options } = launchDeps();

	await openSiteInEditor(SITE, EDITOR, options);

	assert.deepEqual(calls[0].options, {
		detached: true,
		stdio: 'ignore',
		shell: false,
		windowsHide: true
	});
	assert.equal(calls[0].unrefed, true);
});

test('a spawn that throws is reported, not raised at the window', async () => {
	const { options } = launchDeps({
		spawn: () => { throw new TypeError('args must be an array'); }
	});

	const result = await openSiteInEditor(SITE, EDITOR, options);

	assert.equal(result.ok, false);
	assert.equal(result.reason, 'spawn-failed');
	assert.match(result.error, /args must be an array/);
});

// The failure that actually happens. `spawn` returns a handle before the OS has
// been asked to execute anything, so a target that cannot be run reports it
// afterwards — and a caller that answered "ok" on the return value has already
// told the contributor their editor is opening.
test('a launch that fails after spawn returns is still a failure', async () => {
	const { options } = launchDeps({}, { event: 'error', error: new Error('spawn EACCES') });

	const result = await openSiteInEditor(SITE, EDITOR, options);

	assert.equal(result.ok, false);
	assert.equal(result.reason, 'spawn-failed');
	assert.match(result.error, /EACCES/);
});

// On macOS the child is `/usr/bin/open`, not the editor: it exits as soon as
// Launch Services has been asked, so its exit code is the answer.
test('macOS reports what `open` exited with', async () => {
	const failed = await openSiteInEditor(SITE, EDITOR, launchDeps({}, { event: 'ok', code: 1 }).options);
	assert.equal(failed.ok, false);
	assert.equal(failed.reason, 'spawn-failed');
	assert.match(failed.error, /exit code 1/);

	const succeeded = await openSiteInEditor(SITE, EDITOR, launchDeps({}, { event: 'ok', code: 0 }).options);
	assert.deepEqual(succeeded, { ok: true });
});

// Elsewhere the child is the editor and stays alive, so waiting for it to exit
// would mean waiting for the contributor to close it.
test('a long-lived editor answers as soon as the OS accepts it', async () => {
	const fs = fakeFs({ 'C:\\Program Files\\Sublime Text\\sublime_text.exe': 'exe' });
	// Exit code 1 as well, to pin that it is not being waited on: an editor that
	// is still open has no exit code at all, and one that eventually exits
	// non-zero must not turn a launch that worked into a failure.
	const { calls, spawn } = recordingSpawn({ event: 'ok', code: 1 });

	const result = await openSiteInEditor('C:\\sites\\wp', 'C:\\Program Files\\Sublime Text\\sublime_text.exe', {
		sites: ['C:\\sites\\wp'],
		platform: 'win32',
		statPath: fs.statPath,
		spawn
	});

	assert.deepEqual(result, { ok: true });
	assert.equal(calls[0].unrefed, true);
});
