import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  TabPanel,
  Card,
  CardBody,
  Flex,
  FlexItem,
  DropdownMenu,
  Modal
} from '@wordpress/components';
import { plus, chevronDown, chevronLeft, chevronRight, copy as copyIcon } from '@wordpress/icons';
import '@wordpress/components/build-style/style.css';

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
  const [activeSite, setActiveSite] = useState(null);

  useEffect(() => {
    const unsubProg = window.api.subscribeSetupProgress((p) => {
      if (p && p.message) setTerminalMsgs((v) => v + p.message + '\n');
      if (p && p.target) setPendingSite((prev) => prev || { targetDir: p.target });
    });
    const unsubStat = window.api.subscribeSetupStatus((s) => {
      if (!s) return;
      setPendingSite((prev) => prev || { targetDir: s.target });
      if (s.phase === 'cloning') setDownloadPhase('Cloning repository…');
      else if (s.phase === 'done') { setDownloadPhase(''); setPendingSite(null); setTerminalMsgs(''); }
    });
    return () => { unsubProg && unsubProg(); unsubStat && unsubStat(); };
  }, []);

  const chooseAndSetup = useCallback(async () => {
    const dir = await window.api.chooseDirectory();
    if (!dir) return;
    try {
      setTerminalMsgs('');
      setPendingSite({ targetDir: dir });
      await window.api.setupWordPress(dir);
      await refresh();
    } catch (e) {
      setPendingSite(null);
      alert(String(e));
    }
  }, [refresh]);

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
  }, [refresh]);

  const onDelete = useCallback(async (sitePath) => {
    await window.api.deleteSite(sitePath);
    await refresh();
  }, [refresh]);

  const sortedSites = useMemo(() => {
    if (!sites || !sites.length) return [];
    return [...sites].sort((a, b) => (siteMeta?.[b]?.createdAt || 0) - (siteMeta?.[a]?.createdAt || 0));
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
            const siteName = sitePath.split('/').pop() || sitePath;
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
        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '16px', borderTop: '1px solid #2b2b2b' }}>
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
                      onInitialized={onInitialized}
                      onForget={onForget}
                      onDelete={onDelete}
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
    </div>
  );
}

function SiteRow({ sitePath, initialized, createdAt, onInitialized, onForget, onDelete }) {
  // state
  const [serverUrl, setServerUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [selectedTab, setSelectedTab] = useState('npm');
  const [npmLogs, setNpmLogs] = useState('');
  const [serverLogs, setServerLogs] = useState('');
  const [wpLogs, setWpLogs] = useState('');
  const [isPatchOpen, setIsPatchOpen] = useState(false);
  const [patchText, setPatchText] = useState('');
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

  // sticky refs
  const npmRef = useRef(null); const serverRef = useRef(null); const wpRef = useRef(null);
  const [stick, setStick] = useState(true); const threshold = 8;
  useEffect(() => { const ref = selectedTab==='npm'?npmRef:selectedTab==='server'?serverRef:wpRef; if (stick && ref.current) ref.current.scrollTop = ref.current.scrollHeight; }, [npmLogs,serverLogs,wpLogs,selectedTab,stick]);
  const makeOnScroll = (tab) => (e) => { const el=e.currentTarget; const atBottom=el.scrollTop+el.clientHeight>=el.scrollHeight-threshold; if(atBottom) setStick(true); else if(selectedTab===tab && stick) setStick(false); };

  const siteName = sitePath.split('/').pop();
  const createdLabel = createdAt ? new Date(createdAt).toLocaleString() : '';

  const appendNpm = (s)=>setNpmLogs(v=>v+s); const appendServer=(s)=>setServerLogs(v=>v+s); const appendWp=(s)=>setWpLogs(v=>v+s);
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

  const runInstall = () => {
    setInstalling(true); setSelectedTab('npm'); setStick(true); window.api.runNpmInstall(sitePath, ({ data }) => appendNpm(data), async ({ code }) => {
      appendNpm(`\ninstall exited with code ${code}\n`); setInstalling(false);
      /**
       * Still let us through when this happens on Windows:
       * 
       * npm verbose stack Error: command failed
       * npm verbose stack     at promiseSpawn (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\@npmcli\promise-spawn\lib\index.js:22:22)
       * npm verbose stack     at spawnWithShell (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\@npmcli\promise-spawn\lib\index.js:124:10)
       * npm verbose stack     at promiseSpawn (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\@npmcli\promise-spawn\lib\index.js:12:12)
       * npm verbose stack     at runScriptPkg (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\@npmcli\run-script\lib\run-script-pkg.js:79:13)
       * npm verbose stack     at runScript (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\@npmcli\run-script\lib\run-script.js:9:12)
       * npm verbose stack     at C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\@npmcli\arborist\lib\arborist\rebuild.js:329:17
       * npm verbose stack     at run (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\promise-call-limit\dist\commonjs\index.js:67:22)
       * npm verbose stack     at C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\promise-call-limit\dist\commonjs\index.js:84:9
       * npm verbose stack     at new Promise (<anonymous>)
       * npm verbose stack     at callLimit (C:\Users\Adam\AppData\Local\Programs\electron-setup-wordpress-core\resources\app.asar\node_modules\npm\node_modules\promise-call-limit\dist\commonjs\index.js:35:69)
       * npm verbose pkgid core-js-pure@3.35.1
       * npm error code 1
       * npm error path C:\wp\wordpress-develop-trunk\node_modules\core-js-pure
       * 
       * @TODO: Do not mark as initialized if the installation fails.
       */
      if (1 || code === 0) { try { await window.api.markSiteInitialized(sitePath); } catch {} onInitialized(sitePath); }
      try { await loadStatus(); } catch {}
    });
  };
  const runScript = (name)=>{ setSelectedTab('npm'); setStick(true); if (name === 'build') setBuilding(true); window.api.runNpmScript(sitePath,name,[],({data})=>appendNpm(data),async ({code})=>{ appendNpm(`\n${name} exited with code ${code}\n`); if (name === 'build') { setBuilding(false); try { await loadStatus(); } catch {} } }); };
  const killCurrent = async ()=>{ await window.api.npmKill({ directoryPath: sitePath }); };
  const toggleServer = async ()=>{
    if(!running){
      if (!skipInit && !hasBuilt) { alert('Please complete the first full build before starting the dev server. You can also skip the wizard.'); return; }
      setStarting(true); setSelectedTab('server'); setStick(true);
      // Subscribe to SMTP events before starting to avoid missing early events
      if (!smtpStartedUnsubRef.current) smtpStartedUnsubRef.current = window.api.onSmtpStarted(sitePath, (port)=>setSmtpPort(port||0));
      if (!newEmailUnsubRef.current) newEmailUnsubRef.current = window.api.onNewEmail(sitePath, (msg)=>setEmails((prev)=>sortEmails([msg, ...prev])));
      await window.api.startServer(sitePath, (p)=>appendServer(p.data), (url)=>{ const u=url.replace(/\/$/,'/'); setServerUrl(u); window.api.openExternal(u); setRunning(true); setStarting(false); }, ()=>{ setRunning(false); setServerUrl(''); });
      window.api.startWpDebug(sitePath,(d)=>appendWp(d));
      try { const { port, emails } = await window.api.getEmails(sitePath); if (port) setSmtpPort(port); setEmails(emails||[]); } catch {}
    } else {
      await window.api.stopServer(sitePath);
      window.api.stopWpDebug(sitePath);
      await window.api.npmKill({ directoryPath: sitePath });
      try { if (newEmailUnsubRef.current) { newEmailUnsubRef.current(); newEmailUnsubRef.current=null; } } catch {}
      try { if (smtpStartedUnsubRef.current) { smtpStartedUnsubRef.current(); smtpStartedUnsubRef.current=null; } } catch {}
      setSmtpPort(0);
    }
  };
  const toggleDevServer = async ()=>{ if(!running){ runScript('dev'); } await toggleServer(); };
  const markSkipWizard = useCallback(async () => {
    await window.api.setSkipInitWizard(sitePath, true);
    setSkipInit(true);
  }, [sitePath]);
  const confirmAnd = async (m,a)=>{ if(window.confirm(m)) await a(); };

  const openPatchModal = async ()=>{
    setIsPatchOpen(true);
    setPatchText('Generating patch…');
    try {
      const res = await window.api.getPatch(sitePath);
      if (res && res.ok) setPatchText((res.patch && res.patch.trim().length) ? res.patch : 'No changes.');
      else setPatchText(res && res.error ? `Error: ${res.error}` : 'Failed to generate patch');
    } catch (e) {
      setPatchText(`Error: ${e && e.message ? e.message : String(e)}`);
    }
  };

  const copyPatch = async ()=>{
    try { await navigator.clipboard.writeText(patchText); } catch {}
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
      background: '#f0f6fc',
      border: '#66afe9',
      indicatorBg: '#007cba',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '•'
    },
    pending: {
      label: 'Pending',
      color: '#6c6f72',
      background: '#fff',
      border: '#dcdcde',
      indicatorBg: '#6c6f72',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '•'
    },
    locked: {
      label: 'Locked',
      color: '#6c6f72',
      background: '#fafafa',
      border: '#dcdcde',
      indicatorBg: 'transparent',
      indicatorColor: '#6c6f72',
      indicatorBorder: '2px solid #c3c4c7',
      indicatorContent: '–'
    }
  };

  const baseSteps = [
    {
      key: 'install',
      label: 'Install dependencies',
      description: 'Install npm packages so commands can run.',
      done: hasNodeModules,
      ready: true,
      action: (
        <Button
          isBusy={installing}
          variant={hasNodeModules ? 'secondary' : 'primary'}
          onClick={runInstall}
          disabled={statusLoading || installing || hasNodeModules}
        >{hasNodeModules ? 'Dependencies installed' : 'Install dependencies'}</Button>
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
          <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>{siteName}</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#3c434a', flexWrap: 'wrap' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.02em', ...statusStyles }}>
              {initialized ? 'Initialized' : 'Uninitialized'}
            </span>
            {createdLabel ? <span>Created {createdLabel}</span> : null}
          </div>
          <div className="path" style={{ marginTop: 12, fontFamily: 'Menlo, monospace', fontSize: 13, color: '#2c3338', wordBreak: 'break-all' }}>
            <span style={{ color: '#787c82', marginRight: 6 }}>Path:</span> {sitePath}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <DropdownMenu label="More" text="" controls={[{ title:'Forget this site', onClick:()=>confirmAnd('Remove this site from the list?', ()=>onForget(sitePath)) },{ title:'Delete this site', onClick:()=>confirmAnd('Delete this site from disk? This cannot be undone.', ()=>onDelete(sitePath)) }]} />
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
                    display: 'flex',
                    gap: 16,
                    alignItems: 'flex-start'
                  }}
                >
                  <div style={{ width: 28 }}>
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
                        background: visuals.indicatorBg,
                        color: visuals.indicatorColor,
                        border: visuals.indicatorBorder || 'none'
                      }}
                    >
                      {visuals.indicatorContent}
                    </span>
                  </div>
                  <div style={{ flex: '1 1 auto', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                      <div style={{ fontWeight: 600, color: '#1d2327' }}>{step.label}</div>
                      <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: visuals.color }}>{visuals.label}</div>
                    </div>
                    <div style={{ fontSize: 12, color: '#3c434a' }}>{step.description}</div>
                  </div>
                  <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center' }}>
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
        <div style={{ padding: 16, border: '1px solid #dcdcde', borderRadius: 8, background: '#fff', color: '#3c434a', fontSize: 12 }}>
            Initialization finished. Use the Run command menu for installs/builds.
        </div>
      )}
      {skipInit ? (
        <Flex style={{ gap: 8, justifyContent: 'flex-start' }}>
          <FlexItem><Button variant="secondary" onClick={()=>window.api.openDirectory(sitePath)}>Open directory</Button></FlexItem>
          <FlexItem>
            <Button isBusy={starting} variant={running ? 'secondary' : 'primary'} onClick={toggleDevServer}>{running ? 'Stop dev server' : 'Start dev server'}</Button>
            {starting || serverUrl ? (
              <span style={{ marginLeft: 8 }}>{starting ? 'Starting...' : serverUrl ? (<a href={serverUrl} onClick={(e) => { e.preventDefault(); window.api.openExternal(serverUrl); }}>{serverUrl}</a>) : null}</span>
            ) : null}
            {running && serverUrl ? (
              <Button
                variant="secondary"
                onClick={() => {
                  const adminer = (serverUrl || '').replace(/\/$/, '/') + 'adminer.php';
                  window.api.openExternal(adminer);
                }}
                style={{ marginLeft: 8 }}
              >Open Adminer</Button>
            ) : null}
          </FlexItem>
          <FlexItem><Button variant="secondary" onClick={openPatchModal}>Create patch</Button></FlexItem>
          <FlexItem><DropdownMenu icon={chevronDown} label="Run command" text="Run command" controls={[{title:'npm run build',onClick:()=>runScript('build')},{title:'npm run build:dev',onClick:()=>runScript('build:dev')},{title:'npm run dev',onClick:()=>runScript('dev')},{title:'npm run test',onClick:()=>runScript('test')},{title:'npm run watch',onClick:()=>runScript('watch')},{title:'npm run grunt',onClick:()=>runScript('grunt')},{title:'Kill running command',onClick:killCurrent}]}/></FlexItem>
        </Flex>
      ) : null}
      <div>
        <TabPanel className="log-tabs" activeClass="is-active" onSelect={(n)=>{setSelectedTab(n);setStick(true);}} tabs={[{name:'npm',title:'Npm logs'},{name:'server',title:'Server logs'},{name:'wp',title:'WordPress logs'},{name:'mail',title:'Mail'}]}>
          {(tab)=>(<div>
            {tab.name==='npm' && (<div ref={npmRef} onScroll={makeOnScroll('npm')} style={{ whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:180, overflow:'auto' }}>{npmLogs}</div>)}
            {tab.name==='server' && (<div ref={serverRef} onScroll={makeOnScroll('server')} style={{ whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:180, overflow:'auto' }}>{serverLogs}</div>)}
            {tab.name==='wp' && (<div ref={wpRef} onScroll={makeOnScroll('wp')} style={{ whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:180, overflow:'auto' }}>{wpLogs}</div>)}
            {tab.name==='mail' && (
              <div>
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
            )}
          </div>)}
        </TabPanel>
      </div>
      {isPatchOpen && (
        <Modal
          title="Patch"
          onRequestClose={()=>setIsPatchOpen(false)}
          shouldCloseOnClickOutside
          isFullScreen
        >
          <div style={{ position:'relative', height:'80vh' }}>
            <Button
              icon={copyIcon}
              label="Copy"
              onClick={copyPatch}
              style={{
                position:'absolute', top:8, right:8, zIndex:2,
                background:'#fff', border:'1px solid #ddd', color:'#111', boxShadow:'none'
              }}
            />
            <pre style={{ margin:0, whiteSpace:'pre-wrap', background:'#111', color:'#eee', padding:12, borderRadius:6, height:'100%', overflow:'auto' }}>
              {patchText && patchText.trim().length ? patchText : 'No changes.'}
            </pre>
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
