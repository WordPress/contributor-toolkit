// Opening a site's folder in the contributor's editor.
//
// This existed once and was removed (#24 → #26) for a reason that decides the
// shape of everything below: detection ran `which`/`where`, and **a packaged
// Electron app does not inherit the shell's PATH**. A correctly installed VS
// Code reported as missing in the shipped build while working fine in
// `npm start`, which is the worst possible failure — it only appears in the
// artifact contributors actually download.
//
// So nothing here consults PATH, at either end:
//
// - Detection is a filesystem existence check against absolute, per-platform
//   install locations. No `which`, no `where`, no spawning anything to find out
//   whether something is installed.
// - Launching refuses a relative command. `spawn('code', …)` without a shell
//   would resolve through PATH — the same environment that is not there — so an
//   editor path that is not absolute is not one this module will run.
//
// The table below is a convenience, not the contract. It exists so the common
// case needs no configuration; the contributor pointing at their own
// application is the case that always works, and the caller must always offer
// it. An editor this table misses must never surface as "unavailable" with
// nothing to do about it.
//
// The guard is the same shape as external-url.js and site-registry.js: a pure
// check, a safe log formatter, and a wrapper whose effects (`exists`,
// `statPath`, `spawn`) are injected, so both branches are testable with no
// Electron process and no editor installed.

const path = require('path');
const { describeRefused } = require('./safe-log');
const { isRegisteredSite } = require('./site-registry');

// Path semantics follow the platform being asked about, not the platform the
// test happens to run on: `path.isAbsolute('C:\\x')` is false under POSIX, and a
// Windows check that only holds on Windows is a check that never runs in CI.
function pathApi(platform) {
	return platform === 'win32' ? path.win32 : path.posix;
}

// Windows environment variables are case-insensitive to the OS, and the casing
// in documentation ('ProgramFiles', 'LOCALAPPDATA') is not always the casing in
// the environment. Reading them case-insensitively keeps the table from
// depending on which one a machine happens to use.
function envValue(env, name) {
	if (!env) return undefined;
	if (env[name] !== undefined) return env[name];
	const wanted = name.toLowerCase();
	const match = Object.keys(env).find((key) => key.toLowerCase() === wanted);
	return match === undefined ? undefined : env[match];
}

// Every entry is `{ id, name, paths }` where `paths` are absolute locations to
// probe, most likely first. A location that cannot be built — the environment
// variable it needs is not set — is dropped rather than guessed at.
//
// Deliberately not here: anything installed under a version-numbered directory
// (JetBrains' own installer writes `PhpStorm 2024.3\bin\…`). Finding those means
// listing directories and pattern-matching versions, which is a second thing to
// be wrong about; the picker covers them exactly as well.
function editorCandidates({ platform, env = {} } = {}) {
	const p = pathApi(platform);

	if (platform === 'darwin') {
		const home = envValue(env, 'HOME');
		const roots = ['/Applications', home ? p.join(home, 'Applications') : null].filter(Boolean);
		const bundles = [
			{ id: 'vscode', name: 'Visual Studio Code', bundle: 'Visual Studio Code.app' },
			{ id: 'cursor', name: 'Cursor', bundle: 'Cursor.app' },
			{ id: 'phpstorm', name: 'PhpStorm', bundle: 'PhpStorm.app' },
			{ id: 'sublime', name: 'Sublime Text', bundle: 'Sublime Text.app' },
			{ id: 'zed', name: 'Zed', bundle: 'Zed.app' }
		];
		return bundles.map(({ id, name, bundle }) => ({
			id,
			name,
			paths: roots.map((root) => p.join(root, bundle))
		}));
	}

	if (platform === 'win32') {
		const localAppData = envValue(env, 'LOCALAPPDATA');
		const programFiles = envValue(env, 'ProgramFiles');
		const programFilesX86 = envValue(env, 'ProgramFiles(x86)');
		const under = (root, ...rest) => (root ? p.join(root, ...rest) : null);

		return [
			{
				id: 'vscode',
				name: 'Visual Studio Code',
				paths: [
					under(localAppData, 'Programs', 'Microsoft VS Code', 'Code.exe'),
					under(programFiles, 'Microsoft VS Code', 'Code.exe'),
					under(programFilesX86, 'Microsoft VS Code', 'Code.exe')
				]
			},
			{
				id: 'cursor',
				name: 'Cursor',
				paths: [under(localAppData, 'Programs', 'cursor', 'Cursor.exe')]
			},
			{
				id: 'phpstorm',
				name: 'PhpStorm',
				// JetBrains Toolbox's stable launcher location. The standalone
				// installer's versioned directory is the picker's job.
				paths: [under(localAppData, 'Programs', 'PhpStorm', 'bin', 'phpstorm64.exe')]
			},
			{
				id: 'sublime',
				name: 'Sublime Text',
				paths: [under(programFiles, 'Sublime Text', 'sublime_text.exe')]
			},
			{
				id: 'zed',
				name: 'Zed',
				paths: [under(localAppData, 'Programs', 'Zed', 'Zed.exe')]
			}
		].map((entry) => ({ ...entry, paths: entry.paths.filter(Boolean) }));
	}

	// Linux packaging is too varied for a table to be authoritative — these are
	// the locations the common packages use, and the picker is the real answer.
	const home = envValue(env, 'HOME');
	const inHome = (...rest) => (home ? p.join(home, ...rest) : null);
	return [
		{
			id: 'vscode',
			name: 'Visual Studio Code',
			paths: ['/usr/share/code/code', '/usr/bin/code', '/snap/bin/code', '/opt/visual-studio-code/code']
		},
		{ id: 'cursor', name: 'Cursor', paths: ['/usr/bin/cursor', '/snap/bin/cursor', '/opt/Cursor/cursor'] },
		{ id: 'phpstorm', name: 'PhpStorm', paths: ['/snap/bin/phpstorm', '/opt/phpstorm/bin/phpstorm.sh'] },
		{ id: 'sublime', name: 'Sublime Text', paths: ['/usr/bin/subl', '/snap/bin/sublime-text'] },
		{ id: 'zed', name: 'Zed', paths: ['/usr/bin/zed', '/snap/bin/zed', inHome('.local', 'bin', 'zed')].filter(Boolean) }
	];
}

// The editors this machine has, in table order, each reduced to the first
// location that exists. `exists` is injected — it is the only thing detection
// does, and the only thing a test has to stand in for.
//
// It is awaited rather than called for a return value, because the caller is
// Electron's main process: a dozen or so probes of locations that mostly do not
// exist is exactly the kind of work that reads as free on the author's machine
// and stalls the whole window behind a Windows antivirus filter driver. Nothing
// here may be synchronous filesystem access.
//
// Candidates are probed together rather than one after another: they are
// independent questions, and the answer arrives in one round rather than a dozen.
async function detectEditors({ platform, env = {}, exists } = {}) {
	if (typeof exists !== 'function') return [];

	const probe = async (candidate) => {
		try {
			return (await exists(candidate)) === true;
		} catch {
			// An unreadable location is a location we do not have, not a crash on
			// the way to drawing a button.
			return false;
		}
	};

	const found = await Promise.all(editorCandidates({ platform, env }).map(async ({ id, name, paths }) => {
		const present = await Promise.all(paths.map(probe));
		const index = present.indexOf(true);
		return index === -1 ? null : { id, name, path: paths[index] };
	}));

	return found.filter(Boolean);
}

// The detected application at this path, or null for a path detection did not
// return — the answer to "may this app be asked to launch that?".
//
// It exists because the window now names the application: the folder-opening
// menu lists what detection found and sends back one of those paths, where the
// choice used to be read from the store on this side of the wire. So the set of
// launchable applications has to be re-established here rather than trusted, and
// this is where that lives — a pure check with its effects injected, like every
// other guard in this file, so both the case-sensitive and case-insensitive
// branches are testable from one machine.
//
// It returns the *detected* path rather than true. A caller that checked one
// string and then launched the caller's own string would not have checked
// anything (see the note on the parsed URL in external-url.js); handing back the
// path detection vouches for makes that mistake impossible to write.
async function matchDetectedEditor(editorPath, { platform, env = {}, exists } = {}) {
	if (typeof editorPath !== 'string' || editorPath === '') return null;

	const insensitive = platform === 'win32' || platform === 'darwin';
	const normalize = (p) => (insensitive ? p.toLowerCase() : p);
	const wanted = normalize(editorPath);

	const detected = await detectEditors({ platform, env, exists });
	return detected.find((candidate) => normalize(candidate.path) === wanted) || null;
}

// The name the table has for an application at this path, or null for one it
// does not know.
//
// Without this the stored name is the basename, which on macOS reads well by
// accident ('Sublime Text.app' → 'Sublime Text') and on Windows does not:
// 'Code.exe' → 'Code', 'phpstorm64.exe' → 'phpstorm64'. The button promises to
// name the contributor's editor, so a known one is named the way the picker
// named it, and only a manually chosen unknown application falls back to its
// filename.
//
// The comparison is case-insensitive on Windows and macOS because their default
// filesystems are: the same application reached through a differently-cased path
// is the same application.
function knownEditorName(editorPath, { platform, env = {} } = {}) {
	if (typeof editorPath !== 'string' || editorPath === '') return null;

	const insensitive = platform === 'win32' || platform === 'darwin';
	const normalize = (p) => (insensitive ? p.toLowerCase() : p);
	const wanted = normalize(editorPath);

	const match = editorCandidates({ platform, env })
		.find(({ paths }) => paths.some((candidate) => normalize(candidate) === wanted));

	return match ? match.name : null;
}

// Whether a path is something this app will hand to the OS as an application.
//
// Absolute, because a relative command would be resolved through PATH by spawn,
// and of the shape the platform uses for an application: a `.app` bundle
// (a directory) on macOS, an `.exe` on Windows, and elsewhere a file the OS will
// actually execute. That last one is not the same as "a regular file": the Linux
// picker cannot filter by extension, so a document passes every other check and
// then fails with EACCES at the spawn, after being remembered as the
// contributor's editor.
//
// The same check covers a detected path and one the contributor picked — the
// picker is a dialog, and a dialog's result is still input.
//
// `statPath` resolves to `{ isDirectory, isFile, isExecutable }`, or null when
// there is nothing there; it is injected and awaited for the same reasons
// `exists` is.
async function isLaunchableEditorPath(editorPath, { platform, statPath } = {}) {
	if (typeof editorPath !== 'string' || editorPath === '') return false;
	if (typeof statPath !== 'function') return false;
	if (!pathApi(platform).isAbsolute(editorPath)) return false;

	let stats;
	try {
		stats = await statPath(editorPath);
	} catch {
		return false;
	}
	if (!stats) return false;

	if (platform === 'darwin') {
		return stats.isDirectory === true && editorPath.toLowerCase().endsWith('.app');
	}
	if (platform === 'win32') {
		return stats.isFile === true && editorPath.toLowerCase().endsWith('.exe');
	}
	return stats.isFile === true && stats.isExecutable === true;
}

// What to run, as a command and an argument vector — never a string to be
// re-parsed by a shell, and never a concatenation.
//
// macOS goes through `/usr/bin/open -a`, a fixed absolute path, because a `.app`
// bundle is a directory rather than something executable. Everywhere else the
// executable takes the folder as its argument, which is what every editor in the
// table above supports.
function resolveLaunch(editorPath, sitePath, { platform } = {}) {
	if (platform === 'darwin') {
		return { command: '/usr/bin/open', args: ['-a', editorPath, sitePath] };
	}
	return { command: editorPath, args: [sitePath] };
}

// Every `reason` this module can answer `editor:open` with, refusals and
// failures alike. Exported as the complete list on purpose: the renderer's
// open-failure.cjs owes each of these a sentence, and its tests check that
// against this object rather than a copy that could go stale.
const REFUSAL_REASONS = {
	UNREGISTERED_SITE: 'unregistered-site',
	UNLAUNCHABLE_EDITOR: 'unlaunchable-editor',
	UNKNOWN_EDITOR: 'unknown-editor',
	SPAWN_FAILED: 'spawn-failed'
};

// The `editor:open` handler's body.
//
// Two gates, both of which have to pass before anything is spawned. The folder
// must be one the app has on record — `isRegisteredSite` from site-registry.js,
// the same boundary `sites:delete` uses — so "open this site" cannot become
// "open this arbitrary directory". And the application must be absolute and of
// the platform's shape, so an editor path that has been tampered with, or an
// editor that has since been uninstalled, is refused rather than resolved
// through an environment that is not there.
//
// The spawn options are the ones main.js holds everywhere else it starts a
// child: no shell, hidden on Windows, detached with no stdio so the editor
// outlives the app and cannot block on a pipe nobody reads.
async function openSiteInEditor(sitePath, editorPath, {
	sites,
	platform,
	statPath,
	spawn,
	onRefused
} = {}) {
	if (!isRegisteredSite(sitePath, sites)) {
		if (typeof onRefused === 'function') {
			onRefused(REFUSAL_REASONS.UNREGISTERED_SITE, describeRefused(sitePath));
		}
		return { ok: false, reason: REFUSAL_REASONS.UNREGISTERED_SITE };
	}

	if (!await isLaunchableEditorPath(editorPath, { platform, statPath })) {
		if (typeof onRefused === 'function') {
			onRefused(REFUSAL_REASONS.UNLAUNCHABLE_EDITOR, describeRefused(editorPath));
		}
		return { ok: false, reason: REFUSAL_REASONS.UNLAUNCHABLE_EDITOR };
	}

	const { command, args } = resolveLaunch(editorPath, sitePath, { platform });

	let child;
	try {
		child = spawn(command, args, {
			detached: true,
			stdio: 'ignore',
			shell: false,
			windowsHide: true
		});
	} catch (e) {
		// A synchronous throw is the argument-shape failure only. The one that
		// actually happens — the target cannot be executed — arrives as an event.
		return { ok: false, reason: REFUSAL_REASONS.SPAWN_FAILED, error: e?.message ?? String(e) };
	}

	return awaitLaunch(child, { platform });
}

// Whether the launch worked, answered from the child's own events rather than
// from `spawn` having returned.
//
// `spawn` returns a ChildProcess before the OS has been asked to execute
// anything, so a target that cannot be run — EACCES on a file that is not
// executable, EPERM from a Windows policy, or a path deleted between the check
// and the launch — fails afterwards, on the 'error' event. Returning `{ ok: true }`
// at that point is the "the button did nothing" failure this project treats as
// an architectural bug: the contributor cannot debug it, and with no listener the
// emit becomes an uncaught exception that only reaches the log file.
//
// The two platforms need different evidence:
//
// - macOS spawns `/usr/bin/open`, which is not the editor. It exits as soon as
//   it has asked Launch Services to open the bundle, so its exit code is the
//   answer and waiting for it costs milliseconds.
// - Everywhere else the child *is* the editor and stays alive, so the answer is
//   'spawn' — Node's "the OS accepted this" event — and waiting for exit would
//   mean waiting for the contributor to close their editor.
//
// The handle is released either way, so the editor outlives the app.
function awaitLaunch(child, { platform } = {}) {
	return new Promise((resolve) => {
		let settled = false;
		const settle = (result) => {
			if (settled) return;
			settled = true;
			if (typeof child.unref === 'function') child.unref();
			resolve(result);
		};

		child.on('error', (e) => {
			settle({ ok: false, reason: REFUSAL_REASONS.SPAWN_FAILED, error: e?.message ?? String(e) });
		});

		if (platform === 'darwin') {
			child.on('close', (code) => {
				settle(code === 0
					? { ok: true }
					: { ok: false, reason: REFUSAL_REASONS.SPAWN_FAILED, error: `the editor could not be opened (exit code ${code})` });
			});
			return;
		}

		child.on('spawn', () => settle({ ok: true }));
	});
}

module.exports = {
	REFUSAL_REASONS,
	editorCandidates,
	detectEditors,
	matchDetectedEditor,
	knownEditorName,
	isLaunchableEditorPath,
	resolveLaunch,
	openSiteInEditor
};
