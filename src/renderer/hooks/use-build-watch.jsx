import { useCallback, useEffect, useRef, useState } from 'react';
import { planDevServerStart, createWatchReadyDetector } from '../dev-server-command.cjs';
import { createWatchWaiters, createRunGeneration, watchOccupiesBuild } from '../watch-waiters.cjs';
import { createWatchActivity } from '../watch-activity.cjs';

// The build watch (#247, #554): the process that compiles a contributor's
// edits as they save them. Its state, the run it is, who is waiting for it to
// be ready, and what can be done to it: start it, toggle it from its button
// (the only way it is stopped), pause it, resume it, and hand it a change to
// compile.
//
// It runs apart from the dev server and holds no terminal lock. The one
// exception is a site with no build: the watch cannot start on nothing, so a
// full build runs first, and that build does hold the lock, which is why the
// terminal's lock, its kill handler and the function that moves it are
// arguments. `runScript` and `killCurrent` are the site's script runner,
// `markBuildInterrupted` records that a rebuild was cut short, `appendWatch`
// and `selectLogTab` are the watch's pane in the Logs panel, `projectBuild` is
// the project's build plan and `hasBuilt` whether the site has a build.
//
// Three refs are handed out as they are, for the chains that decide from
// outside a render: `watchStateRef`, the state without waiting for a render;
// `watchWaitersRef`, the queue of who is waiting for the watch to be ready;
// and `applyHandOffRef`, which apply's hand-off to a resumed watch is current.
// That last one is the apply's, and is here because pausing the watch is what
// invalidates it. Every function returned keeps its identity for as long as
// its arguments do.
export function useBuildWatch({ sitePath, projectBuild, hasBuilt, runScript, killCurrent, markBuildInterrupted, appendWatch, selectLogTab, terminalStateRef, terminalKillRef, markTerminalRunning }) {
  // The build watcher (the target's, see project-type.cjs) runs decoupled from the PHP server (issue
  // #247): its own output tab, its own lifecycle. `watchState` drives the tab
  // title; `watchExitCode` is only read when the state is 'exited'.
  const [watchState, setWatchState] = useState('idle');
  const [watchExitCode, setWatchExitCode] = useState(null);
  // Ref mirror for the inline reads (guards, callbacks) that must not wait for a
  // re-render, the same split as the terminal's terminalRunning and
  // terminalStateRef.
  const watchStateRef = useRef('idle');
  // Set while the watcher is (or was) live, so a pause knows whether a resume
  // has anything to bring back. Survives the process being killed for a pause.
  const watchWasActiveRef = useRef(false);
  const markWatchState = useCallback((state, code = null) => {
    watchStateRef.current = state;
    setWatchState(state);
    if (state === 'exited') setWatchExitCode(Number.isFinite(code) ? code : null);
  }, []);
  // Whoever is waiting for the watch to be ready to serve behind — the dev
  // server start, today. The queue and its settle-once rule live in
  // watch-waiters.cjs; a ref because the watcher's output handler settles it
  // from outside a render (#488).
  const watchWaitersRef = useRef(createWatchWaiters());
  // Which apply's hand-off to the resumed watch is current (#506). The waiters
  // survive a pause (a queued dev-server start is meant to), so an apply's
  // waiter left over from a rebuild that a later pause cut short, or that a
  // later src-only apply overtook, would fire on the ready line and confirm an
  // apply already reported. Every apply, switch and pause invalidates the
  // generation; the callbacks check the token they were registered under. Same
  // mechanism as the watch runs (createRunGeneration), for the same reason.
  const applyHandOffRef = useRef(createRunGeneration());
  const settleWatchWaiters = useCallback((ready) => { watchWaitersRef.current.settle(ready); }, []);
  // Which watcher run is current. A stop returns before the process has
  // exited, so a run started right after inherits the old run's late
  // callbacks; each callback checks the token it was started with and leaves
  // a replaced run's state alone (#488).
  const watchGenerationRef = useRef(createRunGeneration());
  // Whether the watch is still compiling a change just handed to it (#492).
  // The ref keeps the timestamps; the state is what the banner and the tab
  // title read. A 500 ms tick while compiling is what flips it back.
  const watchActivityRef = useRef(createWatchActivity());
  const [watchCompiling, setWatchCompiling] = useState(false);
  useEffect(() => {
    if (!watchCompiling) return undefined;
    const tick = setInterval(() => {
      if (!watchActivityRef.current.isCompiling(Date.now())) setWatchCompiling(false);
    }, 500);
    return () => clearInterval(tick);
  }, [watchCompiling]);
  const handOffToWatch = useCallback(() => {
    watchActivityRef.current.handOff(Date.now());
    setWatchCompiling(true);
  }, []);
  const clearWatchActivity = useCallback(() => {
    watchActivityRef.current.clear();
    setWatchCompiling(false);
  }, []);
  // The watcher's own run handle, kept apart from currentRunIdRef so it can be
  // killed on its own (pause, dev-server stop) without disturbing whatever
  // one-shot the terminal is tracking.
  const watchRunIdRef = useRef(null);
  // Independence has a cost: nothing else tears the watcher down now, so when
  // this site view unmounts (site switch, window teardown) its process would be
  // orphaned. Kill it on unmount / before switching sites.
  useEffect(() => () => {
    watchGenerationRef.current.invalidate();
    const runId = watchRunIdRef.current;
    if (runId) window.api.npmKill({ runId, directoryPath: sitePath }).catch(() => {});
  }, [sitePath]);
  // Kills only the watcher, by its own runId, so stopping or pausing it never
  // reaches whatever one-shot currentRunIdRef is tracking. Kill by runId is
  // exact: the watcher is always stopped before any other per-directory run
  // starts, so main's one-per-directory fallback is never contended.
  const killWatcher = useCallback(async () => {
    const runId = watchRunIdRef.current;
    if (!runId) return;
    try {
      await window.api.npmKill({ runId, directoryPath: sitePath });
    } finally {
      watchRunIdRef.current = null;
    }
  }, [sitePath]);

  // The watcher process itself (the target's; grunt _watch on Core), streaming
  // into its own tab. No terminal lock, no server coupling — that independence
  // is the point of #247.
  //
  // When the watcher is ready to serve behind depends on the target (#488).
  // Core's grunt _watch touches nothing on start, so it is ready at once.
  // Gutenberg's npm run dev removes build/ and rebuilds it first, so the state
  // stays 'building' until the watcher prints the registry's readyPattern; a
  // server started before that line serves a plugin with no build/. The
  // waiters (the dev-server start) are settled either way: ready when the
  // watcher is, failed if it exits or is stopped first.
  const startWatchProcess = useCallback(() => {
    const plan = planDevServerStart({ hasBuilt: true }, projectBuild);
    const readiness = createWatchReadyDetector(plan.watch.readyPattern);
    const generation = watchGenerationRef.current;
    const token = generation.next();
    markWatchState(readiness.immediate ? 'watching' : 'building');
    watchWasActiveRef.current = true;
    appendWatch(`Running ${plan.watch.label}…\n`);
    if (!readiness.immediate) appendWatch(`${plan.watch.label} rebuilds build/ before it watches. The dev server, if you started it, waits for "${plan.watch.readyPattern}".\n`);
    if (readiness.immediate) settleWatchWaiters(true);
    runScript(plan.watch.script, {
      args: plan.watch.args,
      track: false,
      mirrorToNpm: false,
      onStart: (runId) => {
        // Stopped before the spawn resolved: this run must not be recorded as
        // the live watcher, and its process would otherwise outlive the stop.
        if (!generation.isCurrent(token)) { window.api.npmKill({ runId, directoryPath: sitePath }).catch(() => {}); return; }
        watchRunIdRef.current = runId;
      },
      onLog: (chunk) => {
        appendWatch(chunk);
        if (!generation.isCurrent(token)) return;
        // A line within the grace period can reopen a window the tick had
        // already closed (#492); the state has to follow the ref, or the
        // banner stays clear while the rebuild runs. The tick closes it.
        const now = Date.now();
        watchActivityRef.current.output(now);
        if (watchActivityRef.current.isCompiling(now)) setWatchCompiling(true);
        if (readiness.feed(chunk) && watchStateRef.current === 'building') {
          markBuildInterrupted(false);
          markWatchState('watching');
          settleWatchWaiters(true);
        }
      },
      onDone: ({ code }) => {
        appendWatch(`\n${plan.watch.label} exited with code ${code}\n`);
        // A replaced run's exit says nothing about the run that replaced it.
        if (!generation.isCurrent(token)) return;
        watchRunIdRef.current = null;
        clearWatchActivity();
        // A watcher exit never touches a running server (#247). Only an
        // unexpected exit flips the tab to 'exited'; a stop/pause we asked for
        // has already moved the state to 'idle'/'paused', so leave it be. A
        // server still waiting to start behind it does not get to: without a
        // completed build/ there is nothing to serve.
        if (watchOccupiesBuild(watchStateRef.current)) {
          if (watchStateRef.current === 'building') markBuildInterrupted(true);
          markWatchState('exited', code);
          watchWasActiveRef.current = false;
        }
        settleWatchWaiters(false);
      }
    });
  }, [appendWatch, clearWatchActivity, markBuildInterrupted, markWatchState, projectBuild, runScript, settleWatchWaiters, sitePath]);

  // Start the build watch, building first if the site has no completed build
  // (the _watch task deliberately skips that full build). `onReady` fires once
  // build/ is complete and the watch is watching — the server start hangs off
  // it, but the watch stays independent afterwards. `onFail` fires instead if
  // the watch never gets there: the build failed, the watcher exited or was
  // stopped first. A start requested while a watch is already on its way
  // queues behind that one rather than being dropped.
  const startBuildWatch = useCallback(({ onReady, onFail } = {}) => {
    const s = watchStateRef.current;
    if (s === 'watching') { if (onReady) onReady(); return; }
    watchWaitersRef.current.add(onReady, onFail);
    if (s === 'building') return; // already on its way to watching
    if (!hasBuilt) {
      // Fresh / skip-the-wizard sites need one full build before anything can
      // watch or serve. It is a one-shot, so it holds the terminal lock while
      // it runs; the watch that follows does not. Reveal the tab so the build
      // is visible.
      const state = terminalStateRef.current;
      if (state.running) { appendWatch('A command is already running in the terminal — stop it before starting the build watch.\n'); settleWatchWaiters(false); return; }
      selectLogTab('watch');
      markWatchState('building');
      watchWasActiveRef.current = true;
      markTerminalRunning(true);
      terminalKillRef.current = () => { killCurrent().catch(() => {}); };
      appendWatch('No completed build found — running npm run build first…\n');
      runScript('build', {
        mirrorToNpm: false,
        onLog: (chunk) => { appendWatch(chunk); },
        onDone: ({ code }) => {
          markTerminalRunning(false);
          terminalKillRef.current = null;
          if (code !== 0 || watchStateRef.current !== 'building') {
            if (code !== 0) { appendWatch(`\nnpm run build failed with code ${code} — build watch not started.\n`); markWatchState('exited', code); }
            else markWatchState('idle');
            watchWasActiveRef.current = false;
            settleWatchWaiters(false);
            return;
          }
          startWatchProcess();
        }
      });
    } else {
      startWatchProcess();
    }
  }, [appendWatch, hasBuilt, killCurrent, markTerminalRunning, markWatchState, runScript, selectLogTab, settleWatchWaiters, startWatchProcess, terminalKillRef, terminalStateRef]);

  // User-initiated stop of the watch (its own button). Never touches the server.
  const stopWatcher = useCallback(async () => {
    const wasBuilding = watchStateRef.current === 'building';
    if (wasBuilding) markBuildInterrupted(true);
    markWatchState('idle');
    watchWasActiveRef.current = false;
    // From here the run being stopped is history: its late exit must not
    // touch whatever starts next.
    watchGenerationRef.current.invalidate();
    clearWatchActivity();
    // A server waiting to start behind this watch is not going to.
    settleWatchWaiters(false);
    if (watchRunIdRef.current) {
      try { await killWatcher(); } catch {}
    } else if (wasBuilding) {
      // Still in the one-shot build phase — that run is the tracked one.
      try { await killCurrent(); } catch {}
      markTerminalRunning(false);
      terminalKillRef.current = null;
    }
  }, [clearWatchActivity, killCurrent, killWatcher, markBuildInterrupted, markTerminalRunning, markWatchState, settleWatchWaiters, terminalKillRef]);

  // Pause the watch for an operation that needs the build directory and
  // node_modules to itself — an install, a full build, a trunk reset (#262).
  // Returns whether it actually paused, so a caller can log accordingly; resume
  // is safe to call unconditionally since it no-ops unless the state is 'paused'.
  const pauseWatcher = useCallback(async () => {
    if (watchStateRef.current !== 'watching' && watchStateRef.current !== 'building') return false;
    markWatchState('paused');
    watchGenerationRef.current.invalidate();
    applyHandOffRef.current.invalidate();
    clearWatchActivity();
    appendWatch('\nPaused while another operation uses the build.\n');
    try { await killWatcher(); } catch {}
    return true;
  }, [appendWatch, clearWatchActivity, killWatcher, markWatchState]);

  // Bring the watch back after a pause. Guarded on 'paused' so a dev-server stop
  // or a manual stop mid-operation (which sets 'idle') is never resurrected.
  const resumeWatcher = useCallback(() => {
    if (watchStateRef.current !== 'paused') return;
    appendWatch('\nResumed.\n');
    startWatchProcess();
  }, [appendWatch, startWatchProcess]);

  const toggleWatch = useCallback(() => {
    const s = watchStateRef.current;
    if (s === 'watching' || s === 'building') { stopWatcher(); return; }
    // Starting it from its own button reveals the tab, whether or not a build
    // runs first — that is where its output and state live.
    selectLogTab('watch');
    startBuildWatch();
  }, [selectLogTab, startBuildWatch, stopWatcher]);

  return {
    watchState,
    watchExitCode,
    watchCompiling,
    watchStateRef,
    watchWaitersRef,
    applyHandOffRef,
    handOffToWatch,
    startBuildWatch,
    pauseWatcher,
    resumeWatcher,
    toggleWatch
  };
}
