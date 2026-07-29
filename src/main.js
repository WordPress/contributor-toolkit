const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const fse = require('fs-extra');
const https = require('https');
const nodeHttp = require('http');
const extract = require('extract-zip');
const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');
const JsDiff = require('diff');
const { spawn } = require('child_process');
const { SMTPServer } = require('smtp-server');
const { simpleParser } = require('mailparser');
const {
	createEngineMismatchDetector,
	shouldRetryWithRelaxedEngines,
	buildChildEnv,
	RELAXED_ENGINES_ENV
} = require('./npm-runner');
const {
	initLogging,
	getLogFilePath,
	logChildOutput,
	flushChildOutput,
	logEvent,
	logError
} = require('./logging');
const { buildMenuTemplate } = require('./menu');

const WORDPRESS_ZIP_URL = 'https://github.com/WordPress/wordpress-develop/archive/refs/heads/trunk.zip';
const WORDPRESS_GIT_URL = 'https://github.com/WordPress/wordpress-develop.git';

// Provide a PATH shim so npm's spawned scripts can find a 'node' binary that maps to Electron's Node
let nodeShimDir = null;
// Windows-only: absolute path of the child_process patch copied next to the
// shims, preloaded into descendant Node processes via NODE_OPTIONS so that a
// bare spawn('node') hitting node.cmd does not fail with EINVAL.
let spawnPatchPath = null;
let npmCliPath = null;
let npxCliPath = null;
function ensureNodeShimDir() {
    if (nodeShimDir) return nodeShimDir;
    nodeShimDir = path.join(os.tmpdir(), `electron-node-shims-${process.pid}`);
    fse.ensureDirSync(nodeShimDir);
    try {
        if (process.platform === 'win32') {
            const content = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`;
            fs.writeFileSync(path.join(nodeShimDir, 'node.cmd'), content);
            fs.writeFileSync(path.join(nodeShimDir, 'node.bat'), content);
            // Provide npm/npx shims that invoke npm's CLI through Electron's Node
            try {
                const npmPkgJsonPath = require.resolve('npm/package.json');
                const npmRootDir = path.dirname(npmPkgJsonPath);
                const npmCliAbsPath = path.join(npmRootDir, 'bin', 'npm-cli.js');
                const npxCliAbsPath = path.join(npmRootDir, 'bin', 'npx-cli.js');
                npmCliPath = npmCliAbsPath;
                npxCliPath = npxCliAbsPath;
                const npmCmd = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${npmCliAbsPath}" %*\r\n`;
                const npxCmd = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${npxCliAbsPath}" %*\r\n`;
                fs.writeFileSync(path.join(nodeShimDir, 'npm.cmd'), npmCmd);
                fs.writeFileSync(path.join(nodeShimDir, 'npm.bat'), npmCmd);
                fs.writeFileSync(path.join(nodeShimDir, 'npx.cmd'), npxCmd);
                fs.writeFileSync(path.join(nodeShimDir, 'npx.bat'), npxCmd);
            } catch {}
            // Copy the child_process patch out of the app bundle: it is loaded with
            // --require by child Node processes, and a path inside app.asar is not
            // reliably resolvable under ELECTRON_RUN_AS_NODE. A failure here only
            // means we are back to the pre-patch behaviour, so it stays non-fatal.
            try {
                const dest = path.join(nodeShimDir, 'win-spawn-patch.js');
                fs.copyFileSync(path.join(__dirname, 'win-spawn-patch.js'), dest);
                spawnPatchPath = dest;
            } catch {}
            // Intentionally do NOT create node.exe here, as Electron's exe depends on adjacent DLLs.
            // Using node.exe from a temp dir causes STATUS_DLL_NOT_FOUND (0xC0000135) when spawned by npm.
        } else {
            const content = `#!/usr/bin/env bash\nELECTRON_RUN_AS_NODE=1 "${process.execPath}" "$@"\n`;
            fs.writeFileSync(path.join(nodeShimDir, 'node'), content, { mode: 0o755 });
            // Provide npm/npx shims that invoke npm's CLI through Electron's Node
            try {
                const npmPkgJsonPath = require.resolve('npm/package.json');
                const npmRootDir = path.dirname(npmPkgJsonPath);
                const npmCliAbsPath = path.join(npmRootDir, 'bin', 'npm-cli.js');
                const npxCliAbsPath = path.join(npmRootDir, 'bin', 'npx-cli.js');
                const npmSh = `#!/usr/bin/env bash\nELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${npmCliAbsPath}" "$@"\n`;
                const npxSh = `#!/usr/bin/env bash\nELECTRON_RUN_AS_NODE=1 "${process.execPath}" "${npxCliAbsPath}" "$@"\n`;
                fs.writeFileSync(path.join(nodeShimDir, 'npm'), npmSh, { mode: 0o755 });
                fs.writeFileSync(path.join(nodeShimDir, 'npx'), npxSh, { mode: 0o755 });
            } catch {}
        }
    } catch {}
    return nodeShimDir;
}

let store; // initialized asynchronously due to ESM-only module
const storeReady = import('electron-store').then((m) => {
	const Store = m.default || m;
	store = new Store({
		name: 'settings',
		defaults: { sites: [], siteMeta: {} }
	});
});

async function getStore() {
	if (!store) await storeReady;
	return store;
}

function findAvailableDirName(rootDir, baseName) {
	const sanitizedBase = baseName || 'wordpress-develop-trunk';
	let candidate = sanitizedBase;
	let counter = 2;
	while (fs.existsSync(path.join(rootDir, candidate))) {
		candidate = `${sanitizedBase}-${counter++}`;
	}
	return candidate;
}

/** @type {Record<string, import('child_process').ChildProcess>} */
const runningInstalls = {};
/** @type {Record<string, import('child_process').ChildProcess>} */
const runningScripts = {};
// Children the user explicitly stopped, so a failed run is not retried.
const cancelledChildren = new WeakSet();
/** @type {Record<string, string>} */
const runIdByDirectory = {};
/** @type {Record<string, { child: import('child_process').ChildProcess, url?: string }>} */
const playgroundServers = {};
/** @type {Record<string, { filePath: string, fileWatcher?: import('fs').FSWatcher, dirWatcher?: import('fs').FSWatcher, lastSize: number }>} */
const wpDebugWatchers = {};
/** @type {Record<string, { server: import('smtp-server').SMTPServer, port: number }>} */
const smtpServers = {};
/** @type {{ child: import('child_process').ChildProcess, url?: string } | null */
let playgroundWebServer = null;

function smtpStoreKey(sitePath) {
    return `siteMail:${sitePath}`;
}

async function getSiteEmails(sitePath) {
    const s = await getStore();
    const list = s.get(smtpStoreKey(sitePath));
    return Array.isArray(list) ? list : [];
}

async function saveSiteEmails(sitePath, emails) {
    const s = await getStore();
    s.set(smtpStoreKey(sitePath), emails);
}

async function appendSiteEmail(sitePath, email) {
    const emails = await getSiteEmails(sitePath);
    emails.push(email);
    // Keep most-recent first by sentAt
    emails.sort((a, b) => new Date(b.sentAt || b.date || 0) - new Date(a.sentAt || a.date || 0));
    await saveSiteEmails(sitePath, emails);
}

function broadcastToAll(eventName, payload) {
    for (const win of BrowserWindow.getAllWindows()) {
        try { win.webContents.send(eventName, payload); } catch {}
    }
}

async function ensureSmtpServerForSite(sitePath) {
    if (smtpServers[sitePath]?.server) return smtpServers[sitePath];

    const server = new SMTPServer({
		secure: false,
		hideSTARTTLS: true,
		disabledCommands: ['AUTH', 'STARTTLS'],
        logger: false,
        onData(stream, session, callback) {
            const chunks = [];
			stream.on('error', (err) => {
				console.error('[SMTP] stream error', err && err.stack ? err.stack : String(err));
				try { callback(err); } catch {}
			});
			stream.on('data', (d) => {
				console.log(`Got a data chunk!`);
				chunks.push(Buffer.from(d));
			});
            stream.on('end', async () => {
                const raw = Buffer.concat(chunks);
                try {
                    const parsed = await simpleParser(raw);
                    const sentAtIso = (parsed.date ? new Date(parsed.date) : new Date()).toISOString();
                    const msg = {
                        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        subject: parsed.subject || '',
                        from: parsed.from ? parsed.from.text : '',
                        to: parsed.to ? parsed.to.text : '',
                        cc: parsed.cc ? parsed.cc.text : '',
                        bcc: parsed.bcc ? parsed.bcc.text : '',
                        date: parsed.date ? new Date(parsed.date).toISOString() : undefined,
                        sentAt: sentAtIso,
                        text: parsed.text || '',
                        html: parsed.html || '',
                        headers: (() => {
                            const obj = {};
                            try { for (const [k, v] of parsed.headers) obj[k] = String(v); } catch {}
                            return obj;
                        })(),
                        raw: raw.toString('utf8')
                    };
                    console.log(`[SMTP] New email for site ${sitePath}: subject="${msg.subject}" from="${msg.from}" to="${msg.to}"`);
                    await appendSiteEmail(sitePath, msg);
                    broadcastToAll('smtp:new-email', { sitePath, message: msg });
                } catch (e) {
                    // parsing failed, store raw minimal
                    const msg = {
                        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        subject: '',
                        from: '',
                        to: '',
                        sentAt: new Date().toISOString(),
                        text: raw.toString('utf8'),
                        html: '',
                        headers: {},
                        raw: raw.toString('utf8')
                    };
                    console.log(`[SMTP] New email for site ${sitePath}: (unparsed) size=${raw.length} bytes`);
                    await appendSiteEmail(sitePath, msg);
                    broadcastToAll('smtp:new-email', { sitePath, message: msg });
                }
                callback(null);
            });
        }
    });

    await new Promise((resolve, reject) => {
        try {
            server.listen(0, '127.0.0.1', resolve);
        } catch (e) { reject(e); }
    });

    const address = server.server.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    smtpServers[sitePath] = { server, port };

    const s = await getStore();
    const meta = s.get('siteMeta') || {};
    meta[sitePath] = { ...(meta[sitePath] || {}), smtpPort: port };
    s.set('siteMeta', meta);

    broadcastToAll('smtp:started', { sitePath, port });
    return smtpServers[sitePath];
}

async function stopSmtpServerForSite(sitePath) {
    const srv = smtpServers[sitePath];
    if (!srv) return;
    try { srv.server.close(); } catch {}
    delete smtpServers[sitePath];
}

function createWindow() {
    const mainWindow = new BrowserWindow({
		width: 1000,
		height: 700,
        icon: process.platform === 'linux' ? path.join(__dirname, '..', 'build', 'icon.png') : undefined,
		webPreferences: {
			preload: path.join(__dirname, 'preload.js'),
			contextIsolation: true,
			nodeIntegration: false
		}
	});

	mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}
function buildPatchHtml(content) {
    return `<!doctype html><html><head><meta charset="utf-8"/><title>Patch</title>
    <style>body{font-family:Menlo,monospace;padding:12px;} pre{white-space:pre-wrap;background:#111;color:#eee;padding:12px;border-radius:6px;height:85vh;overflow:auto} .bar{position:sticky;top:0;background:#fff;padding:8px 0} button{padding:6px 10px}</style>
    </head><body>
    <div class="bar"><button id="copy">Copy</button></div>
    <pre id="pre"></pre>
    <script>
    const pre=document.getElementById('pre');
    pre.textContent = ${JSON.stringify(content)};
    document.getElementById('copy').addEventListener('click', async () => { try { await navigator.clipboard.writeText(pre.textContent); } catch {} });
    </script>
    </body></html>`;
}

async function createMinimalPatchForDir(dir) {
    // Ensure we have origin/trunk and HEAD reference
    try { await git.resolveRef({ fs, dir, ref: 'refs/remotes/origin/trunk' }); }
    catch { await git.fetch({ fs, http, dir, url: WORDPRESS_GIT_URL, depth: 1, singleBranch: true, ref: 'trunk' }); }
    let headOid = null;
    try { headOid = await git.resolveRef({ fs, dir, ref: 'HEAD' }); } catch {}
    if (!headOid) {
        // fallback to local trunk if HEAD missing
        try { headOid = await git.resolveRef({ fs, dir, ref: 'refs/heads/trunk' }); } catch {}
    }

    // Add untracked files to the index (except those in .gitignore)
    const matrix = await git.statusMatrix({ fs, dir });
    for (const [filepath, head, workdir, stage] of matrix) {
        // If file is untracked (head=0, workdir=2, stage=0)
        if (head === 0 && workdir === 2 && stage === 0) {
            try {
                await git.add({ fs, dir, filepath });
            } catch (e) {
                // Ignore errors for files that can't be added (e.g., in .gitignore)
            }
        }
    }

    // Compare working tree vs HEAD (which points to trunk tip after clone)
    const matrixAfterAdd = await git.statusMatrix({ fs, dir });
    const changed = matrixAfterAdd.filter(([filepath, head, workdir, stage]) => head !== workdir);
    let patch = '';
    for (const [filepath, head, workdir] of changed) {
        const abs = require('path').join(dir, filepath);
        const workBuf = workdir ? await fs.promises.readFile(abs).catch(() => null) : null;
        const base = head && headOid ? await git.readBlob({ fs, dir, oid: headOid, filepath }).catch(() => null) : null;
        const a = base ? Buffer.from(base.blob).toString('utf8') : '';
        const b = workBuf ? workBuf.toString('utf8') : a;
        if (a === b) continue;
        // Skip likely-binary
        if ((a.indexOf('\0') !== -1) || (b.indexOf('\0') !== -1)) continue;
        const filePatch = JsDiff.createTwoFilesPatch(`a/${filepath}`, `b/${filepath}`, a, b, '', '', { context: 3 });
        patch += filePatch + '\n';
    }
    return patch || 'No changes.';
}

ipcMain.handle('git:get-patch', async (_e, sitePath) => {
    try {
        const patch = await createMinimalPatchForDir(sitePath);
        return { ok: true, patch };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('git:create-patch', async (_e, sitePath) => {
    try {
        const patch = await createMinimalPatchForDir(sitePath);
        const win = new BrowserWindow({ width: 900, height: 700, webPreferences: { contextIsolation: true, nodeIntegration: false } });
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPatchHtml(patch || 'No changes.')));
        return { ok: true };
    } catch (e) {
        const win = new BrowserWindow({ width: 900, height: 700, webPreferences: { contextIsolation: true, nodeIntegration: false } });
        win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildPatchHtml('Failed to generate diff: ' + String(e))));
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('git:save-patch', async (_e, sitePath) => {
    try {
        const patch = await createMinimalPatchForDir(sitePath);
        const { filePath, canceled } = await dialog.showSaveDialog({
            title: 'Save Diff File',
            defaultPath: path.join(os.homedir(), 'wordpress.patch'),
            filters: [
                { name: 'Patch Files', extensions: ['patch', 'diff'] },
                { name: 'All Files', extensions: ['*'] }
            ]
        });

        if (canceled || !filePath) {
            return { ok: false, canceled: true };
        }

        await fs.promises.writeFile(filePath, patch, 'utf8');
        return { ok: true, filePath };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

app.whenReady().then(() => {
	// Before createWindow(): initLogging preloads the IPC bridge that carries
	// renderer output into the log file, which only applies to windows created
	// afterwards.
	initLogging();
	Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate({
		onOpenLog: () => shell.openPath(getLogFilePath()),
		onShowLogsFolder: () => shell.showItemInFolder(getLogFilePath())
	})));

	createWindow();

	app.on('activate', function () {
		if (BrowserWindow.getAllWindows().length === 0) createWindow();
	});
});

app.on('window-all-closed', function () {
	if (process.platform !== 'darwin') app.quit();
});

ipcMain.handle('sites:get', async () => {
	const s = await getStore();
	return s.get('sites');
});

ipcMain.handle('sites:getAll', async () => {
	const s = await getStore();
	return { sites: s.get('sites'), siteMeta: s.get('siteMeta') };
});

ipcMain.handle('site:status', async (_e, sitePath) => {
	try {
		const nmDir = path.join(sitePath, 'node_modules');
		const hasNodeModules = fs.existsSync(nmDir) && (() => { try { return fs.readdirSync(nmDir).length > 0; } catch { return false; } })();

		const distDir = path.join(sitePath, 'build', 'wp-includes', 'js', 'dist');
		const hasBuilt = fs.existsSync(distDir);

		const s = await getStore();
		const meta = s.get('siteMeta') || {};
		const m = meta[sitePath] || {};

		return { hasNodeModules, hasBuilt, skipInitWizard: Boolean(m.skipInitWizard), initialized: Boolean(m.initialized) };
	} catch (e) {
		return { hasNodeModules: false, hasBuilt: false, skipInitWizard: false, initialized: false };
	}
});

ipcMain.handle('sites:set-skip-init', async (_e, sitePath, skip) => {
	const s = await getStore();
	const meta = s.get('siteMeta') || {};
	meta[sitePath] = { ...(meta[sitePath] || {}), skipInitWizard: Boolean(skip) };
	s.set('siteMeta', meta);
	return true;
});

ipcMain.handle('sites:add', async (_e, sitePath) => {
	const s = await getStore();
	const sites = s.get('sites');
	if (!sites.includes(sitePath)) {
		sites.push(sitePath);
		s.set('sites', sites);
		const meta = s.get('siteMeta');
		meta[sitePath] = meta[sitePath] || {
			initialized: false,
			createdAt: new Date().toISOString(),
			label: path.basename(sitePath)
		};
		s.set('siteMeta', meta);
	}
	return sites;
});

ipcMain.handle('dialog:choose-dir', async () => {
	const result = await dialog.showOpenDialog({
		properties: ['openDirectory', 'createDirectory']
	});
	if (result.canceled || result.filePaths.length === 0) return null;
	return result.filePaths[0];
});

ipcMain.handle('wordpress:setup', async (event, destDir, options = {}) => {
	if (!destDir) {
		throw new Error('No destination directory specified');
	}

	await fse.ensureDir(destDir);

	const requestedName = typeof options.siteName === 'string' ? options.siteName.trim() : '';
	const sanitizedName = requestedName.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || 'wordpress-develop-trunk';
	const uniqueName = findAvailableDirName(destDir, sanitizedName);
	const siteDir = path.join(destDir, uniqueName);
	await fse.ensureDir(siteDir);
	event.sender.send('download:status', { phase: 'cloning', target: siteDir });
	try {
		await git.clone({
			http,
			fs,
			url: WORDPRESS_GIT_URL,
			dir: siteDir,
			singleBranch: true,
			depth: 1,
			ref: 'trunk',
			onProgress: (evt) => {
				// evt: {phase,total,loaded,lengthComputable} - forward as terminal-like output
				const msg = `${evt.phase || 'clone'} ${evt.loaded || 0}/${evt.total || 0}`;
				event.sender.send('download:progress', { target: siteDir, message: msg });
			}
		});
	} catch (e) {
		// Fallback/error
		throw e;
	}

	const s = await getStore();
	const sites = s.get('sites');
	if (!sites.includes(siteDir)) {
		sites.push(siteDir);
		s.set('sites', sites);
		const meta = s.get('siteMeta');
		const siteLabel = typeof options.siteLabel === 'string' && options.siteLabel.trim().length
			? options.siteLabel.trim()
			: uniqueName;
		meta[siteDir] = { initialized: false, createdAt: new Date().toISOString(), label: siteLabel };
		s.set('siteMeta', meta);
	}
	event.sender.send('download:status', { phase: 'done', target: siteDir, sitePath: siteDir });
	return siteDir;
});

ipcMain.handle('sites:mark-initialized', async (_e, sitePath) => {
	const s = await getStore();
	const meta = s.get('siteMeta');
	meta[sitePath] = { ...(meta[sitePath] || {}), initialized: true };
	s.set('siteMeta', meta);
	return true;
});

ipcMain.handle('sites:forget', async (_e, sitePath) => {
	const s = await getStore();
	const sites = s.get('sites').filter((p) => p !== sitePath);
	s.set('sites', sites);
	const meta = s.get('siteMeta');
	delete meta[sitePath];
	s.set('siteMeta', meta);
	return true;
});

ipcMain.handle('sites:delete', async (_e, sitePath) => {
	const s = await getStore();
	const sites = s.get('sites').filter((p) => p !== sitePath);
	s.set('sites', sites);
	const meta = s.get('siteMeta');
	delete meta[sitePath];
	s.set('siteMeta', meta);
	try { await fse.remove(sitePath); } catch {}
	return true;
});

ipcMain.handle('sites:set-label', async (_e, sitePath, label) => {
	const s = await getStore();
	const meta = s.get('siteMeta') || {};
	const trimmed = typeof label === 'string' ? label.trim() : '';
	meta[sitePath] = { ...(meta[sitePath] || {}), label: trimmed || null };
	s.set('siteMeta', meta);
	return true;
});

ipcMain.handle('url:open', async (_e, url) => {
	if (!url) return false;
	await shell.openExternal(url);
	return true;
});

const ENGINE_RETRY_NOTICE = '\n⚠ This site requires a newer Node.js than this app bundles.\n  Retrying with engine checks relaxed…\n\n';

// Spawns an npm runner, and if it fails specifically because a dependency
// demands a newer Node than Electron bundles, retries once with engine checks
// relaxed. The first failure's output still reaches the log, so the real reason
// stays visible instead of being silently papered over.
//
// The automatic retry is opt-in and only npm:install enables it. Scripts
// (build, grunt, …) can fail partway through with side effects already on
// disk, and npm prints EBADENGINE as a mere warning when engine-strict is off
// — so a warning followed by an unrelated non-zero exit would wrongly restart
// a half-finished script. An install, by contrast, is idempotent to re-run.
function runNpmWithEngineRetry({ runnerPath, args, cwd, onLog, onDone, register, logScope, retryOnEngineMismatch = false }) {
	const start = (relaxEngines) => {
		// Logged before the spawn: a child that fails to start at all (EPERM on
		// Windows) produces no output, so without this the log would show nothing
		// where the failure was.
		logEvent(logScope, `spawn ${path.basename(runnerPath)} ${args.join(' ')} in ${cwd}${relaxEngines ? ' (relaxed engines)' : ''}`);
		const child = spawn(process.execPath, [runnerPath, ...args], {
			cwd,
			env: buildChildEnv({
				shimDir: ensureNodeShimDir(),
				spawnPatchPath,
				npmCliPath,
				npxCliPath,
				extraEnv: relaxEngines ? RELAXED_ENGINES_ENV : {}
			}),
			shell: false,
			windowsHide: true
		});
		register(child);

		// A failed spawn (ENOENT/EPERM — most likely on Windows) emits 'error'
		// and may never emit 'close'. Without this the renderer never receives a
		// :done event and the UI stays stuck "installing"/"building" forever.
		let finished = false;
		const finish = (code) => {
			if (finished) return;
			finished = true;
			onDone(code);
		};

		child.on('error', (err) => {
			logError(logScope, `spawn failed: ${String(err)}`);
			onLog('stderr', `\nFailed to start: ${err && err.message ? err.message : String(err)}\n`);
			finish(-1);
		});

		const detector = createEngineMismatchDetector();
		const forward = (stream, type) => {
			stream.on('data', (data) => {
				const text = data.toString();
				if (retryOnEngineMismatch && !relaxEngines) detector.push(text);
				logChildOutput(logScope, type, text);
				onLog(type, text);
			});
		};
		forward(child.stdout, 'stdout');
		forward(child.stderr, 'stderr');

		child.on('close', (code, signal) => {
			flushChildOutput(logScope);
			logEvent(logScope, `exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
			if (finished) return;
			const retry = retryOnEngineMismatch && shouldRetryWithRelaxedEngines({
				code,
				signal,
				sawEngineMismatch: detector.found,
				alreadyRelaxed: relaxEngines,
				cancelled: cancelledChildren.has(child)
			});
			if (retry) {
				finished = true;
				onLog('stdout', ENGINE_RETRY_NOTICE);
				start(true);
				return;
			}
			finish(code);
		});
	};
	start(false);
}

ipcMain.handle('npm:install', async (event, directoryPath) => {
	if (!directoryPath) throw new Error('directoryPath is required');

	const installId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

	runNpmWithEngineRetry({
		runnerPath: path.join(__dirname, 'install-runner.js'),
		args: [directoryPath],
		cwd: directoryPath,
		// Suffixed with the correlation id so two installs running at once stay
		// distinguishable in the log instead of interleaving.
		logScope: `install#${installId.slice(-4)}`,
		retryOnEngineMismatch: true,
		register: (child) => {
			runningInstalls[installId] = child;
		},
		onLog: (type, data) => {
			event.sender.send('npm:install:log', { installId, type, data });
		},
		onDone: (code) => {
			event.sender.send('npm:install:done', { installId, code });
			delete runningInstalls[installId];
		}
	});

	return { installId };
});

ipcMain.handle('npm:run-script', async (event, directoryPath, scriptName, scriptArgs = []) => {
	if (!directoryPath) throw new Error('directoryPath is required');
	if (!scriptName) throw new Error('scriptName is required');

	const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

	runNpmWithEngineRetry({
		runnerPath: path.join(__dirname, 'script-runner.js'),
		args: [directoryPath, scriptName, ...scriptArgs],
		cwd: directoryPath,
		logScope: `${scriptName}#${runId.slice(-4)}`,
		register: (child) => {
			runningScripts[runId] = child;
			runIdByDirectory[directoryPath] = runId;
		},
		onLog: (type, data) => {
			event.sender.send('npm:run-script:log', { runId, type, data });
		},
		onDone: (code) => {
			event.sender.send('npm:run-script:done', { runId, code });
			delete runningScripts[runId];
			if (runIdByDirectory[directoryPath] === runId) {
				delete runIdByDirectory[directoryPath];
			}
		}
	});

	return { runId };
});

ipcMain.handle('npm:kill', async (_event, { runId, directoryPath }) => {
	let child;
	if (runId && runningScripts[runId]) {
		child = runningScripts[runId];
	} else if (directoryPath && runIdByDirectory[directoryPath]) {
		const id = runIdByDirectory[directoryPath];
		child = runningScripts[id];
	}
	if (!child) return { ok: false, error: 'No running script' };
	try {
		cancelledChildren.add(child);
		child.kill('SIGTERM');
		setTimeout(() => child.kill('SIGKILL'), 3000);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: String(e) };
	}
});

ipcMain.handle('playground:start', async (event, sitePath) => {
	// Ensure a per-site SMTP server is running alongside the dev server and get its port
	const smtp = await ensureSmtpServerForSite(sitePath).catch(() => null);
	const buildDir = path.join(sitePath, 'build');
	if (playgroundServers[sitePath]?.child) {
		return { ok: true, url: playgroundServers[sitePath].url };
	}
	const runnerPath = path.join(__dirname, 'server-runner.js');
	const logScope = `playground:${path.basename(sitePath)}`;
	logEvent(logScope, `starting server for ${buildDir} (smtp port ${(smtp && smtp.port) ? smtp.port : 25})`);
	const child = spawn(process.execPath, [runnerPath, buildDir], {
		cwd: buildDir,
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			// Provide SMTP settings to the server runner so it can configure WP constants
			WP_MAIL_SMTP_HOST: '127.0.0.1',
			WP_MAIL_SMTP_PORT: String((smtp && smtp.port) ? smtp.port : 25),
			WP_MAIL_SMTP_AUTH: 'false',
			WP_MAIL_SMTP_SECURE: '',
			WP_MAIL_SMTP_USER: '',
			WP_MAIL_SMTP_PASS: ''
		},
		shell: false,
		windowsHide: true
	});
	playgroundServers[sitePath] = { child };
	let resolved = false;
	let pendingResolve = null;
	let timeoutId = null;
	child.stdout.setEncoding('utf8');
	child.stderr.setEncoding('utf8');
	child.stdout.on('data', (data) => {
		const text = String(data);
		logChildOutput(logScope, 'stdout', text);
		event.sender.send('playground:log', { sitePath, type: 'stdout', data: text });
		const match = text.match(/SERVER_URL:(.*)/);
		if (match && !resolved) {
			resolved = true;
			playgroundServers[sitePath].url = match[1].trim();
			logEvent(logScope, `server ready at ${playgroundServers[sitePath].url}`);
			event.sender.send('playground:url', { sitePath, url: playgroundServers[sitePath].url });
			if (typeof pendingResolve === 'function') {
				clearTimeout(timeoutId);
				pendingResolve({ ok: true, url: playgroundServers[sitePath].url });
				pendingResolve = null;
			}
		}
	});
	child.stderr.on('data', (data) => {
		logChildOutput(logScope, 'stderr', String(data));
		event.sender.send('playground:log', { sitePath, type: 'stderr', data: String(data) });
	});
	child.on('error', (err) => {
		logError(logScope, `spawn failed: ${String(err)}`);
		event.sender.send('playground:log', { sitePath, type: 'stderr', data: String(err) + '\n' });
	});
	// `signal` is logged as well as `code`: a killed process reports a null code,
	// and "exited with code null" tells a reader nothing about why it stopped.
	child.on('close', (code, signal) => {
		flushChildOutput(logScope);
		logEvent(logScope, `server exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
		delete playgroundServers[sitePath];
		event.sender.send('playground:stopped', { sitePath, code });
		// Stop WP debug tail if running
		stopWpDebugTail(sitePath);
		// Stop SMTP server
		stopSmtpServerForSite(sitePath);
	});

	return new Promise((resolve) => {
		pendingResolve = resolve;
		timeoutId = setTimeout(() => {
			if (!resolved && typeof pendingResolve === 'function') {
				pendingResolve({ ok: false, error: 'Timed out starting server' });
				pendingResolve = null;
			}
		}, 20000);
	});
});

ipcMain.handle('playground:stop', async (_event, sitePath) => {
	const server = playgroundServers[sitePath];
	if (!server?.child) return { ok: true };
	try {
		server.child.kill();
		await stopSmtpServerForSite(sitePath);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: String(e) };
	}
});

// --- Global Playground web server (serves local-playground-web) ---
// A single global server, so unlike the per-site ones its log scope is constant.
const WEB_LOG_SCOPE = 'playground-web';

ipcMain.handle('playground-web:available', async () => {
    const webDirCandidates = [
        path.join(app.getAppPath(), 'local-playground-web'),
        path.join(__dirname, '..', 'local-playground-web')
    ];
    for (const p of webDirCandidates) {
        try { if (fs.existsSync(p)) return true; } catch {}
    }
    return false;
});

ipcMain.handle('playground-web:start', async (event) => {
    if (playgroundWebServer?.child) {
        return { ok: true, url: playgroundWebServer.url || 'http://127.0.0.1:39372/' };
    }

    // If something is already listening on the desired port, treat it as started
    const expectedUrl = 'http://127.0.0.1:39372/';
    const reachable = await new Promise((resolve) => {
        try {
            const req = nodeHttp.get(expectedUrl, (res) => { try { req.destroy(); } catch {}; resolve(true); });
            req.on('error', () => { try { req.destroy(); } catch {}; resolve(false); });
            req.setTimeout(1000, () => { try { req.destroy(); } catch {}; resolve(false); });
        } catch { resolve(false); }
    });
    if (reachable) {
        broadcastToAll('playground-web:url', { url: expectedUrl });
        return { ok: true, url: expectedUrl };
    }

    const webDirCandidates = [
        path.join(app.getAppPath(), 'local-playground-web'),
        path.join(__dirname, '..', 'local-playground-web')
    ];
    let webDir = webDirCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!webDir) {
        return { ok: false, error: 'local-playground-web directory not found.' };
    }

    const runnerPath = path.join(__dirname, 'playground-web-runner.js');
    logEvent(WEB_LOG_SCOPE, `starting web server for ${webDir} on port 39372`);
    const child = spawn(process.execPath, [runnerPath, webDir, '39372'], {
        cwd: webDir,
        env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: '1'
        },
        shell: false,
        windowsHide: true
    });
    playgroundWebServer = { child };

    let resolved = false;
    let pendingResolve = null;
    let timeoutId = null;
    let probeIntervalId = null;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data) => {
        const text = String(data);
        logChildOutput(WEB_LOG_SCOPE, 'stdout', text);
        try { broadcastToAll('playground-web:log', { type: 'stdout', data: text }); } catch {}
        const match = text.match(/WEB_SERVER_URL:(.*)/);
        if (match && !resolved) {
            resolved = true;
            playgroundWebServer.url = match[1].trim();
            logEvent(WEB_LOG_SCOPE, `web server ready at ${playgroundWebServer.url}`);
            broadcastToAll('playground-web:url', { url: playgroundWebServer.url });
            if (typeof pendingResolve === 'function') {
                clearTimeout(timeoutId);
                if (probeIntervalId) clearInterval(probeIntervalId);
                pendingResolve({ ok: true, url: playgroundWebServer.url });
                pendingResolve = null;
            }
        }
    });
    child.stderr.on('data', (data) => {
        logChildOutput(WEB_LOG_SCOPE, 'stderr', String(data));
        try { broadcastToAll('playground-web:log', { type: 'stderr', data: String(data) }); } catch {}
    });
    child.on('error', (err) => {
        logError(WEB_LOG_SCOPE, `spawn failed: ${String(err)}`);
        try { broadcastToAll('playground-web:log', { type: 'stderr', data: String(err) + '\n' }); } catch {}
    });
    child.on('close', (code, signal) => {
        flushChildOutput(WEB_LOG_SCOPE);
        logEvent(WEB_LOG_SCOPE, `web server exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
        const stillPending = !resolved && typeof pendingResolve === 'function';
        playgroundWebServer = null;
        if (stillPending) {
            clearTimeout(timeoutId);
            if (probeIntervalId) clearInterval(probeIntervalId);
            try { pendingResolve({ ok: false, error: 'Server exited before becoming ready' }); } catch {}
            pendingResolve = null;
        }
        broadcastToAll('playground-web:stopped', { code });
    });

    return new Promise((resolve) => {
        pendingResolve = resolve;
        // Fallback readiness probe if CLI output is not captured
        const probe = () => {
            try {
                const req = nodeHttp.get(expectedUrl, (res) => {
                    try { req.destroy(); } catch {}
                    if (!resolved) {
                        resolved = true;
                        playgroundWebServer.url = expectedUrl;
                        broadcastToAll('playground-web:url', { url: expectedUrl });
                        if (typeof pendingResolve === 'function') {
                            clearTimeout(timeoutId);
                            if (probeIntervalId) clearInterval(probeIntervalId);
                            pendingResolve({ ok: true, url: expectedUrl });
                            pendingResolve = null;
                        }
                    }
                });
                req.on('error', () => { try { req.destroy(); } catch {} });
                req.setTimeout(1500, () => { try { req.destroy(); } catch {} });
            } catch {}
        };
        probeIntervalId = setInterval(probe, 600);
        timeoutId = setTimeout(() => {
            if (!resolved && typeof pendingResolve === 'function') {
                pendingResolve({ ok: false, error: 'Timed out starting web server' });
                pendingResolve = null;
            }
            if (probeIntervalId) clearInterval(probeIntervalId);
        }, 20000);
    });
});

ipcMain.handle('playground-web:stop', async () => {
    if (!playgroundWebServer?.child) return { ok: true };
    try {
        playgroundWebServer.child.kill();
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

// --- SMTP IPC ---
ipcMain.handle('smtp:get', async (_e, sitePath) => {
    const emails = await getSiteEmails(sitePath);
    const srv = smtpServers[sitePath];
    const s = await getStore();
    const meta = s.get('siteMeta') || {};
    const port = srv?.port || meta?.[sitePath]?.smtpPort || 0;
    // Return sorted by sentAt desc
    const sorted = [...emails].sort((a, b) => new Date(b.sentAt || b.date || 0) - new Date(a.sentAt || a.date || 0));
    return { port, emails: sorted };
});

ipcMain.handle('smtp:clear', async (_e, sitePath) => {
    await saveSiteEmails(sitePath, []);
    return true;
});

ipcMain.handle('smtp:start', async (_e, sitePath) => {
    try {
        const { port } = await ensureSmtpServerForSite(sitePath);
        return { ok: true, port };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('smtp:stop', async (_e, sitePath) => {
    try {
        await stopSmtpServerForSite(sitePath);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

// --- WordPress debug.log tailing ---
function startWpDebugTail(sitePath, webContents) {
	const wpContentDir = path.join(sitePath, 'build', 'wp-content');
	const filePath = path.join(wpContentDir, 'debug.log');
	if (wpDebugWatchers[sitePath]?.fileWatcher || wpDebugWatchers[sitePath]?.dirWatcher) {
		return true;
	}
	wpDebugWatchers[sitePath] = { filePath, lastSize: 0 };
	const state = wpDebugWatchers[sitePath];

	function attachFileWatcher() {
		try {
			const stat = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
			if (!stat) return false;
			// Send initial tail (cap to last 256KB)
			const maxInitial = 256 * 1024;
			const start = stat.size > maxInitial ? stat.size - maxInitial : 0;
			state.lastSize = stat.size;
			if (stat.size > 0) {
				const rs = fs.createReadStream(filePath, { start });
				rs.on('data', (chunk) => {
					webContents.send('wp:debug-log:data', { sitePath, data: chunk.toString() });
				});
			}
			state.fileWatcher = fs.watch(filePath, (evt) => {
				if (evt !== 'change') return;
				try {
					const s = fs.statSync(filePath);
					if (s.size > state.lastSize) {
						const rs2 = fs.createReadStream(filePath, { start: state.lastSize });
						rs2.on('data', (chunk) => {
							webContents.send('wp:debug-log:data', { sitePath, data: chunk.toString() });
						});
						state.lastSize = s.size;
					}
				} catch {}
			});
			return true;
		} catch {
			return false;
		}
	}

	// Watch directory for creation if the file doesn't exist yet
	if (!attachFileWatcher()) {
		try {
			state.dirWatcher = fs.watch(wpContentDir, () => {
				if (attachFileWatcher() && state.dirWatcher) {
					state.dirWatcher.close();
					state.dirWatcher = undefined;
				}
			});
		} catch {}
	}
	return true;
}

function stopWpDebugTail(sitePath) {
	const state = wpDebugWatchers[sitePath];
	if (!state) return;
	try { state.fileWatcher?.close(); } catch {}
	try { state.dirWatcher?.close(); } catch {}
	delete wpDebugWatchers[sitePath];
}

ipcMain.handle('wp-debug:start', async (event, sitePath) => {
	startWpDebugTail(sitePath, event.sender);
	return true;
});

ipcMain.handle('wp-debug:stop', async (_event, sitePath) => {
	stopWpDebugTail(sitePath);
	return true;
});

function downloadFile(url, dest, onProgress) {
	return new Promise((resolve, reject) => {
		const file = fs.createWriteStream(dest);
		let receivedBytes = 0;
		let totalBytes = 0;

		https.get(url, (response) => {
			if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
				// handle redirect
				return https.get(response.headers.location, (res2) => handleResponse(res2));
			}
			handleResponse(response);
		}).on('error', (err) => {
			fs.unlink(dest, () => reject(err));
		});

		function handleResponse(response) {
			if (response.statusCode !== 200) {
				fs.unlink(dest, () => reject(new Error(`Failed to get '${url}' (${response.statusCode})`)));
				return;
			}
			totalBytes = parseInt(response.headers['content-length'] || '0', 10);
			response.on('data', (chunk) => {
				receivedBytes += chunk.length;
				if (onProgress && totalBytes) {
					onProgress({ receivedBytes, totalBytes, percent: (receivedBytes / totalBytes) * 100 });
				}
			});
			response.pipe(file);
			file.on('finish', () => file.close(resolve));
		}
	});
}
