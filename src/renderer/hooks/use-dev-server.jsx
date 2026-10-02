import { useCallback, useEffect, useRef, useState } from 'react';
import { serveWithoutWatch } from '../dev-server-command.cjs';

// The site's dev server (#554): whether it is starting or up, its address, and
// the one button that starts and stops it.
//
// Starting is a sequence. The server serves build/, so the button first makes
// sure there is one: it starts the build watch and hangs the server's start
// off the watch being ready, or, on a project whose watcher would remove a
// build that is already there, starts the server at once. Then the server
// boots, which takes a while, can fail, and can be overtaken by a stop. The
// refs here are the guards for that: one start at a time, a stop that was
// asked for told from an exit that was not, a boot that was abandoned not
// brought back by a late answer.
//
// The server is the thing that brings the rest of a running site to life, so
// what it needs from the other domains comes in as arguments. `startBuildWatch`,
// `watchStateRef` and `buildInterruptedRef` are the build watch and the state
// of build/. `appendRuntime` and `ensureStick` are the Server pane of the Logs
// panel, and `startDebugTail` and `stopDebugTail` its debug.log tail.
// `listenForMail`, `stopListeningForMail` and `loadMail` are the site's mail.
// `terminalKillRef`, `markTerminalRunning` and `currentRunIdRef` are the
// terminal's lock and the script runner's current run, which a stop clears.
// `hasBuilt`, `setHasBuilt` and `skipInit` are what the site's status says,
// and `projectBuild` is the project's build plan.
//
// `toggleDevServer` is the button. `isServerStarting` and `isDevProcessActive`
// are what the page's words about the server are decided from, in
// site-processes.cjs, and `startElapsed` is how long a start has been going.
export function useDevServer({ sitePath, projectBuild, hasBuilt, setHasBuilt, skipInit, appendRuntime, ensureStick, startDebugTail, stopDebugTail, listenForMail, stopListeningForMail, loadMail, startBuildWatch, watchStateRef, buildInterruptedRef, currentRunIdRef, terminalKillRef, markTerminalRunning }) {
  const [serverUrl, setServerUrl] = useState('');
  const [starting, setStarting] = useState(false);
  const [running, setRunning] = useState(false);
  const [waitingForWatch, setWaitingForWatch] = useState(false);
  const serverStartRequestedRef = useRef(false);
  const stoppingRef = useRef(false);
  // True from a Stop we asked for until the server reports it has exited.
  // playground:stop returns once the signal is sent, and the 'stopped' event
  // arrives after stopDevServer has already cleared stoppingRef; without this
  // every ordinary stop read as a crash, and the crash path killed "the last
  // script in the directory", the watcher (#488).
  const serverStopRequestedRef = useRef(false);
  const runningRef = useRef(false);
  const waitingForWatchRef = useRef(false);
  // "A dev-server boot is in progress or live." The terminal lock used to double
  // as this signal, but the watcher no longer holds that lock (#247), so
  // startPhpServer needs its own flag to know the boot was not aborted.
  const devServerActiveRef = useRef(false);

  useEffect(() => { runningRef.current = running; }, [running]);
  useEffect(() => { waitingForWatchRef.current = waitingForWatch; }, [waitingForWatch]);

  const stopDevServer = useCallback(async () => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    if (runningRef.current) serverStopRequestedRef.current = true;
    devServerActiveRef.current = false;
    setWaitingForWatch(false);
    waitingForWatchRef.current = false;
    serverStartRequestedRef.current = false;
    setStarting(false);
    try { await window.api.stopServer(sitePath); } catch {}
    stopDebugTail();
    stopListeningForMail();
    setRunning(false);
    runningRef.current = false;
    setServerUrl('');
    stoppingRef.current = false;
    waitingForWatchRef.current = false;
    terminalKillRef.current = null;
    markTerminalRunning(false);
    currentRunIdRef.current = null;
    // The watcher is independent now (#247): stopping the dev server leaves it
    // running, so a contributor can keep compiling on save without serving the
    // site. Stopping it is its own button's business.
  }, [currentRunIdRef, markTerminalRunning, setRunning, setServerUrl, setStarting, setWaitingForWatch, sitePath, stopDebugTail, stopListeningForMail, terminalKillRef]);

  const startPhpServer = useCallback(async () => {
    if (serverStartRequestedRef.current || stoppingRef.current || !devServerActiveRef.current) {
      serverStartRequestedRef.current = false;
      return;
    }
    serverStartRequestedRef.current = true;
    serverStopRequestedRef.current = false;
    setWaitingForWatch(false);
    waitingForWatchRef.current = false;
    ensureStick('runtime');
    setStarting(true);
    // Subscribe to SMTP events before starting to avoid missing early events
    listenForMail();
    try {
      const res = await window.api.startServer(
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
        ()=>{
          const requested = serverStopRequestedRef.current;
          serverStopRequestedRef.current = false;
          setRunning(false); runningRef.current = false; setServerUrl(''); serverStartRequestedRef.current = false;
          // A stop the user did not ask for is a crash: say so, and tear the
          // server session down instead of leaving the button spinning
          // "Starting dev server…" forever (issue #73). The watcher is not
          // part of that session (#247) and is left running.
          if (!stoppingRef.current && !requested) {
            appendRuntime('Dev server stopped unexpectedly (see Help → Open App Log for details).\n');
            stopDevServer().catch(() => {});
          }
        }
      );
      // A failed start reports through the return value, not an exception.
      // This also covers spawn failures that never produce a "stopped" event.
      if (res && res.ok === false && !stoppingRef.current && !runningRef.current) {
        appendRuntime(`Dev server failed to start: ${res.error || 'unknown error'}\n`);
        stopDevServer().catch(() => {});
        return;
      }
    } catch (error) {
      appendRuntime(`Failed to start PHP server: ${error && error.message ? error.message : String(error)}\n`);
      setStarting(false);
      serverStartRequestedRef.current = false;
      runningRef.current = false;
      return;
    }
    await startDebugTail();
    await loadMail();
  }, [appendRuntime, ensureStick, listenForMail, loadMail, setRunning, setServerUrl, setStarting, sitePath, startDebugTail, stopDevServer]);

  const toggleDevServer = async ()=>{
    if (!running) {
      // A start is already queued behind the watch (or in flight): a second
      // click must not queue a second server start (#488).
      if (devServerActiveRef.current) return;
      // eslint-disable-next-line no-alert -- see the note above onRename in index.jsx.
      if (!skipInit && !hasBuilt) { alert('Please complete the full build before starting the dev server. You can also skip the wizard.'); return; }
      serverStartRequestedRef.current = false;
      devServerActiveRef.current = true;
      setStarting(true);
      // A built site whose watch would first remove build/ (Gutenberg's npm run
      // dev, #488) has nothing to wait for: the server starts on the build/ it
      // has, in seconds instead of the watch's rebuild (#499). The watch stays
      // where the contributor left it; Start build watch, or an apply, brings
      // it up when it is wanted. The rule, including what a watch already up
      // or cut short means, is serveWithoutWatch's. "Built" is read afresh:
      // the state copy is as old as the last status poll, and build/ may
      // have gone since (a watch rebuild, a clean by hand).
      let builtNow = hasBuilt;
      try { const fresh = await window.api.getSiteStatus(sitePath); builtNow = Boolean(fresh?.hasBuilt); setHasBuilt(builtNow); } catch {}
      if (serveWithoutWatch({ hasBuilt: builtNow, watchState: watchStateRef.current, buildInterrupted: buildInterruptedRef.current }, projectBuild)) {
        appendRuntime('build/ is complete: starting the server without the build watch. Start build watch to compile edits on save.\n');
        startPhpServer().catch(() => {});
        return;
      }
      // The server needs build/ on disk, which the build watch guarantees. Start
      // the watch first (automatically, if it is not already running) and hang
      // the server start off its readiness — the watch stays independent after.
      startBuildWatch({
        onReady: () => { startPhpServer().catch(() => {}); },
        // The watch never got to a complete build/: nothing to serve, so the
        // button goes back to "Start dev server" instead of "Starting…" forever.
        onFail: () => {
          if (serverStartRequestedRef.current) return;
          devServerActiveRef.current = false;
          setStarting(false);
          appendRuntime('Dev server start cancelled: the build watch stopped before build/ was complete. Start it again once the watch is running.\n');
        }
      });
    } else {
      // Only the server. The watch is independent (#247), and this branch
      // used to kill it by accident: killCurrent with no tracked run falls
      // back to the last script in the directory, which is the watcher. On
      // Core that cost a cheap grunt restart nobody noticed; on Gutenberg
      // it is the whole 20 s rebuild on every Stop/Start (#488).
      await stopDevServer();
    }
  };
  const isServerStarting = waitingForWatch || (starting && !serverUrl);
  const isDevProcessActive = running || isServerStarting;
  // Elapsed-seconds counter for the starting state, so a slow boot is
  // distinguishable from a hang (issue #73).
  const [startElapsed, setStartElapsed] = useState(0);
  useEffect(() => {
    if (!isServerStarting) {
      setStartElapsed(0);
      return undefined;
    }
    const id = setInterval(() => setStartElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isServerStarting]);

  return {
    serverUrl,
    starting,
    running,
    isServerStarting,
    isDevProcessActive,
    startElapsed,
    toggleDevServer
  };
}
