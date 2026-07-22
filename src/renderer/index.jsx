import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  TabPanel,
  Card,
  CardBody,
  Flex,
  DropdownMenu,
  Modal,
  TextControl,
  Spinner
} from '@wordpress/components';
import { plus, chevronLeft, chevronRight, copy as copyIcon, check as checkIcon, edit, download } from '@wordpress/icons';
import '@wordpress/components/build-style/style.css';
import { Terminal } from 'xterm';
import 'xterm/css/xterm.css';

const TERMINAL_ALLOWED_SCRIPTS = ['build', 'build:dev', 'dev', 'test', 'watch', 'grunt'];
const TERMINAL_INSTALL_ALIASES = ['npm install', 'npm i', 'install'];
const RENAME_INPUT_ID = 'rename-site-name-input';
const CREATE_SITE_NAME_INPUT_ID = 'create-site-name-input';
const CREATE_SITE_LOCATION_INPUT_ID = 'create-site-location-input';
const CREATE_SITE_LOCATION_HELP_ID = 'create-site-location-help';
const CREATE_SITE_MODAL_STYLE_ID = 'create-site-modal-theme';

function useSites() {
  const [sites, setSites] = useState([]);
  const [siteMeta, setSiteMeta] = useState({});
  const refresh = useCallback(async () => {
    const { sites: list, siteMeta: meta } = await window.api.getSitesWithMeta();
    setSites(list);
    setSiteMeta(meta || {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { sites, siteMeta, refresh, setSiteMeta, setSites };
}

function App() {
  const { sites, siteMeta, refresh, setSiteMeta, setSites } = useSites();
  const [downloadPhase, setDownloadPhase] = useState('');
  const [pendingSite, setPendingSite] = useState(null);
  const [terminalMsgs, setTerminalMsgs] = useState('');
  const termRef = useRef(null);
  const createDirInputRef = useRef(null);
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [terminalMsgs]);
  const [webStarting, setWebStarting] = useState(false);
  const [webUrl, setWebUrl] = useState('');
  const [webLogs, setWebLogs] = useState('');
  const [webError, setWebError] = useState('');
  const webLogRef = useRef(null);
  useEffect(() => { if (webLogRef.current) webLogRef.current.scrollTop = webLogRef.current.scrollHeight; }, [webLogs]);
  const [webAvailable, setWebAvailable] = useState(false);
  useEffect(() => { (async () => { try { setWebAvailable(Boolean(await window.api.playgroundWebAvailable())); } catch {} })(); }, []);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [feedbackFormUrl, setFeedbackFormUrl] = useState(null);
  useEffect(() => { (async () => { try { setFeedbackFormUrl(await window.api.getFeedbackFormUrl()); } catch {} })(); }, []);
  const [activeSite, setActiveSite] = useState(null);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSiteName, setCreateSiteName] = useState('');
  const [createSiteDir, setCreateSiteDir] = useState('');
  const [createSiteError, setCreateSiteError] = useState('');
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [setupLogsBySite, setSetupLogsBySite] = useState({});
  const setupLogAliasRef = useRef({});

  const appendSetupLog = useCallback((siteTarget, message) => {
    const key = siteTarget ? String(siteTarget) : '';
    if (!key) return;
    const chunk = message != null ? String(message) : '';
    if (!chunk) return;
    let resolvedKey = key;
    const aliasMap = setupLogAliasRef.current;
    const seen = new Set();
    while (resolvedKey && aliasMap[resolvedKey] && !seen.has(resolvedKey)) {
      seen.add(resolvedKey);
      resolvedKey = aliasMap[resolvedKey];
    }
    if (!resolvedKey) return;
    setSetupLogsBySite((prev) => {
      const prevText = prev[resolvedKey] || '';
      return { ...prev, [resolvedKey]: prevText + chunk };
    });
  }, []);

  const removeSetupLog = useCallback((siteTarget) => {
    const key = siteTarget ? String(siteTarget) : '';
    if (!key) return;
    const aliasMap = setupLogAliasRef.current;
    delete aliasMap[key];
    Object.keys(aliasMap).forEach((aliasKey) => {
      if (aliasMap[aliasKey] === key) delete aliasMap[aliasKey];
    });
    setSetupLogsBySite((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const moveSetupLog = useCallback((from, to) => {
    const source = from ? String(from) : '';
    const target = to ? String(to) : '';
    if (!source || !target || source === target) return;
    setupLogAliasRef.current[source] = target;
    setSetupLogsBySite((prev) => {
      if (!prev[source]) return prev;
      const next = { ...prev };
      const combined = (prev[target] || '') + prev[source];
      delete next[source];
      next[target] = combined;
      return next;
    });
  }, []);

  useEffect(() => {
    let styleEl = document.getElementById(CREATE_SITE_MODAL_STYLE_ID);
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = CREATE_SITE_MODAL_STYLE_ID;
      styleEl.textContent = `
.create-site-modal .components-modal__header-heading { color: #1d2327; }
.create-site-modal .components-modal__header { border-bottom: 1px solid #e2e4e7; }
.create-site-modal .components-modal__content { color: #1d2327; }
`;
      document.head.appendChild(styleEl);
    }
  }, []);

  useEffect(() => {
    if (!createModalOpen) return;
    const input = document.getElementById(CREATE_SITE_NAME_INPUT_ID);
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  }, [createModalOpen]);

  useEffect(() => {
    if (createModalOpen) return;
    if (createDirInputRef.current) {
      createDirInputRef.current.value = '';
    }
  }, [createModalOpen]);

  useEffect(() => {
    const unsubProg = window.api.subscribeSetupProgress((p) => {
      if (p && p.message) {
        setTerminalMsgs((v) => v + p.message + '\n');
        appendSetupLog(p.target, `${p.message}\n`);
      }
      if (p && p.target) setPendingSite({ targetDir: p.target });
    });
    const unsubStat = window.api.subscribeSetupStatus((s) => {
      if (!s) return;
      if (s.target) setPendingSite({ targetDir: s.target });
      const key = s.sitePath || s.target;
      if (key) {
        const phaseLabel = s.phase ? `Status: ${s.phase}` : 'Status update';
        appendSetupLog(key, `${phaseLabel}\n`);
        if (s.phase === 'done') appendSetupLog(key, 'Setup finished.\n');
      }
      if (s.phase === 'cloning') setDownloadPhase('Cloning repository…');
      else if (s.phase === 'done') { setDownloadPhase(''); setPendingSite(null); setTerminalMsgs(''); }
    });
    return () => { unsubProg && unsubProg(); unsubStat && unsubStat(); };
  }, [appendSetupLog]);

  const chooseAndSetup = useCallback(() => {
    setCreateSiteName('');
    setCreateSiteDir('');
    setCreateSiteError('');
    setCreateModalOpen(true);
  }, []);

  const sanitizeSiteFolder = useCallback((value) => (
    value
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/^-+|-+$/g, '')
      || 'wordpress-site'
  ), []);

  const resolveTargetDir = useCallback((root, folder) => {
    if (!root) return folder;
    const normalizedRoot = root.replace(/[\\/]+$/, '');
    const separator = /\\/.test(normalizedRoot) && !normalizedRoot.includes('/') ? '\\' : '/';
    return `${normalizedRoot}${separator}${folder}`;
  }, []);

  const openDirectoryPicker = useCallback(async () => {
    try {
      const dir = await window.api.chooseDirectory();
      if (dir) {
        setCreateSiteDir(dir);
        setCreateSiteError('');
      }
    } catch {}
  }, []);

  const handleCreateDirInputChange = useCallback((event) => {
    const inputEl = event.target;
    createDirInputRef.current = inputEl;
    const finalize = (rawDir) => {
      const normalized = typeof rawDir === 'string' ? rawDir.replace(/[\\/]+$/, '') : '';
      if (normalized) {
        setCreateSiteDir(normalized);
        setCreateSiteError('');
      } else {
        setCreateSiteDir('');
      }
    };
    const files = inputEl.files;
    if (!files || files.length === 0) {
      inputEl.value = '';
      return;
    }

    const first = files[0];
    const relative = first?.webkitRelativePath || '';
    const rawPath = first?.path || '';
    let resolved = '';

    if (rawPath) {
      if (relative) {
        resolved = rawPath.slice(0, rawPath.length - relative.length);
      } else {
        resolved = rawPath.replace(/[\\/][^\\/]*$/, '');
      }
    }

    if (!resolved && inputEl.value) {
      resolved = inputEl.value.replace(/[^\\/]*$/, '');
    }

    resolved = resolved.replace(/[\\/]+$/, '');
    finalize(resolved);
    inputEl.value = '';
  }, [setCreateSiteDir, setCreateSiteError]);

  const handleCreateSiteSubmit = useCallback(async () => {
    const nameTrimmed = createSiteName.trim();
    if (!nameTrimmed) {
      setCreateSiteError('Please provide a site name.');
      return;
    }
    if (!createSiteDir) {
      setCreateSiteError('Please choose where to create the site.');
      return;
    }

    const cleanFolder = sanitizeSiteFolder(nameTrimmed);
    const targetDir = resolveTargetDir(createSiteDir, cleanFolder);
    let finalSitePath = targetDir;
    const placeholderCreatedAt = new Date().toISOString();

    setSites((prev) => (prev.includes(targetDir) ? prev : [...prev, targetDir]));
    setSiteMeta((prev = {}) => ({
      ...prev,
      [targetDir]: {
        ...(prev[targetDir] || {}),
        label: nameTrimmed,
        createdAt: prev[targetDir]?.createdAt || placeholderCreatedAt,
        initialized: false
      }
    }));
    setActiveSite(targetDir);
    setCreateModalOpen(false);
    setCreateSiteName('');
    setCreateSiteDir('');

    try {
      setCreateSubmitting(true);
      setCreateSiteError('');
      setTerminalMsgs('');
      setPendingSite({ targetDir });
      appendSetupLog(targetDir, 'Starting site setup…\n');
      const createdPath = await window.api.setupWordPress(createSiteDir, { siteName: cleanFolder, siteLabel: nameTrimmed });
      if (createdPath) {
        finalSitePath = createdPath;
        if (createdPath !== targetDir) {
          setPendingSite({ targetDir: createdPath });
          moveSetupLog(targetDir, createdPath);
          setSites((prev) => {
            const filtered = prev.filter((path) => path !== targetDir);
            return filtered.includes(createdPath) ? filtered : [...filtered, createdPath];
          });
          setSiteMeta((prev = {}) => {
            const next = { ...prev };
            const placeholder = next[targetDir] || { createdAt: placeholderCreatedAt, initialized: false };
            delete next[targetDir];
            next[createdPath] = {
              ...placeholder,
              label: nameTrimmed,
              createdAt: placeholder.createdAt || placeholderCreatedAt,
              initialized: false
            };
            return next;
          });
        }
      }
      await refresh();
      setActiveSite(finalSitePath);
      appendSetupLog(finalSitePath, 'Site setup request completed.\n');
    } catch (e) {
      setPendingSite(null);
      setCreateSiteError(String(e));
      appendSetupLog(targetDir, `Setup failed: ${String(e)}\n`);
      setSites((prev) => prev.filter((path) => path !== targetDir));
      setSiteMeta((prev = {}) => {
        if (!prev[targetDir]) return prev;
        const next = { ...prev };
        delete next[targetDir];
        return next;
      });
    } finally {
      setCreateSubmitting(false);
    }
  }, [appendSetupLog, createSiteDir, createSiteName, moveSetupLog, refresh, resolveTargetDir, sanitizeSiteFolder, setSiteMeta, setSites]);

  const closeCreateModal = useCallback(() => {
    if (createSubmitting) return;
    setCreateModalOpen(false);
  }, [createSubmitting]);

  const handleCreateModalSubmit = useCallback((event) => {
    event.preventDefault();
    handleCreateSiteSubmit();
  }, [handleCreateSiteSubmit]);

  const handleCreateModalKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeCreateModal();
    }
  }, [closeCreateModal]);

  const handleCreateDirInputClick = useCallback((event) => {
    event.preventDefault();
    void openDirectoryPicker();
  }, [openDirectoryPicker]);

  const togglePlaygroundWeb = useCallback(async () => {
    if (!webUrl) {
      setWebStarting(true);
      setWebError('');
      setWebLogs('');
      try {
        const res = await window.api.startPlaygroundWeb(
          ({ data }) => setWebLogs((v) => v + String(data)),
          (url) => { const u = (url || 'http://127.0.0.1:39372/').replace(/\/$/,'/'); setWebUrl(u); setWebStarting(false); },
          (payload) => { setWebUrl(''); if (payload && typeof payload.code === 'number' && payload.code !== 0) setWebError(`Server exited with code ${payload.code}`); }
        );
        if (res && res.ok && res.url) {
          const u = String(res.url).replace(/\/$/,'/');
          setWebUrl(u);
          setWebStarting(false);
        } else if (!res || !res.ok) {
          setWebStarting(false);
          if (res && res.error) { setWebError(String(res.error)); }
        }
      } catch (e) {
        setWebStarting(false);
        setWebError(String(e));
      }
    } else {
      try { await window.api.stopPlaygroundWeb(); } catch {}
      setWebUrl('');
    }
  }, [webUrl]);

  const onInitialized = useCallback((sitePath) => {
    setSiteMeta((m) => ({ ...(m || {}), [sitePath]: { ...(m?.[sitePath] || {}), initialized: true } }));
  }, [setSiteMeta]);

  const onForget = useCallback(async (sitePath) => {
    await window.api.forgetSite(sitePath);
    await refresh();
    removeSetupLog(sitePath);
  }, [refresh, removeSetupLog]);

  const onDelete = useCallback(async (sitePath) => {
    await window.api.deleteSite(sitePath);
    await refresh();
    removeSetupLog(sitePath);
  }, [refresh, removeSetupLog]);

  const onRename = useCallback(async (sitePath, newLabel) => {
    try {
      await window.api.setSiteLabel(sitePath, newLabel);
      setSiteMeta((meta) => ({
        ...(meta || {}),
        [sitePath]: { ...(meta?.[sitePath] || {}), label: newLabel }
      }));
    } catch (err) {
      alert(String(err));
    }
  }, [setSiteMeta]);

  const sortedSites = useMemo(() => {
    if (!sites || !sites.length) return [];
    const getCreatedAt = (sitePath) => {
      const value = siteMeta?.[sitePath]?.createdAt;
      if (!value) return 0;
      const timestamp = new Date(value).getTime();
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    return [...sites].sort((a, b) => getCreatedAt(b) - getCreatedAt(a));
  }, [sites, siteMeta]);

  useEffect(() => {
    if (!sortedSites.length) {
      setActiveSite(null);
      return;
    }
    setActiveSite((current) => (current && sortedSites.includes(current) ? current : sortedSites[0]));
  }, [sortedSites]);

  const handleSelectSite = useCallback((sitePath) => {
    setActiveSite(sitePath);
  }, []);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>
      <div style={{ width: sidebarCollapsed ? 56 : 280, background: '#1f1f1f', color: '#f7f7f7', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease', borderRight: '1px solid #2b2b2b' }}>
        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '16px', borderBottom: '1px solid #2b2b2b' }}>
          <Flex align="center" justify="space-between">
            {!sidebarCollapsed ? (<div style={{ fontWeight: 600 }}>WordPress Core</div>) : null}
            <Button
              icon={sidebarCollapsed ? chevronRight : chevronLeft}
              onClick={() => setSidebarCollapsed((v) => !v)}
              variant="tertiary"
              aria-label={sidebarCollapsed ? 'Expand site list' : 'Collapse site list'}
              isSmall
              style={{ color: '#f7f7f7' }}
            >
              {!sidebarCollapsed ? 'Collapse' : null}
            </Button>
          </Flex>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: sidebarCollapsed ? '12px 8px' : '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedSites.length > 0 ? sortedSites.map((sitePath) => {
            const meta = siteMeta?.[sitePath] || {};
            const siteName = (meta.label && meta.label.trim()) || sitePath.split('/').pop() || sitePath;
            const createdLabel = meta.createdAt ? new Date(meta.createdAt).toLocaleString() : '';
            const isActive = activeSite === sitePath;
            const statusLabel = meta.initialized ? 'Initialized' : 'Not initialized';
            return (
              <Button
                key={sitePath}
                onClick={() => handleSelectSite(sitePath)}
                variant="tertiary"
                isSmall
                isPressed={isActive}
                style={{
                  width: '100%',
                  justifyContent: sidebarCollapsed ? 'center' : 'flex-start',
                  background: isActive ? 'rgba(255,255,255,0.16)' : 'transparent',
                  border: '1px solid rgba(255,255,255,0.18)',
                  color: '#f7f7f7',
                  padding: sidebarCollapsed ? '8px 0' : '10px 12px',
                  borderRadius: 6,
                }}
              >
                {sidebarCollapsed ? (
                  <span style={{ fontWeight: 600 }}>{siteName.slice(0, 1).toUpperCase()}</span>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{siteName}</span>
                  </div>
                )}
              </Button>
            );
          }) : (!sidebarCollapsed ? (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>No sites yet.</div>
          ) : null)}
        </div>
        <div
          style={{
            padding: sidebarCollapsed ? '12px 8px 20px' : '16px 16px 24px',
            borderTop: '1px solid #2b2b2b'
          }}
        >
          <Button
            icon={plus}
            variant="primary"
            onClick={chooseAndSetup}
            style={{ width: '100%', justifyContent: 'center' }}
            aria-label="Create WordPress Core site"
          >
            {!sidebarCollapsed ? 'Create WordPress Core site' : null}
          </Button>
        </div>
      </div>
      <div style={{ flex: 1, background: '#fff', color: '#1d2327', display: 'flex', flexDirection: 'column' }}>
        <div style={{ flex: 1, overflowY: 'auto', padding: '32px 32px 48px' }}>
          <div style={{ maxWidth: 1040, margin: '0 auto' }}>
            {webAvailable ? (
              <Flex align="center" justify="flex-end" style={{ gap: 8, marginBottom: 24 }}>
                <Button
                  isBusy={webStarting}
                  variant={webUrl ? 'secondary' : 'primary'}
                  onClick={togglePlaygroundWeb}
                >{webUrl ? 'Stop Playground web server' : 'Start Playground web server'}</Button>
                {webStarting || webUrl ? (
                  <span style={{ fontSize: 12 }}>
                    {webStarting ? 'Starting…' : (
                      <a href={webUrl || 'http://127.0.0.1:39372/'} onClick={(e) => { e.preventDefault(); window.api.openExternal(webUrl || 'http://127.0.0.1:39372/'); }}>{webUrl || 'http://127.0.0.1:39372/'}</a>
                    )}
                  </span>
                ) : null}
              </Flex>
            ) : null}

            {/* Playground web server status + logs */}
            {(webStarting || webUrl || webError || webLogs) ? (
              <Card style={{ marginBottom: 24 }}>
                <CardBody>
                  <div style={{ display:'flex', alignItems:'center', gap:8, justifyContent:'space-between' }}>
                    <div style={{ fontWeight: 600 }}>Playground web server</div>
                    <div style={{ fontSize:12, color:'#666' }}>
                      {webStarting ? 'Starting…' : (webUrl ? (
                        <a href={webUrl} onClick={(e)=>{ e.preventDefault(); window.api.openExternal(webUrl); }}>{webUrl}</a>
                      ) : 'Stopped')}
                    </div>
                  </div>
                  {webError ? (<div style={{ marginTop:6, color:'#C00', fontSize:12 }}>{webError}</div>) : null}
                  <div ref={webLogRef} style={{ marginTop:8, whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:8, borderRadius:6, height:140, overflow:'auto' }}>{webLogs}</div>
                </CardBody>
              </Card>
            ) : null}

            <div id="sites">
              {pendingSite && (
                <Card style={{ marginBottom: 24 }}>
                  <CardBody>
                    <div style={{ fontWeight: 600 }}>Setting up new site…</div>
                    {downloadPhase && <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>{downloadPhase}</div>}
                    <div ref={termRef} style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 8, borderRadius: 6, height: 140, overflow: 'auto' }}>{terminalMsgs}</div>
                  </CardBody>
                </Card>
              )}

              {sortedSites.length > 0 ? (
                sortedSites.map((s) => (
                  <div
                    key={s}
                    style={{ display: activeSite === s ? 'block' : 'none' }}
                    aria-hidden={activeSite === s ? false : true}
                  >
                    <SiteRow
                      sitePath={s}
                      initialized={Boolean(siteMeta?.[s]?.initialized)}
                      createdAt={siteMeta?.[s]?.createdAt}
                      label={siteMeta?.[s]?.label}
                      onInitialized={onInitialized}
                      onForget={onForget}
                      onDelete={onDelete}
                      onRename={onRename}
                      isPending={Boolean(pendingSite && pendingSite.targetDir === s)}
                      setupLogs={setupLogsBySite[s] || ''}
                      feedbackFormUrl={feedbackFormUrl}
                    />
                  </div>
                ))
              ) : (
                <Card>
                  <CardBody>
                    <div style={{ marginBottom: 8 }}>No sites yet.</div>
                    <div>Use the sidebar to create your first site.</div>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
      {createModalOpen ? (
        <Modal
          className="create-site-modal"
          title="Create WordPress Core site"
          onRequestClose={closeCreateModal}
          shouldCloseOnClickOutside={!createSubmitting}
        >
          <form
            onSubmit={handleCreateModalSubmit}
            onKeyDown={handleCreateModalKeyDown}
            style={{ display: 'flex', flexDirection: 'column', gap: 16, color: '#1d2327', colorScheme: 'light' }}
          >
            <TextControl
              id={CREATE_SITE_NAME_INPUT_ID}
              label="Site name"
              value={createSiteName}
              onChange={(value) => setCreateSiteName(value)}
              disabled={createSubmitting}
              placeholder="My WordPress site"
              autoFocus
            />
            <label htmlFor={CREATE_SITE_LOCATION_INPUT_ID} style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em', color: '#1d2327' }}>Site location</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <input
                ref={createDirInputRef}
                id={CREATE_SITE_LOCATION_INPUT_ID}
                type="file"
                webkitdirectory=""
                directory=""
                multiple
                onChange={handleCreateDirInputChange}
                onClick={handleCreateDirInputClick}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    void openDirectoryPicker();
                  }
                }}
                disabled={createSubmitting}
                aria-describedby={CREATE_SITE_LOCATION_HELP_ID}
                style={{ height: 40, color: '#1d2327', background: '#fff', border: '1px solid #8c8f94', borderRadius: 4, padding: '6px 10px' }}
              />
              <span style={{ fontSize: 12, color: '#3c434a' }}>{createSiteDir || 'No folder selected yet.'}</span>
            </div>
            <div id={CREATE_SITE_LOCATION_HELP_ID} style={{ fontSize: 12, color: '#3c434a', marginTop: -4 }}>
              Choose the parent folder where you want this new site created. We&apos;ll add a new directory inside it for the project.
            </div>
            {createSiteError ? (
              <div style={{ color: '#d63638', fontSize: 12 }}>{createSiteError}</div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button type="button" variant="secondary" onClick={closeCreateModal} disabled={createSubmitting}>Cancel</Button>
              <Button type="submit" variant="primary" isBusy={createSubmitting} disabled={createSubmitting}>Create site</Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}

function SiteRow({ sitePath, initialized, createdAt, label, onInitialized, onForget, onDelete, onRename, setupLogs = '', feedbackFormUrl }) {
  const safeOnRename = onRename || (() => {});
  // state
  const [serverUrl, setServerUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [npmLogs, setNpmLogs] = useState('');
  const [runtimeLogs, setRuntimeLogs] = useState('');
  const [isPatchOpen, setIsPatchOpen] = useState(false);
  const [patchText, setPatchText] = useState('');
  const [patchLoading, setPatchLoading] = useState(false);
  const [emails, setEmails] = useState([]);
  const [smtpPort, setSmtpPort] = useState(0);
  const newEmailUnsubRef = useRef(null);
  const smtpStartedUnsubRef = useRef(null);
  const [isEmailOpen, setIsEmailOpen] = useState(false);
  const [activeEmail, setActiveEmail] = useState(null);
  const [emailViewTab, setEmailViewTab] = useState('rendered');
  const [building, setBuilding] = useState(false);
  const [hasNodeModules, setHasNodeModules] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
  const [skipInit, setSkipInit] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  const [waitingForWatch, setWaitingForWatch] = useState(false);
  const setupLogsRef = useRef('');

  // sticky refs per log
  const npmRef = useRef(null);
  const runtimeRef = useRef(null);
  const currentRunIdRef = useRef(null);
  const threshold = 8;
  const [logStick, setLogStick] = useState({ npm: true, runtime: true });
  const updateStick = useCallback((key, value) => {
    setLogStick((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  const ensureStick = useCallback((key) => {
    setLogStick((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);
  useEffect(() => { if (logStick.npm && npmRef.current) npmRef.current.scrollTop = npmRef.current.scrollHeight; }, [npmLogs, logStick.npm]);
  useEffect(() => { if (logStick.runtime && runtimeRef.current) runtimeRef.current.scrollTop = runtimeRef.current.scrollHeight; }, [runtimeLogs, logStick.runtime]);
  const makeOnScroll = useCallback((key) => (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - threshold;
    updateStick(key, atBottom);
  }, [threshold, updateStick]);

  const siteName = sitePath.split('/').pop();
  const displayName = (label && label.trim()) || siteName;
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const [renameValue, setRenameValue] = useState(displayName);
  const [renameError, setRenameError] = useState('');
  const [renaming, setRenaming] = useState(false);
  useEffect(() => { setRenameValue(displayName); }, [displayName]);
  useEffect(() => {
    if (!renameModalOpen) return;
    const input = document.getElementById(RENAME_INPUT_ID);
    if (input) {
      input.focus();
      if (typeof input.select === 'function') input.select();
    }
  }, [renameModalOpen]);

  const openRenameModal = useCallback(() => {
    setRenameValue(displayName);
    setRenameError('');
    setRenameModalOpen(true);
  }, [displayName]);

  const closeRenameModal = useCallback(() => {
    if (renaming) return;
    setRenameModalOpen(false);
  }, [renaming]);

  const submitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setRenameError('Site name cannot be empty.');
      return;
    }
    try {
      setRenaming(true);
      setRenameError('');
      await safeOnRename(sitePath, trimmed);
      setRenameModalOpen(false);
    } catch (err) {
      setRenameError(String(err));
    } finally {
      setRenaming(false);
    }
  }, [renameValue, safeOnRename, sitePath]);

  const handleRenameSubmit = useCallback((event) => {
    event.preventDefault();
    submitRename();
  }, [submitRename]);

  const handleRenameFormKeyDown = useCallback((event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeRenameModal();
    }
  }, [closeRenameModal]);
  const createdLabel = createdAt ? new Date(createdAt).toLocaleString() : '';
  const [pathCopied, setPathCopied] = useState(false);
  const copyTimeoutRef = useRef(null);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  const copyPath = useCallback(async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this environment');
      }
      await navigator.clipboard.writeText(sitePath);
      setPathCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setPathCopied(false), 1500);
    } catch (err) {
      alert('Unable to copy path: ' + (err?.message ?? String(err)));
    }
  }, [sitePath]);

  const appendNpm = useCallback((s)=>setNpmLogs((v)=>v+s),[]);
  const appendRuntime = useCallback((s)=>setRuntimeLogs((v)=>v + String(s ?? '')),[]);
  const sortEmails = useCallback((list)=>[...list].sort((a,b)=>new Date(b.sentAt||b.date||0)-new Date(a.sentAt||a.date||0)),[]);
  const openEmail = useCallback((m)=>{ setActiveEmail(m); setEmailViewTab('rendered'); setIsEmailOpen(true); },[]);
  const clearEmails = useCallback(async ()=>{ await window.api.clearEmails(sitePath); setEmails([]); }, [sitePath]);
  const loadStatus = useCallback(async ()=>{
    try {
      setStatusLoading(true);
      const s = await window.api.getSiteStatus(sitePath);
      setHasNodeModules(Boolean(s?.hasNodeModules));
      setHasBuilt(Boolean(s?.hasBuilt));
      setSkipInit(Boolean(s?.skipInitWizard));
    } catch {}
    finally { setStatusLoading(false); }
  }, [sitePath]);
  useEffect(()=>{ loadStatus(); }, [loadStatus]);

  const runInstall = useCallback((options = {}) => {
    const { onLog, onDone } = options;
    setInstalling(true);
    ensureStick('npm');
    window.api.runNpmInstall(sitePath, ({ data }) => {
      appendNpm(data);
      if (onLog) onLog(data);
    }, async ({ code }) => {
      appendNpm(`\ninstall exited with code ${code}\n`);
      setInstalling(false);
      /**
       * Still let us through when this happens on Windows:
       * 
       * npm verbose stack Error: command failed
       * npm verbose stack     at promiseSpawn (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\@npmcli\\promise-spawn\\lib\\index.js:22:22)
       * npm verbose stack     at spawnWithShell (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\@npmcli\\promise-spawn\\lib\\index.js:124:10)
       * npm verbose stack     at promiseSpawn (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\@npmcli\\promise-spawn\\lib\\index.js:12:12)
       * npm verbose stack     at runScriptPkg (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\@npmcli\\run-script\\lib\\run-script-pkg.js:79:13)
       * npm verbose stack     at runScript (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\@npmcli\\run-script\\lib\\run-script.js:9:12)
       * npm verbose stack     at C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\@npmcli\\arborist\\lib\\arborist\\rebuild.js:329:17
       * npm verbose stack     at run (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\promise-call-limit\\dist\\commonjs\\index.js:67:22)
       * npm verbose stack     at C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\promise-call-limit\\dist\\commonjs\\index.js:84:9
       * npm verbose stack     at new Promise (<anonymous>)
       * npm verbose stack     at callLimit (C:\\Users\\Adam\\AppData\\Local\\Programs\\electron-setup-wordpress-core\\resources\\app.asar\\node_modules\\npm\\node_modules\\promise-call-limit\\dist\\commonjs\\index.js:35:69)
       * npm verbose pkgid core-js-pure@3.35.1
       * npm error code 1
       * npm error path C:\\wp\\wordpress-develop-trunk\\node_modules\\core-js-pure
       * 
       * @TODO: Do not mark as initialized if the installation fails.
       */
      if (1 || code === 0) { try { await window.api.markSiteInitialized(sitePath); } catch {} onInitialized(sitePath); }
      try { await loadStatus(); } catch {}
      if (onDone) onDone({ code });
    });
  }, [appendNpm, ensureStick, loadStatus, onInitialized, sitePath]);

  const runScript = useCallback((name, options = {}) => {
    const { onLog, onDone, args = [] } = options;
    ensureStick('npm');
    if (name === 'build') setBuilding(true);
    currentRunIdRef.current = null;
    return window.api.runNpmScript(sitePath, name, args, ({ data }) => {
      appendNpm(data);
      if (onLog) onLog(data);
    }, async ({ code }) => {
      appendNpm(`\n${name} exited with code ${code}\n`);
      if (name === 'build') {
        setBuilding(false);
        try { await loadStatus(); } catch {}
      }
      currentRunIdRef.current = null;
      if (onDone) onDone({ code });
    }).then(({ runId }) => {
      currentRunIdRef.current = runId;
    }).catch((error) => {
      currentRunIdRef.current = null;
      appendNpm(`\nFailed to start npm run ${name}: ${error && error.message ? error.message : String(error)}\n`);
      if (name === 'build') setBuilding(false);
      if (onDone) onDone({ code: -1 });
    });
  }, [appendNpm, ensureStick, loadStatus, sitePath]);

  const killCurrent = useCallback(async () => {
    const runId = currentRunIdRef.current;
    try {
      await window.api.npmKill({ runId, directoryPath: sitePath });
    } finally {
      currentRunIdRef.current = null;
    }
  }, [sitePath]);

  // terminal refs/state (after run helpers so dependencies are available)
  const terminalContainerRef = useRef(null);
  const terminalRef = useRef(null);
  const terminalStickRef = useRef(true);
  const terminalInputHandlerRef = useRef(() => {});
  const terminalKillRef = useRef(null);
  const terminalStateRef = useRef({ input: '', history: [], historyIndex: 0, running: false });
  const watchBufferRef = useRef('');
  const serverStartRequestedRef = useRef(false);
  const stoppingRef = useRef(false);
  const runningRef = useRef(false);
  const waitingForWatchRef = useRef(false);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { waitingForWatchRef.current = waitingForWatch; }, [waitingForWatch]);

  const normalizeForTerminal = useCallback((text) => String(text ?? '').replace(/\r?\n/g, '\r\n'), []);

  const writeToTerminal = useCallback((text) => {
    const term = terminalRef.current;
    if (!term) return;
    term.write(normalizeForTerminal(text));
    if (terminalStickRef.current) term.scrollToBottom();
  }, [normalizeForTerminal]);

  const runInstallWithTerminal = useCallback(() => {
    writeToTerminal('Running npm install…\n');
    runInstall({
      onLog: (chunk) => writeToTerminal(chunk),
      onDone: ({ code }) => {
        writeToTerminal(`npm install exited with code ${code}\n`);
      }
    });
  }, [runInstall, writeToTerminal]);

  const showPrompt = useCallback((prependNewLine = true) => {
    const term = terminalRef.current;
    if (!term) return;
    const state = terminalStateRef.current;
    if (prependNewLine) term.write('\r\n');
    term.write('$ ');
    state.input = '';
    state.historyIndex = state.history.length;
    if (terminalStickRef.current) term.scrollToBottom();
  }, []);

  const replaceTerminalInput = useCallback((next) => {
    const term = terminalRef.current;
    if (!term) return;
    const state = terminalStateRef.current;
    const current = state.input;
    if (current && current.length) {
      for (let i = 0; i < current.length; i += 1) {
        term.write('\b \b');
      }
    }
    state.input = next;
    if (next) term.write(next);
    if (terminalStickRef.current) term.scrollToBottom();
  }, []);

  const addCommandToHistory = useCallback((value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    const state = terminalStateRef.current;
    if (state.history[state.history.length - 1] === trimmed) {
      state.historyIndex = state.history.length;
      return;
    }
    const nextHistory = [...state.history, trimmed];
    if (nextHistory.length > 50) nextHistory.shift();
    state.history = nextHistory;
    state.historyIndex = nextHistory.length;
  }, []);

  const printHelp = useCallback(() => {
    writeToTerminal('Available commands:\n');
    writeToTerminal('  help                        Show this help text\n');
    writeToTerminal('  npm install                 Run npm install in the site directory\n');
    writeToTerminal('  npm run <script>            Run one of: ' + TERMINAL_ALLOWED_SCRIPTS.join(', ') + '\n');
  }, [writeToTerminal]);

  const executeTerminalCommand = useCallback((rawCommand) => {
    const command = rawCommand.trim();
    const state = terminalStateRef.current;
    if (!command) {
      showPrompt(false);
      return;
    }

    addCommandToHistory(command);

    if (state.running) {
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
      return;
    }

    if (command === 'help') {
      printHelp();
      showPrompt(false);
      return;
    }

    const lower = command.toLowerCase();
    if (TERMINAL_INSTALL_ALIASES.includes(lower)) {
      state.running = true;
      terminalKillRef.current = () => { killCurrent().catch(() => {}); };
      writeToTerminal('Running npm install…\n');
      runInstall({
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          writeToTerminal(`npm install exited with code ${code}\n`);
          state.running = false;
          terminalKillRef.current = null;
          showPrompt(false);
        }
      });
      return;
    }

    if (lower.startsWith('npm run ')) {
      const script = command.slice(8).trim();
      if (!script) {
        writeToTerminal('Missing script name. Example: npm run build\n');
        showPrompt(false);
        return;
      }
      if (!TERMINAL_ALLOWED_SCRIPTS.includes(script)) {
        writeToTerminal(`Unsupported script "${script}". Allowed scripts: ${TERMINAL_ALLOWED_SCRIPTS.join(', ')}\n`);
        showPrompt(false);
        return;
      }
      state.running = true;
      terminalKillRef.current = () => { killCurrent().catch(() => {}); };
      writeToTerminal(`Running npm run ${script}…\n`);
      runScript(script, {
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          writeToTerminal(`npm run ${script} exited with code ${code}\n`);
          state.running = false;
          terminalKillRef.current = null;
          showPrompt(false);
        }
      });
      return;
    }

    writeToTerminal(`Unsupported command: ${command}\nTry "help" for the list of supported commands.\n`);
    showPrompt(false);
  }, [addCommandToHistory, killCurrent, printHelp, runInstall, runScript, showPrompt, writeToTerminal]);

  const handleTerminalData = useCallback((data) => {
    const term = terminalRef.current;
    if (!term) return;
    const state = terminalStateRef.current;

    if (data === '\u0003') { // Ctrl+C
      term.write('^C\r\n');
      state.input = '';
      state.historyIndex = state.history.length;
      if (state.running) {
        if (terminalKillRef.current) terminalKillRef.current();
      } else {
        showPrompt(false);
      }
      return;
    }

    if (state.running) {
      // Ignore all other input while command is running
      return;
    }

    if (data === '\r') { // Enter
      const current = state.input;
      state.input = '';
      term.write('\r\n');
      state.historyIndex = state.history.length;
      executeTerminalCommand(current);
      return;
    }

    if (data === '\u007f') { // Backspace
      if (state.input.length > 0) {
        state.input = state.input.slice(0, -1);
        term.write('\b \b');
      }
      return;
    }

    if (data === '\u001b[A' || data === '\u001b[B') { // history navigation
      if (!state.history.length) return;
      if (data === '\u001b[A') {
        state.historyIndex = Math.max(0, state.historyIndex - 1);
      } else {
        state.historyIndex = Math.min(state.history.length, state.historyIndex + 1);
      }
      const nextValue = state.historyIndex >= state.history.length ? '' : state.history[state.historyIndex];
      replaceTerminalInput(nextValue);
      return;
    }

    if (data.startsWith('\u001b')) {
      // Ignore other escape sequences
      return;
    }

    state.input += data;
    term.write(data);
    if (terminalStickRef.current) term.scrollToBottom();
  }, [executeTerminalCommand, replaceTerminalInput, showPrompt]);

  useEffect(() => {
    terminalInputHandlerRef.current = handleTerminalData;
  }, [handleTerminalData]);

  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return undefined;
    const term = new Terminal({
      rows: 12,
      cursorBlink: true,
      scrollback: 4000,
      convertEol: false,
      theme: { background: '#111', foreground: '#f5f5f5' },
      fontFamily: 'Menlo, Monaco, Consolas, "Courier New", monospace',
      fontSize: 13
    });
    terminalRef.current = term;
    term.open(container);
    term.write(normalizeForTerminal('WordPress npm helper terminal.\n'));
    printHelp();
    showPrompt(false);
    const dataDisposable = term.onData((d) => terminalInputHandlerRef.current(d));
    const scrollDisposable = term.onScroll(() => {
      const buffer = term.buffer.active;
      const atBottom = buffer.baseY + buffer.cursorY >= buffer.length - term.rows;
      terminalStickRef.current = atBottom;
    });
    return () => {
      dataDisposable.dispose();
      scrollDisposable.dispose();
      term.dispose();
      terminalRef.current = null;
      terminalStickRef.current = true;
    };
  }, [normalizeForTerminal, printHelp, showPrompt]);

  useEffect(() => {
    const incoming = setupLogs || '';
    if (!incoming) return;
    const prev = setupLogsRef.current;
    if (incoming === prev) return;
    const diff = incoming.startsWith(prev) ? incoming.slice(prev.length) : incoming;
    if (diff) {
      appendNpm(diff);
      writeToTerminal(diff);
    }
    setupLogsRef.current = incoming;
  }, [appendNpm, setupLogs, writeToTerminal]);
  const stopDevServer = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setWaitingForWatch(false);
    waitingForWatchRef.current = false;
    serverStartRequestedRef.current = false;
    watchBufferRef.current = '';
    setStarting(false);
    try { await window.api.stopServer(sitePath); } catch {}
    try { window.api.stopWpDebug(sitePath); } catch {}
    try { if (newEmailUnsubRef.current) { newEmailUnsubRef.current(); newEmailUnsubRef.current = null; } } catch {}
    try { if (smtpStartedUnsubRef.current) { smtpStartedUnsubRef.current(); smtpStartedUnsubRef.current = null; } } catch {}
    setRunning(false);
    runningRef.current = false;
    setServerUrl('');
    setSmtpPort(0);
    stoppingRef.current = false;
    waitingForWatchRef.current = false;
    terminalKillRef.current = null;
    terminalStateRef.current.running = false;
    currentRunIdRef.current = null;
  }, [setRunning, setServerUrl, setSmtpPort, setStarting, setWaitingForWatch, sitePath]);

  const startPhpServer = useCallback(async () => {
    if (serverStartRequestedRef.current || stoppingRef.current || !terminalStateRef.current.running) {
      serverStartRequestedRef.current = false;
      return;
    }
    serverStartRequestedRef.current = true;
    setWaitingForWatch(false);
    waitingForWatchRef.current = false;
    ensureStick('runtime');
    setStarting(true);
    // Subscribe to SMTP events before starting to avoid missing early events
    if (!smtpStartedUnsubRef.current) smtpStartedUnsubRef.current = window.api.onSmtpStarted(sitePath, (port)=>setSmtpPort(port||0));
    if (!newEmailUnsubRef.current) newEmailUnsubRef.current = window.api.onNewEmail(sitePath, (msg)=>setEmails((prev)=>sortEmails([msg, ...prev])));
    try {
      await window.api.startServer(
        sitePath,
        (p)=>appendRuntime(p.data || ''),
        (url)=>{
          if (stoppingRef.current) {
            serverStartRequestedRef.current = false;
            return;
          }
          const u = url.replace(/\/$/,'/');
          setServerUrl(u);
          window.api.openExternal(u);
          setRunning(true);
          runningRef.current = true;
          setStarting(false);
          serverStartRequestedRef.current = false;
        },
        ()=>{ setRunning(false); runningRef.current = false; setServerUrl(''); serverStartRequestedRef.current = false; }
      );
    } catch (error) {
      appendRuntime(`Failed to start PHP server: ${error && error.message ? error.message : String(error)}\n`);
      setStarting(false);
      serverStartRequestedRef.current = false;
      runningRef.current = false;
      return;
    }
    window.api.startWpDebug(sitePath,(d)=>appendRuntime(d || ''));
    try { const { port, emails } = await window.api.getEmails(sitePath); if (port) setSmtpPort(port); setEmails(emails||[]); } catch {}
  }, [appendRuntime, ensureStick, newEmailUnsubRef, setEmails, setRunning, setServerUrl, setStarting, setSmtpPort, sitePath, smtpStartedUnsubRef, sortEmails]);

  const toggleDevServer = async ()=>{
    if (!running) {
      if (!skipInit && !hasBuilt) { alert('Please complete the first full build before starting the dev server. You can also skip the wizard.'); return; }
      const state = terminalStateRef.current;
      if (state.running) {
        writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
        return;
      }
      state.running = true;
      terminalKillRef.current = () => {
        killCurrent().catch(() => {});
        stopDevServer().catch(() => {});
      };
      watchBufferRef.current = '';
      serverStartRequestedRef.current = false;
      setWaitingForWatch(true);
      waitingForWatchRef.current = true;
      setStarting(true);
      writeToTerminal('\nRunning npm run watch --dev…\n');
      runScript('watch', {
        args: ['--dev'],
        onLog: (chunk) => {
          if (stoppingRef.current || (!terminalStateRef.current.running && !waitingForWatchRef.current)) return;
          writeToTerminal(chunk);
          if (serverStartRequestedRef.current || runningRef.current || !terminalStateRef.current.running) return;
          const text = String(chunk ?? '');
          if (!text) return;
          watchBufferRef.current = `${watchBufferRef.current}${text}`.slice(-200);
          if (watchBufferRef.current.includes('Running "_watch" task')) {
            startPhpServer().catch(() => {});
          }
        },
        onDone: ({ code }) => {
          writeToTerminal(`npm run watch --dev exited with code ${code}\n`);
          const currentState = terminalStateRef.current;
          currentState.running = false;
          terminalKillRef.current = null;
          if (!stoppingRef.current && (runningRef.current || serverStartRequestedRef.current || waitingForWatchRef.current)) {
            stopDevServer().catch(() => {});
          } else {
            setWaitingForWatch(false);
            waitingForWatchRef.current = false;
            setStarting(false);
            serverStartRequestedRef.current = false;
            watchBufferRef.current = '';
          }
          showPrompt(false);
        }
      });
    } else {
      await killCurrent().catch(() => {});
      await stopDevServer();
    }
  };
  const isServerStarting = waitingForWatch || (starting && !serverUrl);
  const isDevProcessActive = running || isServerStarting;
  const markSkipWizard = useCallback(async () => {
    await window.api.setSkipInitWizard(sitePath, true);
    setSkipInit(true);
  }, [sitePath]);
  const confirmAnd = async (m,a)=>{ if(window.confirm(m)) await a(); };

  const openPatchModal = async ()=>{
    setIsPatchOpen(true);
    setPatchLoading(true);
    setPatchText('');
    try {
      const res = await window.api.getPatch(sitePath);
      if (res && res.ok) setPatchText((res.patch && res.patch.trim().length) ? res.patch : 'No changes.');
      else setPatchText(res && res.error ? `Error: ${res.error}` : 'Failed to generate patch');
    } catch (e) {
      setPatchText(`Error: ${e && e.message ? e.message : String(e)}`);
    } finally {
      setPatchLoading(false);
    }
  };

  const copyPatch = async ()=>{
    try { await navigator.clipboard.writeText(patchText); } catch {}
  };

  const savePatch = async ()=>{
    try {
      const res = await window.api.savePatch(sitePath);
      if (res && res.ok && res.filePath) {
        alert(`Diff saved to: ${res.filePath}`);
      } else if (res && res.canceled) {
        // User canceled, do nothing
      } else {
        alert(`Error saving diff: ${res && res.error ? res.error : 'Unknown error'}`);
      }
    } catch (e) {
      alert(`Error saving diff: ${e && e.message ? e.message : String(e)}`);
    }
  };

  const statusStyles = initialized
    ? { background: '#e7f6e7', color: '#0f5132' }
    : { background: '#fff4ce', color: '#8a6d1c' };

  const checklistVisuals = {
    complete: {
      label: 'Completed',
      color: '#0f5132',
      background: '#f4fbf4',
      border: '#94d3ae',
      indicatorBg: '#0f5132',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '✓'
    },
    current: {
      label: 'In progress',
      color: '#0b5d95',
      background: '#e8f3ff',
      border: '#66afe9',
      indicatorBg: '#007cba',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '•'
    },
    pending: {
      label: 'Pending',
      color: '#6c6f72',
      background: '#f8f9f9',
      border: '#dcdcde',
      indicatorBg: '#6c6f72',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '•'
    },
    locked: {
      label: 'Locked',
      color: '#6c6f72',
      background: '#f5f5f7',
      border: '#dcdcde',
      indicatorBg: 'transparent',
      indicatorColor: '#6c6f72',
      indicatorBorder: '2px solid #c3c4c7',
      indicatorContent: '–'
    }
  };

  const baseSteps = [
    {
      key: 'download',
      label: 'Download WordPress development version',
      description: 'Clone the WordPress develop repository.',
      done: true,
      ready: true
    },
    {
      key: 'install',
      label: 'Install npm dependencies',
      description: 'Install npm packages so commands can run.',
      done: hasNodeModules,
      ready: true,
      action: (
        <Button
          isBusy={installing}
          variant={hasNodeModules ? 'secondary' : 'primary'}
          onClick={runInstallWithTerminal}
          disabled={statusLoading || installing || hasNodeModules}
        >{hasNodeModules ? 'Dependencies installed' : 'Install npm dependencies'}</Button>
      )
    },
    {
      key: 'build',
      label: 'Run first full build',
      description: 'Compile WordPress Core once to generate the initial dist files.',
      done: hasBuilt,
      ready: hasNodeModules,
      action: (
        <Button
          isBusy={building}
          variant={hasBuilt ? 'secondary' : 'primary'}
          onClick={()=>runScript('build')}
          disabled={statusLoading || building || (!hasNodeModules) || hasBuilt}
        >{hasBuilt ? 'First build complete' : 'Run first full build'}</Button>
      )
    },
    {
      key: 'dev',
      label: 'Start dev server & finish wizard',
      description: 'Launch the development server once to complete the WordPress setup wizard.',
      done: false,
      ready: hasBuilt,
      action: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            isBusy={starting}
            variant={running ? 'secondary' : 'primary'}
            onClick={async () => {
              await markSkipWizard();
              await toggleDevServer();
            }}
            disabled={statusLoading || starting || (!hasBuilt)}
          >{running ? 'Stop dev server' : 'Start dev server and finish the wizard'}</Button>
          {starting || serverUrl ? (
            <span style={{ fontSize: 12 }}>
              {starting ? 'Starting...' : (serverUrl ? (
                <a href={serverUrl} onClick={(e) => { e.preventDefault(); window.api.openExternal(serverUrl); }}>{serverUrl}</a>
              ) : null)}
            </span>
          ) : null}
        </div>
      )
    }
  ];

  let currentStepCaptured = false;
  const stepItems = baseSteps.map((step) => {
    let status;
    if (step.done) {
      status = 'complete';
    } else if (!currentStepCaptured && step.ready) {
      status = 'current';
      currentStepCaptured = true;
    } else if (step.ready) {
      status = 'pending';
    } else {
      status = 'locked';
    }
    return { ...step, status };
  });

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 48 }}>
      <Flex align="flex-start" justify="space-between" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 440px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>{displayName}</h1>
            <Button
              icon={edit}
              label="Rename site"
              aria-label="Rename site"
              onClick={openRenameModal}
              variant="tertiary"
              isSmall
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#3c434a', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em', ...statusStyles }}>
              {initialized ? 'Initialized' : 'Uninitialized'}
            </span>
            {createdLabel ? <span>Created {createdLabel}</span> : null}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6 }}>
            <code style={{ fontSize: 12, color: '#3c434a', background: '#f0f0f1', padding: '2px 6px', borderRadius: 4, overflowWrap: 'anywhere' }}>
              {sitePath}
            </code>
            <Button
              icon={pathCopied ? checkIcon : copyIcon}
              label={pathCopied ? 'Copied!' : 'Copy path'}
              aria-label={pathCopied ? 'Copied!' : 'Copy path'}
              onClick={copyPath}
              variant="tertiary"
              isSmall
            />
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <DropdownMenu
            label="More"
            text=""
            controls={[
              { title: 'Copy path', onClick: copyPath },
              { title:'Forget this site', onClick:()=>confirmAnd('Remove this site from the list?', ()=>onForget(sitePath)) },
              { title:'Delete this site', onClick:()=>confirmAnd('Delete this site from disk? This cannot be undone.', ()=>onDelete(sitePath)) }
            ]}
          />
        </div>
      </Flex>
      {!skipInit ? (
        <div style={{ padding: 20, border: '1px solid #dcdcde', borderRadius: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: '#1d2327' }}>Initial setup checklist</div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#3c434a' }}>Complete each step to prepare this site for development.</div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {stepItems.map((step) => {
              const visuals = checklistVisuals[step.status] || checklistVisuals.locked;
              return (
                <div
                  key={step.key}
                  style={{
                    border: `1px solid ${visuals.border}`,
                    background: visuals.background,
                    borderRadius: 10,
                    padding: '14px 16px',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    gridTemplateRows: 'auto auto',
                    columnGap: 16,
                    rowGap: 8,
                    alignItems: 'center'
                  }}
                >
                  <div style={{ gridRow: '1 / span 2', alignSelf: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28 }}>
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        width: 24,
                        height: 24,
                        borderRadius: '50%',
                        fontSize: 12,
                        fontWeight: 700,
                        lineHeight: 1,
                        background: visuals.indicatorBg,
                        color: visuals.indicatorColor,
                        border: visuals.indicatorBorder || 'none'
                      }}
                    >
                      {visuals.indicatorContent}
                    </span>
                  </div>
                  <div style={{ gridColumn: '2 / 3', display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, minWidth: 0, flexWrap: 'wrap' }}>
                    <div style={{ fontWeight: 600, color: '#1d2327', lineHeight: 1.4 }}>{step.label}</div>
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: visuals.color, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{visuals.label}</div>
                  </div>
                  <div style={{ gridColumn: '2 / 3', fontSize: 12, color: '#3c434a', lineHeight: 1.5 }}>{step.description}</div>
                  <div style={{ gridRow: '1 / span 2', gridColumn: '3 / 4', alignSelf: 'center', display: 'flex', alignItems: 'center' }}>
                    {step.action}
                  </div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 12 }}>
            <Button variant="link" onClick={markSkipWizard} style={{ textDecoration: 'underline' }}>Skip initialization wizard</Button>
          </div>
        </div>
      ) : (
        null
      )}
      {skipInit ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'stretch', gap: 12, flexWrap: 'wrap' }}>
            <Button
              isBusy={isServerStarting}
              variant={isDevProcessActive ? 'secondary' : 'primary'}
              onClick={toggleDevServer}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 220, justifyContent: 'center', padding: '12px 20px', fontSize: 15, borderRadius: 12 }}
            >
              {isDevProcessActive ? (
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: '#d63638',
                    boxShadow: '0 0 0 4px rgba(214,54,56,0.15)',
                    marginRight: 6
                  }}
                />
              ) : null}
              <span style={{ fontWeight: 600 }}>{isDevProcessActive ? (isServerStarting ? 'Starting dev server...' : 'Stop dev server') : 'Start dev server'}</span>
            </Button>
            <Button
              variant="secondary"
              onClick={openPatchModal}
              style={{ padding: '10px 16px', borderRadius: 10 }}
            >Submit patch</Button>
            {running && serverUrl ? (
              <Button
                variant="secondary"
                onClick={() => {
                  const adminer = (serverUrl || '').replace(/\/$/, '/') + 'adminer.php';
                  window.api.openExternal(adminer);
                }}
                style={{ padding: '10px 16px', borderRadius: 10 }}
              >Open Adminer</Button>
            ) : null}
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); if (feedbackFormUrl) window.api.openExternal(feedbackFormUrl); }}
              onMouseEnter={(e) => { e.currentTarget.style.textDecoration = 'underline'; }}
              onMouseLeave={(e) => { e.currentTarget.style.textDecoration = 'none'; }}
              title={feedbackFormUrl ? undefined : 'Feedback form not configured (missing FEEDBACK_FORM_URL)'}
              style={{
                marginLeft: 'auto',
                alignSelf: 'center',
                color: feedbackFormUrl ? '#3858e9' : '#757575',
                cursor: feedbackFormUrl ? 'pointer' : 'default',
                textDecoration: 'none',
                fontFamily: 'inherit',
                fontWeight: 600,
                fontSize: 15
              }}
            >
              💬 Share feedback
            </a>
          </div>
          {(isServerStarting || serverUrl) ? (
            <div style={{ fontSize: 13, color: '#1d2327', paddingLeft: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {serverUrl ? (
                <>
                  <a href={serverUrl} onClick={(e) => { e.preventDefault(); window.api.openExternal(serverUrl); }}>{serverUrl}</a>
                  <span style={{ fontSize: 12, color: '#3c434a' }}>Log in with <code>admin</code> / <code>admin</code>.</span>
                </>
              ) : (
                'Dev server is starting…'
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Terminal</div>
          <div
            ref={terminalContainerRef}
            style={{
              height: 220,
              background: '#111',
              borderRadius: 6,
              overflow: 'hidden',
              border: '1px solid #1b1b1f'
            }}
          />
          <div style={{ marginTop: 8, fontSize: 12, color: '#3c434a' }}>
            Type <code>help</code> to list supported commands. Press <code>Ctrl+C</code> to stop the current command.
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Server & WordPress logs</div>
          <div ref={runtimeRef} onScroll={makeOnScroll('runtime')} style={{ whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:220, overflow:'auto' }}>{runtimeLogs}</div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Mail</div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div style={{ fontSize:12, color:'#666' }}>{smtpPort ? `SMTP listening on 127.0.0.1:${smtpPort}` : 'SMTP will start with the dev server.'}</div>
            <div><Button size="small" variant="secondary" onClick={clearEmails}>Clear emails</Button></div>
          </div>
          <div style={{ border:'1px solid #ddd', borderRadius:6, maxHeight:220, overflow:'auto' }}>
            {emails && emails.length ? emails.map((m)=>{
              const when = m.sentAt || m.date; const whenStr = when ? new Date(when).toLocaleString() : '';
              return (
                <div key={m.id}
                  onClick={()=>openEmail(m)}
                  style={{ padding:'8px 10px', cursor:'pointer', borderBottom:'1px solid #eee', display:'flex', gap:8 }}
                >
                  <div style={{ flex:'0 0 180px', color:'#555', fontSize:12 }}>{whenStr}</div>
                  <div style={{ flex:'0 0 220px', color:'#333', fontSize:12, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.from || ''}</div>
                  <div style={{ flex:'1 1 auto', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.subject || '(no subject)'}</div>
                </div>
              );
            }) : (
              <div style={{ padding:12, color:'#666' }}>No emails yet.</div>
            )}
          </div>
        </div>
      </div>
      {renameModalOpen ? (
        <Modal
          title="Rename site"
          onRequestClose={closeRenameModal}
          shouldCloseOnClickOutside={!renaming}
        >
          <form
            onSubmit={handleRenameSubmit}
            onKeyDown={handleRenameFormKeyDown}
            style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
          >
            <TextControl
              id={RENAME_INPUT_ID}
              label="Site name"
              value={renameValue}
              onChange={(value) => setRenameValue(value)}
              disabled={renaming}
              autoFocus
            />
            {renameError ? <div style={{ color: '#d63638', fontSize: 12 }}>{renameError}</div> : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button type="button" variant="secondary" onClick={closeRenameModal} disabled={renaming}>Cancel</Button>
              <Button type="submit" variant="primary" isBusy={renaming} disabled={renaming}>Save</Button>
            </div>
          </form>
        </Modal>
      ) : null}
      {isPatchOpen && (
        <Modal
          title="Patch"
          onRequestClose={()=>setIsPatchOpen(false)}
          shouldCloseOnClickOutside
          isFullScreen
          headerClassName="patch-modal-header"
        >
          <div style={{ display:'flex', flexDirection:'column', height:'80vh', gap:12 }}>
            {!patchLoading && (
              <div style={{ padding:'12px 16px', background:'#f0f6fc', border:'1px solid #d0d7de', borderRadius:6, fontSize:14, lineHeight:1.5, color:'#24292f' }}>
                <strong>Next steps:</strong> Save this patch and submit it to the relevant WordPress Trac ticket at <a href="#" onClick={(e) => { e.preventDefault(); window.api.openExternal('https://core.trac.wordpress.org'); }} style={{color:'#0969da', cursor:'pointer'}}>core.trac.wordpress.org</a>
              </div>
            )}
            <div style={{ position:'relative', flex:1, minHeight:0 }}>
              {patchLoading ? (
                <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%', gap:16 }}>
                  <Spinner />
                  <div style={{ color:'#666', fontSize:14 }}>Generating patch...</div>
                </div>
              ) : (
                <>
                  <div style={{ position:'absolute', top:8, right:8, zIndex:2, display:'flex', gap:8 }}>
                    <Button
                      icon={download}
                      label="Save"
                      onClick={savePatch}
                      style={{
                        background:'#fff', border:'1px solid #ddd', color:'#111', boxShadow:'none'
                      }}
                    />
                    <Button
                      icon={copyIcon}
                      label="Copy"
                      onClick={copyPatch}
                      style={{
                        background:'#fff', border:'1px solid #ddd', color:'#111', boxShadow:'none'
                      }}
                    />
                  </div>
                  <pre style={{ margin:0, whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:'100%', overflowY:'auto' }}>
                    {patchText && patchText.trim().length ? patchText : 'No changes.'}
                  </pre>
                </>
              )}
            </div>
          </div>
        </Modal>
      )}
      {isEmailOpen && activeEmail && (
        <Modal
          title={activeEmail.subject || 'Email'}
          onRequestClose={()=>{ setIsEmailOpen(false); setActiveEmail(null); }}
          shouldCloseOnClickOutside
          isFullScreen
        >
          <div style={{ padding: 8 }}>
            <div style={{ marginBottom: 8, fontSize:12, color:'#444' }}>
              <div><strong>From:</strong> {activeEmail.from || ''}</div>
              <div><strong>To:</strong> {activeEmail.to || ''}</div>
              {activeEmail.cc ? (<div><strong>CC:</strong> {activeEmail.cc}</div>) : null}
              <div><strong>Date:</strong> {activeEmail.sentAt ? new Date(activeEmail.sentAt).toLocaleString() : (activeEmail.date ? new Date(activeEmail.date).toLocaleString() : '')}</div>
            </div>
            <TabPanel className="email-tabs" activeClass="is-active" onSelect={(n)=>setEmailViewTab(n)} tabs={[{name:'rendered',title:'Rendered'},{name:'raw',title:'Raw'}]}>
              {(tab)=> tab.name==='rendered' ? (
                <div style={{ border:'1px solid #ddd', borderRadius:6, padding:12, minHeight:'60vh', background:'#fff' }}>
                  {activeEmail.html ? (
                    <div dangerouslySetInnerHTML={{ __html: String(activeEmail.html) }} />
                  ) : (
                    <pre style={{ whiteSpace:'pre-wrap', margin:0 }}>{activeEmail.text || ''}</pre>
                  )}
                </div>
              ) : (
                <pre style={{ whiteSpace:'pre-wrap', margin:0, background:'#111', color:'#eee', padding:12, borderRadius:6, minHeight:'60vh', overflow:'auto' }}>{activeEmail.raw || activeEmail.text || ''}</pre>
              )}
            </TabPanel>
          </div>
        </Modal>
      )}
    </section>
  );
}

const root = createRoot(document.getElementById('root'));
root.render(<App />);
