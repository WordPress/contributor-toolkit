const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const fs = require('fs');
const fse = require('fs-extra');
const nodeHttp = require('http');
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
const { killChildTree } = require('./kill-tree');
const { normalizeEol } = require('./git-update.cjs');
const { ensureAutocrlf, readTrunkInfo, collectDirtyFiles, discardChanges, updateToLatestTrunk } = require('./trunk-update');
const { applyPatchToDir } = require('./patch-apply');
const { parsePatchFiles, planApply } = require('./patch-plan.cjs');
const { openExternalUrl, ALLOWED_URL_SCHEMES } = require('./external-url');
const { deleteRegisteredSite } = require('./site-registry');
const { getStore } = require('./settings-store');
const { parseTicketRef } = require('./renderer/trac-ticket.cjs');

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

// Every child this app starts is one of the runners next to this file, run on
// Electron's own Node. They all need the same environment — buildChildEnv's, the
// mechanism behind "zero prerequisites" — and the same three cross-platform
// options, so all of it lives here rather than being restated per spawn site:
// restating it is what left the Playground path outside npm-runner's and
// kill-tree's tests (#146).
//
// `extraEnv` is for settings a single runner reads (the SMTP constants
// server-runner.js needs); it is layered on top of the shared environment, never
// in place of it.
function spawnRunner(runnerPath, args, { cwd, extraEnv = {} }) {
	return spawn(process.execPath, [runnerPath, ...args], {
		cwd,
		env: buildChildEnv({
			shimDir: ensureNodeShimDir(),
			spawnPatchPath,
			npmCliPath,
			npxCliPath,
			extraEnv
		}),
		shell: false,
		windowsHide: true,
		// Group leader on POSIX so killChildTree can signal the whole tree
		// (see kill-tree.js); Windows uses taskkill /T instead.
		detached: process.platform !== 'win32'
	});
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
/** @type {{ child: import('child_process').ChildProcess, url?: string } | null} */
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
				logError('smtp', `stream error: ${err && err.stack ? err.stack : String(err)}`);
				try { callback(err); } catch {}
			});
			stream.on('data', (d) => {
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
                    logEvent('smtp', `New email for site ${sitePath}: subject="${msg.subject}" from="${msg.from}" to="${msg.to}"`);
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
                    logError('smtp', `Failed to parse email for site ${sitePath} (size=${raw.length} bytes): ${e && e.message ? e.message : String(e)}`);
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
    await ensureAutocrlf(dir);
    // The diff base is deliberately the local HEAD (the cloned trunk
    // snapshot), NOT the remote trunk ref: diffing local edits against a
    // trunk that has moved would embed reversed upstream changes and foreign
    // context lines into the patch, and it would apply nowhere. The route to
    // Trac-applicable patches is the "Update to latest trunk" action (#94),
    // after which HEAD == origin/trunk and the two bases coincide.
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
            } catch {
                // Ignore errors for files that can't be added (e.g., in .gitignore)
            }
        }
    }

    // Compare working tree vs HEAD (which points to trunk tip after clone)
    const matrixAfterAdd = await git.statusMatrix({ fs, dir });
    const changed = matrixAfterAdd.filter(([, head, workdir]) => head !== workdir);
    let patch = '';
    for (const [filepath, head, workdir] of changed) {
        const abs = require('path').join(dir, filepath);
        const workBuf = workdir ? await fs.promises.readFile(abs).catch(() => null) : null;
        const base = head && headOid ? await git.readBlob({ fs, dir, oid: headOid, filepath }).catch(() => null) : null;
        // CRLF→LF on both sides: the workdir may be a CRLF checkout (native
        // git on Windows), and a patch full of line-ending churn applies
        // nowhere on Trac.
        const a = base ? normalizeEol(Buffer.from(base.blob).toString('utf8')) : '';
        const b = workBuf ? normalizeEol(workBuf.toString('utf8')) : a;
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

// --- Trunk update path (#94) --- git mechanics live in src/trunk-update.js;
// these handlers only add IPC plumbing and electron-store writes.

async function mergeSiteMeta(sitePath, patch) {
    const s = await getStore();
    const meta = s.get('siteMeta') || {};
    meta[sitePath] = { ...(meta[sitePath] || {}), ...patch };
    s.set('siteMeta', meta);
}

ipcMain.handle('git:worktree-dirty', async (_e, sitePath) => {
    try {
        const files = await collectDirtyFiles(sitePath);
        return { ok: true, dirty: files.length > 0, changedCount: files.length, files };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('git:discard-changes', async (_e, sitePath) => {
    try {
        await discardChanges(sitePath);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('git:update-trunk', async (event, sitePath) => {
    const updateId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sender = event.sender;
    const sendLog = (data) => {
        try { sender.send('git:update-trunk:log', { updateId, data }); } catch {}
    };
    const sendDone = (payload) => {
        try { sender.send('git:update-trunk:done', { updateId, ...payload }); } catch {}
    };

    (async () => {
        try {
            const result = await updateToLatestTrunk({ dir: sitePath, url: WORDPRESS_GIT_URL, onLog: sendLog });
            // An update resets the worktree, so any applied patch is gone with
            // it either way — clear the record so the "applied" banner does not
            // outlive the patch. (This is also where a discard's cleanup lands:
            // the dirty-tree modal always discards and then updates.)
            if (result.upToDate) {
                await mergeSiteMeta(sitePath, { trunkOid: result.oldOid, trunkDate: result.trunkDate, appliedPatch: null });
            } else {
                // HEAD has moved but install/build have not run yet: persist
                // the incomplete flag now so the state survives a crash or
                // quit mid-chain; the renderer clears it after a successful
                // build.
                await mergeSiteMeta(sitePath, { trunkOid: result.newOid, trunkDate: result.trunkDate, updateIncomplete: true, appliedPatch: null });
            }
            sendDone({ ok: true, ...result });
        } catch (e) {
            logError('git:update-trunk', String(e && e.stack ? e.stack : e));
            const stage = (e && e.stage) || 'fetch';
            // A failure during checkout leaves the ref moved over a partial
            // worktree — that is the "code is new, assets are old" state, so
            // persist it; a fetch failure moved nothing and stays plain.
            if (stage === 'checkout') {
                try { await mergeSiteMeta(sitePath, { updateIncomplete: true }); } catch {}
            }
            sendLog(`\nUpdate failed during ${stage}: ${String(e && e.message ? e.message : e)}\n`);
            sendDone({ ok: false, upToDate: false, error: String(e), stage });
        }
    })();

    return { updateId };
});

// --- Applying someone else's patch (#11) --- the diff mechanics live in
// src/patch-apply.js; these handlers add IPC plumbing and electron-store writes.

// A patch big enough to bloat the settings file is not worth keeping around for
// an undo button. Above this the patch still applies, only "Revert" is not
// offered — said out loud rather than silently dropped.
const REVERTABLE_PATCH_LIMIT = 512 * 1024;

// Reading a patch without touching the checkout, so the contributor sees which
// files it would change — and which of their own edits it collides with —
// before deciding.
ipcMain.handle('git:preview-patch', async (_e, sitePath, patchText) => {
    try {
        const parsed = parsePatchFiles(patchText);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        let dirtyPaths = [];
        try { dirtyPaths = await collectDirtyFiles(sitePath); } catch {}
        const plan = planApply({ files: parsed.files, dirtyPaths });
        return { ok: true, ...plan, files: parsed.files.map((f) => ({ kind: f.kind, path: f.path })) };
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('dialog:choose-patch-file', async () => {
    const result = await dialog.showOpenDialog({
        title: 'Choose a patch file',
        properties: ['openFile'],
        filters: [
            { name: 'Patch Files', extensions: ['patch', 'diff'] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    try {
        const text = await fs.promises.readFile(filePath, 'utf8');
        return { filePath, name: path.basename(filePath), text };
    } catch (e) {
        return { filePath, error: String(e) };
    }
});

ipcMain.handle('git:apply-patch', async (event, sitePath, options = {}) => {
    const applyId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const sender = event.sender;
    const sendLog = (data) => {
        try { sender.send('git:apply-patch:log', { applyId, data }); } catch {}
    };
    const sendDone = (payload) => {
        try { sender.send('git:apply-patch:done', { applyId, ...payload }); } catch {}
    };

    (async () => {
        try {
            const reverse = Boolean(options.reverse);
            // Reverting reads the patch the app stored when it applied it, so
            // the renderer never has to hold a copy of the text.
            let patchText = String(options.patchText || '');
            let label = String(options.label || 'patch');
            const s = await getStore();
            const stored = ((s.get('siteMeta') || {})[sitePath] || {}).appliedPatch;
            if (reverse) {
                if (!stored || !stored.text) {
                    sendDone({ ok: false, error: 'There is no stored patch to revert.' });
                    return;
                }
                patchText = stored.text;
                label = stored.label || label;
            } else if (stored) {
                // Only one patch is tracked at a time, so a second apply would
                // make the first one silently unrevertable and invisible.
                sendDone({ ok: false, error: `${stored.label} is already applied. Revert it before applying another patch.` });
                return;
            }
            sendLog(`\n${reverse ? 'Reverting' : 'Applying'} ${label}…\n`);

            const result = await applyPatchToDir({ dir: sitePath, patchText, reverse, onLog: sendLog });
            if (!result.ok) {
                sendDone({ ok: false, ...result });
                return;
            }

            if (reverse) {
                await mergeSiteMeta(sitePath, { appliedPatch: null });
            } else {
                const revertable = patchText.length <= REVERTABLE_PATCH_LIMIT;
                if (!revertable) {
                    sendLog('This patch is too large to keep for an undo, so Revert will not be offered.\n');
                }
                await mergeSiteMeta(sitePath, {
                    appliedPatch: {
                        label,
                        appliedAt: new Date().toISOString(),
                        files: result.applied,
                        text: revertable ? patchText : null
                    }
                });
            }
            sendDone({ ok: true, ...result, reverse });
        } catch (e) {
            logError('git:apply-patch', String(e && e.stack ? e.stack : e));
            sendLog(`\nApplying the patch failed: ${String(e && e.message ? e.message : e)}\n`);
            sendDone({ ok: false, error: String(e) });
        }
    })();

    return { applyId };
});

ipcMain.handle('sites:mark-update-complete', async (_e, sitePath) => {
    await mergeSiteMeta(sitePath, { updateIncomplete: false });
    return true;
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

// Quitting must end everything the app started (#83). The children that matter
// are trees (runner → npm → shell → grunt → node), so each one goes through
// killChildTree rather than child.kill(), which signals only the first link.
// Known residual gap on Windows: taskkill /T walks parent links at kill time,
// so a grandchild whose intermediate parent is already gone can survive
// (observed with grunt _watch) — tracked in #83.
app.on('before-quit', () => {
	logEvent('quit', 'sweeping child processes');
	const children = [
		...Object.values(runningInstalls),
		...Object.values(runningScripts),
		...Object.values(playgroundServers).map((s) => s.child),
		...(playgroundWebServer?.child ? [playgroundWebServer.child] : [])
	];
	for (const child of children) killChildTree(child);
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

		// Trunk snapshot age (#94). Read from HEAD each time (one object
		// read) and written through to siteMeta, so the sidebar can render
		// staleness dots from siteMeta alone, without per-site git I/O.
		let trunkOid = m.trunkOid || null;
		let trunkDate = m.trunkDate || null;
		try {
			const info = await readTrunkInfo(sitePath);
			trunkOid = info.trunkOid;
			trunkDate = info.trunkDate;
			if (m.trunkOid !== trunkOid || m.trunkDate !== trunkDate) {
				await mergeSiteMeta(sitePath, { trunkOid, trunkDate });
			}
		} catch {}

		// Summarised rather than passed through: the stored patch text is only
		// needed by the main process to reverse it, and this is polled.
		const appliedPatch = m.appliedPatch
			? {
				label: m.appliedPatch.label,
				appliedAt: m.appliedPatch.appliedAt,
				files: m.appliedPatch.files || [],
				revertable: Boolean(m.appliedPatch.text)
			}
			: null;

		return { hasNodeModules, hasBuilt, skipInitWizard: Boolean(m.skipInitWizard), initialized: Boolean(m.initialized), installFailed: Boolean(m.installFailed), trunkOid, trunkDate, updateIncomplete: Boolean(m.updateIncomplete), tracTicket: m.tracTicket || null, appliedPatch };
	} catch {
		return { hasNodeModules: false, hasBuilt: false, skipInitWizard: false, initialized: false, installFailed: false, trunkOid: null, trunkDate: null, updateIncomplete: false, tracTicket: null, appliedPatch: null };
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
	// A pre-existing dir was likely cloned by native git — exactly the case
	// where CRLF checkouts break status/patch generation (see ensureAutocrlf).
	await ensureAutocrlf(sitePath);
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
	await ensureAutocrlf(siteDir);

	const s = await getStore();
	const sites = s.get('sites');
	if (!sites.includes(siteDir)) {
		sites.push(siteDir);
		s.set('sites', sites);
		const meta = s.get('siteMeta');
		const siteLabel = typeof options.siteLabel === 'string' && options.siteLabel.trim().length
			? options.siteLabel.trim()
			: uniqueName;
		const existingMeta = meta[siteDir] || {};
		meta[siteDir] = {
			...existingMeta,
			initialized: false,
			createdAt: existingMeta.createdAt || new Date().toISOString(),
			label: existingMeta.label || siteLabel
		};
		const ticket = parseTicketRef(options.tracTicket);
		if (ticket.ok && !Object.prototype.hasOwnProperty.call(existingMeta, 'tracTicket')) {
			meta[siteDir].tracTicket = ticket.id;
		}
		try {
			const { trunkOid, trunkDate } = await readTrunkInfo(siteDir);
			meta[siteDir].trunkOid = trunkOid;
			meta[siteDir].trunkDate = trunkDate;
		} catch {}
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

// Only a path the app has on record gets removed from disk — see site-registry.js
// for why. A refusal is logged rather than dropped so a future caller that trips
// the guard shows up in the log file instead of just doing nothing.
ipcMain.handle('sites:delete', async (_e, sitePath) => {
	const s = await getStore();
	return deleteRegisteredSite(sitePath, {
		sites: s.get('sites'),
		forget: () => {
			s.set('sites', s.get('sites').filter((p) => p !== sitePath));
			const meta = s.get('siteMeta');
			delete meta[sitePath];
			s.set('siteMeta', meta);
		},
		// Best-effort, as before: a site whose registry entry is gone should not be
		// stuck undeletable because its directory is missing or locked.
		remove: async (p) => { try { await fse.remove(p); } catch {} },
		onRefused: (description) => logEvent('sites', `refused to delete ${description} — not a registered site`)
	});
});

ipcMain.handle('sites:set-label', async (_e, sitePath, label) => {
	const s = await getStore();
	const meta = s.get('siteMeta') || {};
	const trimmed = typeof label === 'string' ? label.trim() : '';
	meta[sitePath] = { ...(meta[sitePath] || {}), label: trimmed || null };
	s.set('siteMeta', meta);
	return true;
});

// Which Trac ticket a site is being used to work on (#109). Stored as a plain
// number in siteMeta: the association is local and offline, so linking a
// ticket never depends on Trac being reachable.
ipcMain.handle('sites:set-ticket', async (_e, sitePath, ref) => {
	try {
		const s = await getStore();
		const sites = s.get('sites') || [];
		if (!sites.includes(sitePath)) return { ok: false, error: 'Site is not registered' };
		// Empty means unlink — the panel's Unlink button and a cleared field
		// both land here, and neither is an error.
		const raw = typeof ref === 'string' ? ref.trim() : '';
		if (!raw) {
			await mergeSiteMeta(sitePath, { tracTicket: null });
			return { ok: true, ticket: null };
		}
		const parsed = parseTicketRef(raw);
		if (!parsed.ok) return { ok: false, error: parsed.error };
		await mergeSiteMeta(sitePath, { tracTicket: parsed.id });
		return { ok: true, ticket: parsed.id };
	} catch (e) {
		return { ok: false, error: String(e) };
	}
});

// Only the schemes the app actually uses reach the OS — see external-url.js for
// why. A refusal is logged rather than dropped so a future caller that trips the
// guard shows up in the log file instead of just doing nothing.
ipcMain.handle('url:open', async (_e, url) => openExternalUrl(url, {
	openExternal: (target) => shell.openExternal(target),
	onRefused: (description) => logEvent('url', `refused to open ${description} — only ${ALLOWED_URL_SCHEMES.join(', ')} are allowed`)
}));

const ENGINE_RETRY_NOTICE = '\n⚠ This site requires a newer Node.js than this app bundles.\n  Retrying with engine checks relaxed…\n\n';

// Spawns an npm runner, and if it fails specifically because a dependency
// demands a newer Node than Electron bundles, retries once with engine checks
// relaxed. The first failure's output still reaches the log, so the real reason
// stays visible instead of being silently papered over.
//
// Two independent knobs, and each command uses exactly one of them:
//
// `retryOnEngineMismatch` (npm:install) runs strict first and retries relaxed.
// Scripts (build, grunt, …) must not do this: they can fail partway through
// with side effects already on disk, and npm prints EBADENGINE as a mere
// warning when engine-strict is off — so a warning followed by an unrelated
// non-zero exit would wrongly restart a half-finished script. An install, by
// contrast, is idempotent to re-run.
//
// `relaxEnginesFromStart` (npm:run-script) is the opposite trade and is safe
// for exactly that reason: nothing is ever restarted, engine checks are simply
// off from the first process onward. Scripts need it because they spawn nested
// installs that inherit this environment — wordpress-develop's Gruntfile calls
// install-changed at load time, which execSync's its own `npm install` (#54).
function runNpmWithEngineRetry({ runnerPath, args, cwd, onLog, onDone, register, logScope, retryOnEngineMismatch = false, relaxEnginesFromStart = false }) {
	const start = (relaxEngines) => {
		// Logged before the spawn: a child that fails to start at all (EPERM on
		// Windows) produces no output, so without this the log would show nothing
		// where the failure was.
		logEvent(logScope, `spawn ${path.basename(runnerPath)} ${args.join(' ')} in ${cwd}${relaxEngines ? ' (relaxed engines)' : ''}`);
		const child = spawnRunner(runnerPath, args, {
			cwd,
			extraEnv: relaxEngines ? RELAXED_ENGINES_ENV : {}
		});
		register(child);

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

		// 'error' and 'close' are independent events, and Node documents that the
		// exit events "may or may not" follow a spawn failure. In practice close
		// does arrive (verified on Electron's Node 20: error, then close with code
		// -2), so the normal path below is left to win — it is the one that knows
		// about the engines retry. This only settles the request when close
		// genuinely never comes, which would otherwise leave the caller waiting
		// forever and the child registry never cleaned up.
		let settled = false;
		// The single exit point, so the caller is told exactly once no matter which
		// event gets there first.
		const settle = (code) => {
			if (settled) return;
			settled = true;
			onDone(code);
		};

		child.on('error', (err) => {
			logError(logScope, `spawn failed: ${String(err)}`);
			// Also surfaced in the app's terminal: the log file explains a failure
			// after the fact, but the person who just clicked the button needs to
			// see that the run never started.
			onLog('stderr', `\nFailed to start: ${err && err.message ? err.message : String(err)}\n`);
			// Deferred by a turn so that close — which knows about the engines
			// retry — wins whenever it does arrive. A spawn failure is the very
			// case this logging exists to expose, so it must not also become a
			// silent hang with the request never settled.
			setTimeout(() => {
				if (settled) return;
				flushChildOutput(logScope);
				logEvent(logScope, 'never started; no exit reported');
				settle(null);
			}, 0);
		});

		child.on('close', (code, signal) => {
			flushChildOutput(logScope);
			logEvent(logScope, `exited with code ${code}${signal ? ` (signal ${signal})` : ''}`);
			// `!settled` guards the case where the error path got there first: the
			// caller has already been told the run finished, so starting a second
			// attempt behind its back would report output for a run it considers
			// over.
			const retry = !settled && retryOnEngineMismatch && shouldRetryWithRelaxedEngines({
				code,
				signal,
				sawEngineMismatch: detector.found,
				alreadyRelaxed: relaxEngines,
				cancelled: cancelledChildren.has(child)
			});
			if (retry) {
				onLog('stdout', ENGINE_RETRY_NOTICE);
				start(true);
				return;
			}
			settle(code);
		});
	};
	start(relaxEnginesFromStart);
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
		onDone: async (code) => {
			// Recorded before the done event so the renderer's status reload
			// sees the outcome. node_modules existing is not evidence the
			// install succeeded (#42); this flag is what site:status reports
			// so a failed install's partial node_modules doesn't read as a
			// completed setup step. Sites that predate the flag read as not
			// failed, which matches the old behaviour.
			try {
				const s = await getStore();
				const meta = s.get('siteMeta') || {};
				meta[directoryPath] = { ...(meta[directoryPath] || {}), installFailed: code !== 0 };
				s.set('siteMeta', meta);
			} catch {}
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
		// Baseline-relax rather than retry — see runNpmWithEngineRetry. Without
		// this the nested `npm install` a build task spawns fails with EBADENGINE
		// before grunt even starts (#54).
		relaxEnginesFromStart: true,
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
		// A script is a tree — runner -> npm -> shell -> grunt — and child.kill()
		// signals only the first link, so stopping a build left the rest of it
		// running (#83, #146).
		killChildTree(child);
		// Last resort for a child that ignores SIGTERM. Only the direct child: by
		// this point the tree has had its chance, and the runner dying takes the
		// pipes with it.
		setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 3000);
		return { ok: true };
	} catch (e) {
		return { ok: false, error: String(e) };
	}
});

// Servers for several sites can run at once, and two sites can share a folder
// name under different parents. The log's line buffers are keyed by scope, so a
// bare basename would let two servers' partial lines interleave into corrupted
// ones. The path hash disambiguates without putting an absolute path on every
// line; the full path is logged once at spawn.
function playgroundLogScope(sitePath) {
	const suffix = crypto.createHash('sha1').update(String(sitePath)).digest('hex').slice(0, 4);
	return `playground:${path.basename(sitePath)}#${suffix}`;
}

ipcMain.handle('playground:start', async (event, sitePath) => {
	// Ensure a per-site SMTP server is running alongside the dev server and get its port
	const smtp = await ensureSmtpServerForSite(sitePath).catch(() => null);
	if (playgroundServers[sitePath]?.child) {
		return { ok: true, url: playgroundServers[sitePath].url };
	}
	const buildDir = path.join(sitePath, 'build');
	const runnerPath = path.join(__dirname, 'server-runner.js');
	const logScope = playgroundLogScope(sitePath);
	logEvent(logScope, `starting server for ${buildDir} (smtp port ${(smtp && smtp.port) ? smtp.port : 25})`);
	const child = spawnRunner(runnerPath, [buildDir], {
		cwd: buildDir,
		extraEnv: {
			// Provide SMTP settings to the server runner so it can configure WP constants
			WP_MAIL_SMTP_HOST: '127.0.0.1',
			WP_MAIL_SMTP_PORT: String((smtp && smtp.port) ? smtp.port : 25),
			WP_MAIL_SMTP_AUTH: 'false',
			WP_MAIL_SMTP_SECURE: '',
			WP_MAIL_SMTP_USER: '',
			WP_MAIL_SMTP_PASS: ''
		}
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
		// A server that dies before reporting its URL must fail the start request
		// now, not at the 120s timeout: the stale resolution would arrive while a
		// restarted session is still starting and the renderer's failure handling
		// would tear down the wrong session (#82). The web-server variant below
		// settles on close the same way.
		if (typeof pendingResolve === 'function') {
			clearTimeout(timeoutId);
			pendingResolve({ ok: false, error: `Server exited with code ${code}${signal ? ` (signal ${signal})` : ''} before reporting a URL` });
			pendingResolve = null;
		}
		event.sender.send('playground:stopped', { sitePath, code });
		// Stop WP debug tail if running
		stopWpDebugTail(sitePath);
		// Stop SMTP server
		stopSmtpServerForSite(sitePath);
	});

	// The server must report SERVER_URL within this window or the start has
	// failed. Generous on purpose: booting WASM PHP on a slow Windows VM can
	// legitimately take tens of seconds, and cutting off a slow-but-healthy
	// boot would be worse than the wait. What this converts is "hangs forever"
	// into "fails loudly" (issue #73): on expiry the child is killed — which
	// fires the close handler and the playground:stopped event — and the
	// renderer surfaces the returned error.
	const START_TIMEOUT_MS = 120000;
	return new Promise((resolve) => {
		pendingResolve = resolve;
		timeoutId = setTimeout(() => {
			if (!resolved && typeof pendingResolve === 'function') {
				logError(logScope, `server did not report a URL within ${START_TIMEOUT_MS / 1000}s; killing it`);
				// The tree, not the runner alone: a server that hung on the way up
				// still has its worker underneath it.
				killChildTree(child);
				pendingResolve({ ok: false, error: `Server did not start within ${START_TIMEOUT_MS / 1000} seconds` });
				pendingResolve = null;
			}
		}, START_TIMEOUT_MS);
	});
});

ipcMain.handle('playground:stop', async (_event, sitePath) => {
	const server = playgroundServers[sitePath];
	if (!server?.child) return { ok: true };
	try {
		// The runner spawns the PHP-WASM server under it, so the same tree kill the
		// quit sweep uses (#83) is what actually stops the site (#146).
		killChildTree(server.child);
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

ipcMain.handle('playground-web:start', async () => {
    if (playgroundWebServer?.child) {
        return { ok: true, url: playgroundWebServer.url || 'http://127.0.0.1:39372/' };
    }

    // If something is already listening on the desired port, treat it as started
    const expectedUrl = 'http://127.0.0.1:39372/';
    const reachable = await new Promise((resolve) => {
        try {
            const req = nodeHttp.get(expectedUrl, () => { try { req.destroy(); } catch {}; resolve(true); });
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
    const webDir = webDirCandidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
    if (!webDir) {
        return { ok: false, error: 'local-playground-web directory not found.' };
    }

    const runnerPath = path.join(__dirname, 'playground-web-runner.js');
    logEvent(WEB_LOG_SCOPE, `starting web server for ${webDir} on port 39372`);
    const child = spawnRunner(runnerPath, [webDir, '39372'], { cwd: webDir });
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
                const req = nodeHttp.get(expectedUrl, () => {
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
        killChildTree(playgroundWebServer.child);
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
	if (wpDebugWatchers[sitePath]?.fileWatcher || wpDebugWatchers[sitePath]?.dirWatcher) {
		return true;
	}
	const wpContentDir = path.join(sitePath, 'build', 'wp-content');
	const filePath = path.join(wpContentDir, 'debug.log');
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
