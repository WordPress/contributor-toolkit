const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
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

const WORDPRESS_ZIP_URL = 'https://github.com/WordPress/wordpress-develop/archive/refs/heads/trunk.zip';
const WORDPRESS_GIT_URL = 'https://github.com/WordPress/wordpress-develop.git';
const GUTENBERG_GIT_URL = 'https://github.com/WordPress/gutenberg.git';

const PROJECT_CONFIGS = {
	wordpress: {
		key: 'wordpress',
		displayName: 'WordPress Core',
		repoUrl: WORDPRESS_GIT_URL,
		upstreamSlug: 'WordPress/wordpress-develop',
		repoName: 'wordpress-develop',
		defaultBranch: 'trunk',
		defaultDir: 'wordpress-develop-trunk'
	},
	gutenberg: {
		key: 'gutenberg',
		displayName: 'Gutenberg',
		repoUrl: GUTENBERG_GIT_URL,
		upstreamSlug: 'WordPress/gutenberg',
		repoName: 'gutenberg',
		defaultBranch: 'trunk',
		defaultDir: 'gutenberg-trunk'
	}
};

const DEFAULT_SITE_TYPE = 'wordpress';
const GITHUB_CLIENT_ID = '05eaaa972c8117f72465'; // GitHub OAuth App Client ID for device flow

// GitHub authentication state
let githubToken = null;

// Load GitHub token from store on startup
async function loadGitHubToken() {
	const s = await getStore();
	githubToken = s.get('githubToken') || null;
}

// Save GitHub token to store
async function saveGitHubToken(token) {
	githubToken = token;
	const s = await getStore();
	if (token === null || token === undefined) {
		s.delete('githubToken');
	} else {
		s.set('githubToken', token);
	}
}

// Provide a PATH shim so npm's spawned scripts can find a 'node' binary that maps to Electron's Node
let nodeShimDir = null;
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
                const npmCmd = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${npmCliAbsPath}" %*\r\n`;
                const npxCmd = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${npxCliAbsPath}" %*\r\n`;
                fs.writeFileSync(path.join(nodeShimDir, 'npm.cmd'), npmCmd);
                fs.writeFileSync(path.join(nodeShimDir, 'npm.bat'), npmCmd);
                fs.writeFileSync(path.join(nodeShimDir, 'npx.cmd'), npxCmd);
                fs.writeFileSync(path.join(nodeShimDir, 'npx.bat'), npxCmd);
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

async function mergeSiteMeta(sitePath, updates = {}) {
	const s = await getStore();
	const meta = s.get('siteMeta') || {};
	const current = meta[sitePath] || {};
	const next = { ...current, ...updates };
	meta[sitePath] = next;
	s.set('siteMeta', meta);
	return next;
}

function resolveSiteType(metaEntry) {
	return metaEntry?.type === 'gutenberg' ? 'gutenberg' : DEFAULT_SITE_TYPE;
}

function findAvailableDirName(rootDir, baseName) {
	const sanitizedBase = baseName || project.defaultDir;
	let candidate = sanitizedBase;
	let counter = 2;
	while (fs.existsSync(path.join(rootDir, candidate))) {
		candidate = `${sanitizedBase}-${counter++}`;
	}
	return candidate;
}

function getProjectConfig(type) {
	return PROJECT_CONFIGS[type] || PROJECT_CONFIGS.wordpress;
}

/** @type {Record<string, import('child_process').ChildProcess>} */
const runningInstalls = {};
/** @type {Record<string, import('child_process').ChildProcess>} */
const runningScripts = {};
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
/** @type {Map<number, { aborted: boolean, controller?: AbortController | null }>} */
const submitPrAbortStates = new Map();

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
		width: 1440,
		height: 960,
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
	let baseOid = null;
	let baseRef = null;

	const tryResolve = async (ref) => {
		try {
			const oid = await git.resolveRef({ fs, dir, ref });
			return oid;
		} catch {
			return null;
		}
	};

	const candidateRefs = ['trunk', 'refs/heads/trunk', 'HEAD'];
	for (const ref of candidateRefs) {
		if (baseOid) break;
		const oid = await tryResolve(ref);
		if (oid) {
			baseOid = oid;
			baseRef = ref;
		}
	}

	if (!baseOid) {
		throw new Error('Unable to resolve local trunk for diff generation.');
	}

	// Add untracked files to the index (except those in .gitignore)
	const statusOpts = baseRef ? { fs, dir, ref: baseRef } : { fs, dir };
	const matrix = await git.statusMatrix(statusOpts);
	for (const [filepath, head, workdir, stage] of matrix) {
		if (head === 0 && workdir === 2 && stage === 0) {
			try {
				await git.add({ fs, dir, filepath });
			} catch (e) {}
		}
	}

	const matrixAfterAdd = await git.statusMatrix(statusOpts);
	const changed = matrixAfterAdd.filter(([filepath, head, workdir]) => head !== workdir);
	let patch = '';
	for (const [filepath, head, workdir] of changed) {
		const abs = require('path').join(dir, filepath);
		const workBuf = workdir ? await fs.promises.readFile(abs).catch(() => null) : null;
		const base = head && baseOid ? await git.readBlob({ fs, dir, oid: baseOid, filepath }).catch(() => null) : null;
		const a = base ? Buffer.from(base.blob).toString('utf8') : '';
		const b = workBuf ? workBuf.toString('utf8') : a;
		if (a === b) continue;
		if ((a.indexOf('\0') !== -1) || (b.indexOf('\0') !== -1)) continue;
		const filePatch = JsDiff.createTwoFilesPatch(`a/${filepath}`, `b/${filepath}`, a, b, '', '', { context: 3 });
		patch += filePatch + '\n';
	}
	return patch || 'No changes.';
}

// GitHub API helper functions
function githubAPI(path, options = {}) {
	return new Promise((resolve, reject) => {
		const url = new URL(path, 'https://api.github.com');
		const reqOptions = {
			hostname: url.hostname,
			path: url.pathname + url.search,
			method: options.method || 'GET',
			headers: {
				'User-Agent': 'WordPress-Dev-App',
				'Accept': 'application/vnd.github+json',
				...(githubToken && { 'Authorization': `Bearer ${githubToken}` }),
				...(options.headers || {})
			}
		};

		const req = https.request(reqOptions, (res) => {
			let data = '';
			res.on('data', (chunk) => data += chunk);
			res.on('end', () => {
				try {
					const json = JSON.parse(data);
					if (res.statusCode >= 200 && res.statusCode < 300) {
						resolve(json);
					} else {
						reject(new Error(json.message || `HTTP ${res.statusCode}`));
					}
				} catch (e) {
					reject(e);
				}
			});
		});

		req.on('error', reject);

		if (options.body) {
			req.write(JSON.stringify(options.body));
		}

		req.end();
	});
}

// GitHub Device OAuth Flow - uses github.com not api.github.com
function githubOAuthRequest(path, body) {
	return new Promise((resolve, reject) => {
		const data = JSON.stringify(body);
		const reqOptions = {
			hostname: 'github.com',
			path: path,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'Accept': 'application/json',
				'Content-Length': data.length
			}
		};

		const req = https.request(reqOptions, (res) => {
			let responseData = '';
			res.on('data', (chunk) => responseData += chunk);
			res.on('end', () => {
				try {
					resolve(JSON.parse(responseData));
				} catch (e) {
					reject(e);
				}
			});
		});

		req.on('error', reject);
		req.write(data);
		req.end();
	});
}

async function waitWithAbort(ms, shouldAbort) {
	const start = Date.now();
	while (Date.now() - start < ms) {
		if (typeof shouldAbort === 'function' && shouldAbort()) {
			const err = new Error('Aborted by user');
			err.code = 'PR_ABORTED';
			throw err;
		}
		const elapsed = Date.now() - start;
		const remaining = Math.max(ms - elapsed, 0);
		const slice = Math.min(remaining, 250);
		await new Promise((resolve) => setTimeout(resolve, slice));
	}
}

async function initiateDeviceOAuth() {
	const response = await githubOAuthRequest('/login/device/code', {
		client_id: GITHUB_CLIENT_ID,
		scope: 'repo'
	});

	return {
		device_code: response.device_code,
		user_code: response.user_code,
		verification_uri: response.verification_uri,
		expires_in: response.expires_in,
		interval: response.interval || 5
	};
}

async function pollDeviceOAuth(deviceCode, interval, shouldAbort) {
	if (typeof shouldAbort === 'function' && shouldAbort()) {
		throw new Error('Aborted by user');
	}
	const response = await githubOAuthRequest('/login/oauth/access_token', {
		client_id: GITHUB_CLIENT_ID,
		device_code: deviceCode,
		grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
	});

	if (response.error) {
		if (response.error === 'authorization_pending') {
			await waitWithAbort(interval * 1000, shouldAbort);
			return pollDeviceOAuth(deviceCode, interval, shouldAbort);
		}
		throw new Error(response.error_description || response.error);
	}

	return response.access_token;
}

// Check if user has a fork
async function checkForFork(username, repoName) {
	try {
		await githubAPI(`/repos/${username}/${repoName}`);
		return true;
	} catch {
		return false;
	}
}

// Create a fork
async function createFork(upstreamSlug) {
	await githubAPI(`/repos/${upstreamSlug}/forks`, {
		method: 'POST'
	});

	// Wait a bit for fork to be ready
	await new Promise(resolve => setTimeout(resolve, 3000));
}

// Get authenticated user
async function getAuthenticatedUser() {
	const user = await githubAPI('/user');
	return user.login;
}

// Submit PR workflow
async function submitPR(sitePath, projectConfig, onProgress, abortState) {
    try {
        const repoConfig = typeof projectConfig === 'string' ? getProjectConfig(projectConfig) : (projectConfig || getProjectConfig('wordpress'));
        const ensureNotAborted = () => {
            if (abortState?.aborted) {
                const err = new Error('Aborted by user');
                err.code = 'PR_ABORTED';
                throw err;
            }
        };
        const safeProgress = (payload) => {
            if (abortState?.aborted) return;
            onProgress(payload);
        };

        ensureNotAborted();
		// Step 1: Authenticate if needed (or if token is invalid)
		const needsAuth = async () => {
			ensureNotAborted();
			if (!githubToken) return true;
			// Test if token is valid
			try {
				await githubAPI('/user');
				return false;
			} catch (e) {
				// Token is invalid, clear it
				await saveGitHubToken(null);
				return true;
			}
		};

		if (await needsAuth()) {
			safeProgress({ step: 'auth', message: 'Starting GitHub authentication...' });
			const deviceAuth = await initiateDeviceOAuth();

			safeProgress({
				step: 'auth_code',
				message: `Please visit ${deviceAuth.verification_uri} and enter code: ${deviceAuth.user_code}`,
				verification_uri: deviceAuth.verification_uri,
				user_code: deviceAuth.user_code
			});

			githubToken = await pollDeviceOAuth(deviceAuth.device_code, deviceAuth.interval, () => abortState?.aborted);
			await saveGitHubToken(githubToken);
			safeProgress({ step: 'auth', message: 'Authenticated successfully!' });
		}

		// Step 2: Get username and check for fork
		safeProgress({ step: 'fork', message: 'Checking for fork...' });
		const username = await getAuthenticatedUser();
		const hasFork = await checkForFork(username, repoConfig.repoName);

		if (!hasFork) {
			safeProgress({ step: 'fork', message: 'Creating fork...' });
			await createFork(repoConfig.upstreamSlug);
				safeProgress({ step: 'fork', message: `Fork created: https://github.com/${username}/${repoConfig.repoName}` });
		} else {
			safeProgress({ step: 'fork', message: `Using existing fork: https://github.com/${username}/${repoConfig.repoName}` });
		}

		ensureNotAborted();

		// Step 3: Create a new branch with timestamp
		const branchName = `patch-${Date.now()}`;
		safeProgress({
			step: 'branch',
			message: `Creating branch: ${branchName}`,
			gitCommand: `git checkout -b ${branchName}`
		});

		await git.branch({ fs, dir: sitePath, ref: branchName, checkout: true });

		ensureNotAborted();

		// Step 4: Stage and commit all changes
		safeProgress({
			step: 'commit',
			message: 'Staging all changes...',
			gitCommand: 'git add .'
		});

		// First, unstage anything that is currently staged so we only commit what we explicitly add
		const allFiles = await git.statusMatrix({ fs, dir: sitePath });
		const stagedFiles = allFiles.filter(([, , , stage]) => stage === 2);
		for (const [filepath] of stagedFiles) {
			try {
				await git.resetIndex({ fs, dir: sitePath, filepath });
			} catch (e) {
				// Ignore errors
			}
		}

		ensureNotAborted();
		// Now get fresh status and add only the files we want
		const matrix = await git.statusMatrix({ fs, dir: sitePath });

		// Add untracked files (same as createMinimalPatchForDir)
		for (const [filepath, head, workdir, stage] of matrix) {
			// Skip .github/workflows/ files - they require special workflow scope
			if (filepath.startsWith('.github/workflows/')) {
				continue;
			}

			// If file is untracked (head=0, workdir=2, stage=0)
			if (head === 0 && workdir === 2 && stage === 0) {
				try {
					await git.add({ fs, dir: sitePath, filepath });
				} catch (e) {
					// Ignore errors for files that can't be added (e.g., in .gitignore)
				}
			}
		}

		// Now stage only files with actual changes (same logic as createMinimalPatchForDir)
		ensureNotAborted();
		const matrixAfterAdd = await git.statusMatrix({ fs, dir: sitePath });
		const changed = matrixAfterAdd.filter(([filepath, head, workdir]) => head !== workdir);
		for (const [filepath, head, workdir] of changed) {
			try {
				// Skip .github/workflows/ files - they require special workflow scope
				if (filepath.startsWith('.github/workflows/')) {
					continue;
				}

				// For deleted files (workdir === 0), use remove instead of add
				if (workdir === 0) {
					await git.remove({ fs, dir: sitePath, filepath });
				} else {
					await git.add({ fs, dir: sitePath, filepath });
				}
			} catch (e) {
				// Ignore errors for files that can't be staged
			}
		}

		const commitMessage = repoConfig.key === 'gutenberg' ? 'Gutenberg contribution' : 'WordPress core patch';
		const hasChanges = changed.length > 0;
		if (!hasChanges) {
			safeProgress({ step: 'commit', message: 'No changes detected. Skipping commit.' });
		} else {
			safeProgress({
				step: 'commit',
				message: 'Committing changes...',
				gitCommand: `git commit -m "${commitMessage}"`
			});

			ensureNotAborted();
			await git.commit({
				fs,
				dir: sitePath,
				message: commitMessage,
				author: {
					name: username,
					email: `${username}@users.noreply.github.com`
				}
			});
		}

		// Step 5: Add fork remote if it doesn't exist
		ensureNotAborted();
		const remotes = await git.listRemotes({ fs, dir: sitePath });
		const forkRemote = remotes.find(r => r.remote === 'fork');

		if (!forkRemote) {
			safeProgress({
				step: 'push',
				message: 'Adding fork remote...',
				gitCommand: `git remote add fork https://github.com/${username}/${repoConfig.repoName}.git`
			});
			ensureNotAborted();
			await git.addRemote({
				fs,
				dir: sitePath,
				remote: 'fork',
				url: `https://github.com/${username}/${repoConfig.repoName}.git`
			});
		}

		// Step 6: Push to fork
		const emitPushProgress = (payload) => {
			if (abortState?.aborted) return;
			safeProgress({
				step: 'push',
				timestamp: Date.now(),
				...payload
			});
		};
		emitPushProgress({
			message: `Pushing to fork...`,
			gitCommand: `git push fork ${branchName}`,
			logType: 'info'
		});

		ensureNotAborted();

		console.log('[git push] Starting push operation');
		console.log('[git push] Remote:', 'fork');
		console.log('[git push] Branch:', branchName);
		console.log('[git push] Token length:', githubToken ? githubToken.length : 0);

		let pushAbortController = null;
		try {
			pushAbortController = new AbortController();
			if (abortState) abortState.controller = pushAbortController;
			const pushResult = await git.push({
				fs,
				http,
				dir: sitePath,
				remote: 'fork',
				ref: branchName,
				signal: pushAbortController.signal,
				onAuth: () => {
					console.log('[git push] Auth callback invoked');
					return { username: githubToken, password: 'x-oauth-basic' };
				},
				onAuthFailure: ({ url, auth }) => {
					console.error('[git push] Auth failed for URL:', url);
					console.error('[git push] Auth used:', auth);
				},
				onAuthSuccess: ({ url, auth }) => {
					console.log('[git push] Auth succeeded for URL:', url);
				},
				onMessage: (msg) => {
					console.log('[git push message]', msg);
					const normalized = String(msg || '')
						.replace(/\r/g, '\n')
						.split(/\n+/)
						.map((line) => line.trim())
						.filter(Boolean);
					normalized.forEach((line) => emitPushProgress({ message: line, logType: 'remote' }));
				},
				onProgress: (evt) => {
					console.log('[git push progress]', evt);
					const { phase, loaded, total } = evt;
					if (phase) {
						const msg = total ? `${phase}: ${loaded}/${total}` : phase;
						emitPushProgress({ message: msg, logType: 'progress', phase, loaded, total });
					}
				}
			});
			console.log('[git push] Push completed successfully', pushResult);
		} catch (pushError) {
			console.error('[git push error]', pushError);
			console.error('[git push error stack]', pushError.stack);
			if (pushError.name === 'AbortError' || abortState?.aborted) {
				throw new Error('Aborted by user');
			}
			// If push fails with 403, it might be a token permission issue
			if (pushError.message && pushError.message.includes('403')) {
				throw new Error('Push failed: Token may not have correct permissions. Please re-authorize the app with full repository access.');
			}
			throw pushError;
		} finally {
			if (abortState) abortState.controller = null;
		}

		// Step 7: Open PR URL
		const prUrl = `https://github.com/${repoConfig.upstreamSlug}/compare/${repoConfig.defaultBranch}...${username}:${repoConfig.repoName}:${branchName}?expand=1`;
		safeProgress({ step: 'done', message: 'Opening PR page...', prUrl });

		return { ok: true, prUrl, branch: branchName };

	} catch (error) {
		return { ok: false, error: error.message };
	}
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

async function promptAndSavePatchFile(patchText) {
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

	await fs.promises.writeFile(filePath, patchText, 'utf8');
	return { ok: true, filePath };
}

ipcMain.handle('git:save-patch', async (_e, sitePath) => {
    try {
        const patch = await createMinimalPatchForDir(sitePath);
        return await promptAndSavePatchFile(patch);
    } catch (e) {
        return { ok: false, error: String(e) };
    }
});

ipcMain.handle('git:save-patch-content', async (_e, payload) => {
	try {
		const patchText = (payload && typeof payload.patch === 'string' && payload.patch.length)
			? payload.patch
			: await createMinimalPatchForDir(payload?.sitePath);
		return await promptAndSavePatchFile(patchText || 'No changes.');
	} catch (e) {
		return { ok: false, error: String(e) };
	}
});

ipcMain.handle('git:submit-pr', async (event, payload) => {
	const input = (payload && typeof payload === 'object' && 'sitePath' in payload) ? payload : { sitePath: payload };
	const sitePath = input?.sitePath;
	if (!sitePath) throw new Error('Missing site path for PR submission');
	const s = await getStore();
	const meta = s.get('siteMeta') || {};
	const entry = meta[sitePath] || {};
	const resolvedType = input.siteType || resolveSiteType(entry);
	const projectConfig = getProjectConfig(resolvedType);

	const abortState = { aborted: false, controller: null };
	submitPrAbortStates.set(event.sender.id, abortState);
	try {
		const result = await submitPR(sitePath, projectConfig, (progress) => {
			event.sender.send('git:submit-pr:progress', progress);
		}, abortState);
		return result;
	} finally {
		submitPrAbortStates.delete(event.sender.id);
	}
});

ipcMain.handle('git:submit-pr:abort', async (event) => {
	const abortState = submitPrAbortStates.get(event.sender.id);
	if (abortState) {
		abortState.aborted = true;
		if (abortState.controller && typeof abortState.controller.abort === 'function') {
			try { abortState.controller.abort(); } catch (e) {
				console.warn('[git push] abort signal failed', e && e.message ? e.message : e);
			}
		}
	}
	return true;
});

ipcMain.handle('github:clear-token', async () => {
	await saveGitHubToken(null);
	return true;
});

ipcMain.handle('github:is-connected', async () => {
	return githubToken !== null && githubToken !== undefined;
});

app.whenReady().then(async () => {
	await loadGitHubToken();
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

ipcMain.handle('sites:update-meta', async (_e, sitePath, updates = {}) => {
	if (!sitePath || typeof sitePath !== 'string') return null;
	return mergeSiteMeta(sitePath, updates);
});

ipcMain.handle('site:status', async (_e, sitePath) => {
	try {
		const nmDir = path.join(sitePath, 'node_modules');
		const hasNodeModules = fs.existsSync(nmDir) && (() => { try { return fs.readdirSync(nmDir).length > 0; } catch { return false; } })();

		const s = await getStore();
		const meta = s.get('siteMeta') || {};
		const m = meta[sitePath] || {};
		const siteType = resolveSiteType(m);

		if (siteType === 'gutenberg') {
			return {
				type: siteType,
				hasNodeModules,
				hasBuilt: false,
				skipInitWizard: false,
				initialized: Boolean(m.initialized),
				hasGutenbergDev: Boolean(m.gutenbergDevRan)
			};
		}

		const distDir = path.join(sitePath, 'build', 'wp-includes', 'js', 'dist');
		const hasBuilt = fs.existsSync(distDir);

		return { type: siteType, hasNodeModules, hasBuilt, skipInitWizard: Boolean(m.skipInitWizard), initialized: Boolean(m.initialized) };
	} catch (e) {
		return { type: DEFAULT_SITE_TYPE, hasNodeModules: false, hasBuilt: false, skipInitWizard: false, initialized: false };
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
			label: path.basename(sitePath),
			type: DEFAULT_SITE_TYPE
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

	const project = getProjectConfig('wordpress');

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
			url: project.repoUrl,
			dir: siteDir,
			singleBranch: true,
			depth: 1,
			ref: project.defaultBranch,
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
		meta[siteDir] = { initialized: false, createdAt: new Date().toISOString(), label: siteLabel, type: 'wordpress' };
		s.set('siteMeta', meta);
	}
	event.sender.send('download:status', { phase: 'done', target: siteDir, sitePath: siteDir });
	return siteDir;
});

ipcMain.handle('gutenberg:setup', async (event, destDir, options = {}) => {
	if (!destDir) {
		throw new Error('No destination directory specified');
	}

	await fse.ensureDir(destDir);

	const project = getProjectConfig('gutenberg');
	const requestedName = typeof options.siteName === 'string' ? options.siteName.trim() : '';
	const sanitizedName = requestedName.replace(/[\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').replace(/^-+|-+$/g, '') || project.defaultDir;
	const uniqueName = findAvailableDirName(destDir, sanitizedName);
	const siteDir = path.join(destDir, uniqueName);
	await fse.ensureDir(siteDir);
	event.sender.send('download:status', { phase: 'cloning', target: siteDir });
	await git.clone({
		http,
		fs,
		url: project.repoUrl,
		dir: siteDir,
		singleBranch: true,
		depth: 1,
		ref: project.defaultBranch,
		onProgress: (evt) => {
			const msg = `${evt.phase || 'clone'} ${evt.loaded || 0}/${evt.total || 0}`;
			event.sender.send('download:progress', { target: siteDir, message: msg });
		}
	});

	const s = await getStore();
	const sites = s.get('sites');
	if (!sites.includes(siteDir)) {
		sites.push(siteDir);
		s.set('sites', sites);
		const meta = s.get('siteMeta');
		const siteLabel = typeof options.siteLabel === 'string' && options.siteLabel.trim().length
			? options.siteLabel.trim()
			: uniqueName;
		meta[siteDir] = { initialized: false, createdAt: new Date().toISOString(), label: siteLabel, type: 'gutenberg' };
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

ipcMain.handle('dir:open', async (_e, directoryPath) => {
	if (!directoryPath) return false;
	const result = await shell.openPath(directoryPath);
	return result === '';
});

const editorCommands = {
	vscode: {
		darwin: 'code',
		linux: 'code',
		win32: 'code.cmd'
	},
	phpstorm: {
		darwin: '/Applications/PhpStorm.app/Contents/MacOS/phpstorm',
		linux: 'phpstorm',
		win32: 'phpstorm64.exe'
	},
	cursor: {
		darwin: '/Applications/Cursor.app/Contents/MacOS/Cursor',
		linux: 'cursor',
		win32: 'cursor.cmd'
	}
};

async function checkEditorAvailable(editor) {
	const platform = process.platform;
	const editorConfig = editorCommands[editor];

	if (!editorConfig) return false;

	const command = editorConfig[platform];
	if (!command) return false;

	// For macOS app bundles, check if the path exists
	if (platform === 'darwin' && command.startsWith('/Applications')) {
		try {
			await fs.promises.access(command, fs.constants.X_OK);
			return true;
		} catch {
			return false;
		}
	}

	// For command-line tools, try to find them in PATH
	return new Promise((resolve) => {
		const which = platform === 'win32' ? 'where' : 'which';
		const proc = spawn(which, [command], { stdio: 'ignore' });
		proc.on('close', (code) => resolve(code === 0));
		proc.on('error', () => resolve(false));
	});
}

ipcMain.handle('editor:check-available', async (_e) => {
	const editors = ['vscode', 'phpstorm', 'cursor'];
	const results = {};

	for (const editor of editors) {
		results[editor] = await checkEditorAvailable(editor);
	}

	return results;
});

ipcMain.handle('editor:open', async (_e, directoryPath, editor) => {
	if (!directoryPath || !editor) return { ok: false, error: 'Missing path or editor' };

	const platform = process.platform;
	const editorConfig = editorCommands[editor];

	if (!editorConfig) {
		return { ok: false, error: `Unknown editor: ${editor}` };
	}

	const command = editorConfig[platform];
	if (!command) {
		return { ok: false, error: `Editor ${editor} not supported on ${platform}` };
	}

	try {
		// Try to spawn the editor with the directory path
		const proc = spawn(command, [directoryPath], {
			detached: true,
			stdio: 'ignore'
		});
		proc.unref();
		return { ok: true };
	} catch (e) {
		return { ok: false, error: `Failed to open ${editor}: ${e.message}` };
	}
});

ipcMain.handle('url:open', async (_e, url) => {
	if (!url) return false;
	await shell.openExternal(url);
	return true;
});

ipcMain.handle('npm:install', async (event, directoryPath) => {
	if (!directoryPath) throw new Error('directoryPath is required');

	const installId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const runnerPath = path.join(__dirname, 'install-runner.js');

	const child = spawn(process.execPath, [runnerPath, directoryPath], {
		cwd: directoryPath,
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			NODE: process.execPath,
			npm_config_production: 'false',
			NODE_ENV: 'development',
			// On Windows, ensure both PATH and Path are set, and PATHEXT includes .CMD/.BAT
			PATH: process.platform === 'win32' ? `${ensureNodeShimDir()};${process.env.PATH || ''}` : `${ensureNodeShimDir()}:${process.env.PATH || ''}`,
			Path: process.platform === 'win32' ? `${ensureNodeShimDir()};${process.env.Path || process.env.PATH || ''}` : undefined,
			PATHEXT: process.platform === 'win32' ? [
				'.COM','.EXE','.BAT','.CMD','.VBS','.VBE','.JS','.JSE','.WSF','.WSH','.MSC'
			].join(';') : process.env.PATHEXT
		},
		shell: false,
		windowsHide: true
	});

	runningInstalls[installId] = child;

	child.stdout.on('data', (data) => {
		event.sender.send('npm:install:log', { installId, type: 'stdout', data: data.toString() });
	});
	child.stderr.on('data', (data) => {
		event.sender.send('npm:install:log', { installId, type: 'stderr', data: data.toString() });
	});
	child.on('close', (code) => {
		event.sender.send('npm:install:done', { installId, code });
		delete runningInstalls[installId];
	});

	return { installId };
});

ipcMain.handle('npm:run-script', async (event, directoryPath, scriptName, scriptArgs = []) => {
	if (!directoryPath) throw new Error('directoryPath is required');
	if (!scriptName) throw new Error('scriptName is required');

	const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
	const runnerPath = path.join(__dirname, 'script-runner.js');

	const child = spawn(process.execPath, [runnerPath, directoryPath, scriptName, ...scriptArgs], {
		cwd: directoryPath,
		env: {
			...process.env,
			ELECTRON_RUN_AS_NODE: '1',
			NODE: process.execPath,
			npm_config_production: 'false',
			NODE_ENV: 'development',
			PATH: process.platform === 'win32' ? `${ensureNodeShimDir()};${process.env.PATH || ''}` : `${ensureNodeShimDir()}:${process.env.PATH || ''}`,
			Path: process.platform === 'win32' ? `${ensureNodeShimDir()};${process.env.Path || process.env.PATH || ''}` : undefined,
			PATHEXT: process.platform === 'win32' ? [
				'.COM','.EXE','.BAT','.CMD','.VBS','.VBE','.JS','.JSE','.WSF','.WSH','.MSC'
			].join(';') : process.env.PATHEXT
		},
		shell: false,
		windowsHide: true
	});

	runningScripts[runId] = child;
	runIdByDirectory[directoryPath] = runId;

	child.stdout.on('data', (data) => {
		event.sender.send('npm:run-script:log', { runId, type: 'stdout', data: data.toString() });
	});
	child.stderr.on('data', (data) => {
		event.sender.send('npm:run-script:log', { runId, type: 'stderr', data: data.toString() });
	});
	child.on('close', (code) => {
		event.sender.send('npm:run-script:done', { runId, code });
		delete runningScripts[runId];
		if (runIdByDirectory[directoryPath] === runId) {
			delete runIdByDirectory[directoryPath];
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
		console.log("STDOUT", text);
		event.sender.send('playground:log', { sitePath, type: 'stdout', data: text });
		const match = text.match(/SERVER_URL:(.*)/);
		if (match && !resolved) {
			resolved = true;
			playgroundServers[sitePath].url = match[1].trim();
			console.log("URL", playgroundServers[sitePath].url);
			event.sender.send('playground:url', { sitePath, url: playgroundServers[sitePath].url });
			if (typeof pendingResolve === 'function') {
				clearTimeout(timeoutId);
				pendingResolve({ ok: true, url: playgroundServers[sitePath].url });
				pendingResolve = null;
			}
		}
	});
	child.stderr.on('data', (data) => {
		console.log("STDERR", data);
		event.sender.send('playground:log', { sitePath, type: 'stderr', data: String(data) });
	});
	child.on('error', (err) => {
		console.log("ERROR", err);
		event.sender.send('playground:log', { sitePath, type: 'stderr', data: String(err) + '\n' });
	});
	child.on('close', (code) => {
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
        try { broadcastToAll('playground-web:log', { type: 'stdout', data: text }); } catch {}
        const match = text.match(/WEB_SERVER_URL:(.*)/);
        if (match && !resolved) {
            resolved = true;
            playgroundWebServer.url = match[1].trim();
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
        try { broadcastToAll('playground-web:log', { type: 'stderr', data: String(data) }); } catch {}
    });
    child.on('error', (err) => {
        try { broadcastToAll('playground-web:log', { type: 'stderr', data: String(err) + '\n' }); } catch {}
    });
    child.on('close', (code) => {
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
