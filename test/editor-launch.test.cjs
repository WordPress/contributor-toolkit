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

const {
	REFUSAL_REASONS,
	editorCandidates,
	detectEditors,
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
		exists(p) {
			asked.push(p);
			return map.has(p);
		},
		statPath(p) {
			asked.push(p);
			const kind = map.get(p);
			if (!kind) return null;
			return { isDirectory: kind === 'dir', isFile: kind === 'file' };
		}
	};
}

function recordingSpawn() {
	const calls = [];
	const spawn = (command, args, options) => {
		calls.push({ command, args, options });
		return { unref() { calls[calls.length - 1].unrefed = true; } };
	};
	return { calls, spawn };
}

const MAC_ENV = { HOME: '/Users/dev' };
const WIN_ENV = {
	LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
	ProgramFiles: 'C:\\Program Files'
};

// --- detection -----------------------------------------------------------

test('detection asks the filesystem about absolute paths only — never PATH', () => {
	const fs = fakeFs({ '/Applications/Visual Studio Code.app': 'dir' });

	const found = detectEditors({ platform: 'darwin', env: { ...MAC_ENV, PATH: '' }, exists: fs.exists });

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
test('an empty PATH does not change what is detected', () => {
	const installed = { 'C:\\Users\\dev\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe': 'file' };

	const withPath = detectEditors({
		platform: 'win32',
		env: { ...WIN_ENV, PATH: 'C:\\Windows\\System32' },
		exists: fakeFs(installed).exists
	});
	const withoutPath = detectEditors({
		platform: 'win32',
		env: { ...WIN_ENV },
		exists: fakeFs(installed).exists
	});

	assert.deepEqual(withPath, withoutPath);
	assert.equal(withPath.length, 1);
	assert.equal(withPath[0].id, 'vscode');
});

test('nothing installed detects nothing, and does not throw', () => {
	const fs = fakeFs({});
	assert.deepEqual(detectEditors({ platform: 'darwin', env: MAC_ENV, exists: fs.exists }), []);
	assert.deepEqual(detectEditors({ platform: 'win32', env: WIN_ENV, exists: fs.exists }), []);
	assert.deepEqual(detectEditors({ platform: 'linux', env: {}, exists: fs.exists }), []);
});

test('an unreadable location is a location we do not have, not a crash', () => {
	const exists = (p) => {
		if (p === '/Applications/Visual Studio Code.app') throw new Error('EACCES');
		return p === '/Applications/Cursor.app';
	};

	const found = detectEditors({ platform: 'darwin', env: MAC_ENV, exists });

	assert.deepEqual(found.map((e) => e.id), ['cursor']);
});

test('an editor found in more than one location reports the first', () => {
	const fs = fakeFs({
		'/Applications/Cursor.app': 'dir',
		'/Users/dev/Applications/Cursor.app': 'dir'
	});

	const found = detectEditors({ platform: 'darwin', env: MAC_ENV, exists: fs.exists });

	assert.deepEqual(found, [{ id: 'cursor', name: 'Cursor', path: '/Applications/Cursor.app' }]);
});

test('a location whose environment variable is unset is dropped, not guessed at', () => {
	const paths = editorCandidates({ platform: 'win32', env: {} }).flatMap((e) => e.paths);
	assert.deepEqual(paths, []);

	const homeless = editorCandidates({ platform: 'darwin', env: {} }).flatMap((e) => e.paths);
	assert.ok(homeless.every((p) => p.startsWith('/Applications/')));
});

test('Windows environment variables are read whatever their casing', () => {
	const fs = fakeFs({ 'C:\\Users\\dev\\AppData\\Local\\Programs\\cursor\\Cursor.exe': 'file' });

	const found = detectEditors({
		platform: 'win32',
		env: { localappdata: 'C:\\Users\\dev\\AppData\\Local' },
		exists: fs.exists
	});

	assert.deepEqual(found.map((e) => e.id), ['cursor']);
});

// --- what may be launched ------------------------------------------------

test('a relative command is not launchable — that is how PATH would come back', () => {
	const fs = fakeFs({ code: 'file' });

	assert.equal(isLaunchableEditorPath('code', { platform: 'linux', statPath: fs.statPath }), false);
	assert.equal(isLaunchableEditorPath('Code.exe', { platform: 'win32', statPath: fs.statPath }), false);
});

test('the shape has to match the platform', () => {
	const fs = fakeFs({
		'/Applications/Cursor.app': 'dir',
		'/Applications/notes.txt': 'file',
		'C:\\Program Files\\Sublime Text\\sublime_text.exe': 'file',
		'C:\\Program Files\\Sublime Text\\readme.md': 'file'
	});

	assert.equal(isLaunchableEditorPath('/Applications/Cursor.app', { platform: 'darwin', statPath: fs.statPath }), true);
	// A file rather than a bundle, and a bundle name is not enough on its own.
	assert.equal(isLaunchableEditorPath('/Applications/notes.txt', { platform: 'darwin', statPath: fs.statPath }), false);
	assert.equal(isLaunchableEditorPath('/Applications/Missing.app', { platform: 'darwin', statPath: fs.statPath }), false);

	assert.equal(isLaunchableEditorPath('C:\\Program Files\\Sublime Text\\sublime_text.exe', { platform: 'win32', statPath: fs.statPath }), true);
	assert.equal(isLaunchableEditorPath('C:\\Program Files\\Sublime Text\\readme.md', { platform: 'win32', statPath: fs.statPath }), false);
});

test('junk input is refused rather than thrown', () => {
	const fs = fakeFs({});
	for (const value of [null, undefined, 42, '', {}]) {
		assert.equal(isLaunchableEditorPath(value, { platform: 'darwin', statPath: fs.statPath }), false);
	}
	assert.equal(isLaunchableEditorPath('/Applications/Cursor.app', { platform: 'darwin' }), false);
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

function launchDeps(overrides = {}) {
	const fs = fakeFs({ [EDITOR]: 'dir' });
	const { calls, spawn } = recordingSpawn();
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
		spawn: () => { throw new Error('ENOENT'); }
	});

	const result = await openSiteInEditor(SITE, EDITOR, options);

	assert.equal(result.ok, false);
	assert.equal(result.reason, 'spawn-failed');
	assert.match(result.error, /ENOENT/);
});
