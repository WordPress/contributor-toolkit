import { useCallback, useEffect, useRef, useState } from 'react';
import { appendBounded, countLines } from '../debug-log.cjs';
import { pathBasename } from '../path-basename.cjs';

// How near its end a pane has to be scrolled to count as following it, in
// pixels.
const STICK_THRESHOLD = 8;

// What a site's processes have said (#554): the dev server's output, the build
// watch's, and WordPress's own debug.log, each in its own pane of the Logs
// panel. With them, what the panel needs to show them: which tab is open, how
// many debug.log lines arrived unseen, whether each pane is following its last
// line, and the tail of the file debug.log is read from.
//
// The hook holds the text and not the processes. Whoever runs one calls the
// matching `append`: the dev server `appendRuntime`, the build watch
// `appendWatch`. The debug.log tail is the exception, because only this panel
// reads it: `startDebugTail` and `stopDebugTail` are called where the dev
// server starts and stops, since WordPress writes the file only while it runs.
//
// `appendNpm` and the buffer behind it are what is left of an install log that
// had a pane of its own. Nothing shows the buffer any more: the install's
// output goes to the terminal. It is here because its callers are, and it is
// kept as it was.
//
// `shown` says whether the panel is on screen, which it is while the site is
// the open one and the tray is showing its logs (#558). A pane that is not on
// screen cannot be scrolled: one that was following its last line is put
// back there when the panel comes back.
//
// Every function returned keeps its identity for as long as `sitePath` does,
// except `copyDebugLog`, which changes with the text it copies. The callbacks
// that run the dev server, the build watch and the installs list the `append`
// functions as dependencies, and one that changed on every render would hand
// those callbacks a new identity each time too.
export function useSiteLogs({ sitePath, shown }) {
  const [npmLogs, setNpmLogs] = useState('');
  const [runtimeLogs, setRuntimeLogs] = useState('');
  // WordPress's own debug.log, kept apart from the server's output: one is what
  // Playground is doing, the other is what the contributor's code is doing, and
  // interleaving them buries the second in the first.
  const [debugLogs, setDebugLogs] = useState('');
  const [debugUnread, setDebugUnread] = useState(0);
  // Kept after the dev server stops: the file is still there, and so is the
  // reason someone wants the path.
  const [debugLogPath, setDebugLogPath] = useState('');
  const [activeLogTab, setActiveLogTab] = useState('runtime');
  const activeLogTabRef = useRef('runtime');
  const [watchLogs, setWatchLogs] = useState('');
  // '' | 'copied' | 'failed', on the debug.log Copy button for two seconds.
  const [debugCopied, setDebugCopied] = useState('');
  const debugCopyTimer = useRef(null);
  const wpDebugUnsubRef = useRef(null);

  // sticky refs per log
  const npmRef = useRef(null);
  const runtimeRef = useRef(null);
  const debugRef = useRef(null);
  const watchRef = useRef(null);
  const [logStick, setLogStick] = useState({ npm: true, runtime: true, debug: true, watch: true });
  const updateStick = useCallback((key, value) => {
    setLogStick((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
  }, []);
  const ensureStick = useCallback((key) => {
    setLogStick((prev) => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);
  useEffect(() => { if (logStick.npm && npmRef.current) npmRef.current.scrollTop = npmRef.current.scrollHeight; }, [npmLogs, logStick.npm]);
  // The log effects watch `activeLogTab` because only the selected tab's pane
  // is rendered: the pane is a fresh element every time it is switched back to,
  // scrolled to the top, and the arriving-text dependency alone would not fire
  // to put it back at the bottom. The guard is not just for the dependency — the
  // other tab's element is unmounted, so there is nothing to scroll. They
  // watch `shown` for the same reason one level up: a pane in a panel that is
  // not on screen has no height to scroll, and is put at its end when the
  // panel comes back.
  useEffect(() => {
    if (!shown || activeLogTab !== 'runtime') return;
    if (logStick.runtime && runtimeRef.current) runtimeRef.current.scrollTop = runtimeRef.current.scrollHeight;
  }, [runtimeLogs, logStick.runtime, activeLogTab, shown]);
  useEffect(() => {
    if (!shown || activeLogTab !== 'debug') return;
    if (logStick.debug && debugRef.current) debugRef.current.scrollTop = debugRef.current.scrollHeight;
  }, [debugLogs, logStick.debug, activeLogTab, shown]);
  useEffect(() => {
    if (!shown || activeLogTab !== 'watch') return;
    if (logStick.watch && watchRef.current) watchRef.current.scrollTop = watchRef.current.scrollHeight;
  }, [watchLogs, logStick.watch, activeLogTab, shown]);
  // Where each pane's element is handed over, for the panel to give to its
  // panes.
  const runtimePane = useCallback((element) => {
    runtimeRef.current = element;
  }, []);
  const watchPane = useCallback((element) => {
    watchRef.current = element;
  }, []);
  const debugPane = useCallback((element) => {
    debugRef.current = element;
  }, []);
  const makeOnScroll = useCallback((key) => (e) => {
    const el = e.currentTarget;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - STICK_THRESHOLD;
    updateStick(key, atBottom);
  }, [updateStick]);

  const appendNpm = useCallback((s)=>setNpmLogs((v)=>v+s),[]);
  const appendRuntime = useCallback((s)=>setRuntimeLogs((v)=>v + String(s ?? '')),[]);
  const appendDebug = useCallback((s) => {
    const chunk = String(s ?? '');
    if (!chunk) return;
    setDebugLogs((v) => appendBounded(v, chunk));
    // Counted only while the tab is not the one being read. Selecting it zeroes
    // the badge, so incrementing there would flicker it straight back on.
    if (activeLogTabRef.current !== 'debug') setDebugUnread((n) => n + countLines(chunk));
  }, []);
  // Bounded like the debug pane: the watcher is long-lived and chatty, so its
  // pane cannot grow without limit the way an unrendered buffer quietly could.
  const appendWatch = useCallback((s) => {
    const chunk = String(s ?? '');
    if (!chunk) return;
    setWatchLogs((v) => appendBounded(v, chunk));
  }, []);
  const selectTab = useCallback((name) => {
    activeLogTabRef.current = name;
    setActiveLogTab(name);
    if (name === 'debug') setDebugUnread(0);
  }, []);
  const clearDebugLog = useCallback(async () => {
    setDebugLogs('');
    setDebugUnread(0);
    // The file has to go with the pane. Clearing only the pane looks like it
    // worked and then hands the same lines back on the next dev-server start,
    // because the tail replays whatever is on disk when it attaches.
    let cleared;
    try {
      cleared = await window.api.clearWpDebug(sitePath);
    } catch (e) {
      cleared = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    if (!cleared?.ok) appendDebug(`Could not clear ${pathBasename(sitePath)}'s debug.log: ${cleared?.error || cleared?.reason || 'unknown error'}. The panel was cleared; the file was not.\n`);
  }, [appendDebug, sitePath]);
  // Same shape as the patch's Copy, and for the same reason: a clipboard write
  // has no visible result, so the button has to report one. This log goes
  // straight into a Trac ticket or a pull request comment.
  const copyDebugLog = useCallback(async () => {
    if (debugCopyTimer.current) clearTimeout(debugCopyTimer.current);
    let state = 'copied';
    try {
      await navigator.clipboard.writeText(debugLogs);
    } catch {
      state = 'failed';
    }
    setDebugCopied(state);
    debugCopyTimer.current = setTimeout(() => setDebugCopied(''), 2000);
  }, [debugLogs]);
  useEffect(() => () => { if (debugCopyTimer.current) clearTimeout(debugCopyTimer.current); }, []);
  // A site's view can go without its dev server having been stopped, when the
  // site is deleted, so the listener has to come off here too.
  useEffect(() => () => { try { if (wpDebugUnsubRef.current) { wpDebugUnsubRef.current(); wpDebugUnsubRef.current = null; } } catch {} }, []);
  const revealDebugLog = useCallback(async () => {
    let revealed;
    try {
      revealed = await window.api.revealWpDebug(sitePath);
    } catch (e) {
      revealed = { ok: false, error: e && e.message ? e.message : String(e) };
    }
    // Nothing on screen moves when a file manager opens behind the app, so a
    // refusal that says nothing is a button that did nothing.
    if (!revealed?.ok) appendDebug(`Could not show the log file: ${revealed?.error || revealed?.reason || 'unknown error'}\n`);
  }, [appendDebug, sitePath]);

  // For the moment a dev server has started. Reset before subscribing: the
  // tail replays the tail of the file when it attaches (up to 256KB,
  // startWpDebugTail in main.js), so a restart would otherwise show the
  // previous session's log a second time below itself. Stopping the server
  // does not clear the pane — after a crash that log is the thing to read —
  // but starting a new run does.
  const startDebugTail = useCallback(async () => {
    setDebugLogs('');
    setDebugUnread(0);
    try {
      if (wpDebugUnsubRef.current) { wpDebugUnsubRef.current(); wpDebugUnsubRef.current = null; }
      const tail = await window.api.startWpDebug(sitePath,(d)=>appendDebug(d || ''));
      wpDebugUnsubRef.current = tail?.unsubscribe || null;
      if (tail?.filePath) setDebugLogPath(tail.filePath);
    } catch {}
  }, [appendDebug, sitePath]);

  // For the moment a dev server stops. stopWpDebug only tears down the watcher
  // in the main process; the renderer keeps its own 'wp:debug-log:data'
  // listener until this takes it off. A start takes off any it finds as well,
  // so one left behind here would not be doubled, but two listeners on one
  // tail is every line appended twice, and neither place trusts the other.
  const stopDebugTail = useCallback(() => {
    try { window.api.stopWpDebug(sitePath); } catch {}
    try { if (wpDebugUnsubRef.current) { wpDebugUnsubRef.current(); wpDebugUnsubRef.current = null; } } catch {}
  }, [sitePath]);

  return {
    activeTab: activeLogTab,
    runtimeLogs,
    watchLogs,
    debugLogs,
    debugUnread,
    debugLogPath,
    debugCopied,
    runtimePane,
    watchPane,
    debugPane,
    makeOnScroll,
    ensureStick,
    selectTab,
    appendNpm,
    appendRuntime,
    appendWatch,
    clearDebugLog,
    copyDebugLog,
    revealDebugLog,
    startDebugTail,
    stopDebugTail
  };
}
