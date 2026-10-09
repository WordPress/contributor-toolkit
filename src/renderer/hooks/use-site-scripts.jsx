import { useCallback, useRef, useState } from 'react';
import { phpunitStart } from '../phpunit-start.cjs';
import { runFailedInTerminal } from '../terminal-hints.cjs';

// The npm runs a site's view starts (#554): npm install and the site's npm
// scripts, with what the rest of the view needs to know about them. Whether an
// install or a build is running, whether the last build failed, whether the
// last thing to write build/ was cut short, and which run Ctrl+C or a stop
// should reach.
//
// Everything that runs one goes through here: the terminal, the setup, a trunk
// update, an applied patch, a ticket switch and the build watch. They pass
// `onLog` and `onDone` for what they do with a run's output and its end; what
// is common to every run is here. An install that ends well marks the site
// initialised, an install or a build that ends reloads the site's status,
// and a run's output is copied into the install log's buffer unless its
// caller says not to, as the build watch does; `appendNpm` and `ensureStick`
// are for that buffer.
//
// `loadStatus` reloads what the view knows about the site, and `onInitialized`
// tells the window that a site has its dependencies. `onRunFailed` is told
// when an install or a build fails with its output in the terminal, which is
// where a run's output goes unless its caller says otherwise
// (`outputInTerminal: false`, as the build watch does: it prints in its own
// log). What counts as failing is `runFailedInTerminal`'s to say; a run that
// was asked to stop, through `killCurrent`, did not.
//
// `buildInterrupted` is here and not with the build watch, though the watch is
// what sets it, because a build that ends well is what clears it, and the
// runner is where a build ends. `buildInterruptedRef` and `currentRunIdRef`
// are handed out as they are, for the callbacks that read or clear them from
// outside a render. Every function returned keeps its identity for as long as
// its arguments do.
export function useSiteScripts({ sitePath, appendNpm, ensureStick, loadStatus, onInitialized, onRunFailed }) {
  const [installing, setInstalling] = useState(false);
  const [building, setBuilding] = useState(false);
  // The build's counterpart to installFailed — session-local, because only the
  // install outcome is persisted (main.js records it on the site's meta). After
  // a restart a failed build reads "Ready" again, which is the honest fallback:
  // the app knows there is no build on disk, just not that the last attempt lost.
  const [buildFailed, setBuildFailed] = useState(false);
  // True while the last thing to touch build/ was a watch rebuild that did not
  // finish: stopped or crashed while 'building'. build/ may then be empty or
  // half written whatever the status's marker file says, so the server does
  // not start on it without a watch (#499, serveWithoutWatch). Cleared when a
  // watch reaches watching or a one-shot npm run build exits 0.
  // The ref is what the callbacks read; the state is what the applied banner
  // reads (#509), so both move together.
  const buildInterruptedRef = useRef(false);
  const [buildInterrupted, setBuildInterrupted] = useState(false);
  const markBuildInterrupted = useCallback((interrupted) => {
    buildInterruptedRef.current = interrupted;
    setBuildInterrupted(interrupted);
  }, []);
  const currentRunIdRef = useRef(null);
  // Whether the run under way was asked to stop: by Ctrl+C in the terminal,
  // or by a button on the page, as a setup is. Set by `killCurrent`, and put
  // back when the next run starts.
  const stopRequestedRef = useRef(false);

  const runInstall = useCallback((options = {}) => {
    const { onLog, onDone, outputInTerminal = true } = options;
    setInstalling(true);
    stopRequestedRef.current = false;
    ensureStick('npm');
    window.api.runNpmInstall(sitePath, ({ data }) => {
      appendNpm(data);
      if (onLog) onLog(data);
    }, async ({ code }) => {
      appendNpm(`\ninstall exited with code ${code}\n`);
      setInstalling(false);
      // A failed install must not mark the site initialized (#42): the wizard
      // would advance to a build that cannot work. Leaving the step incomplete
      // keeps the install button available for a retry.
      if (code === 0) { try { await window.api.markSiteInitialized(sitePath); } catch {} onInitialized(sitePath); }
      try { await loadStatus(); } catch {}
      if (runFailedInTerminal({ code, outputInTerminal, stopRequested: stopRequestedRef.current })) onRunFailed();
      if (onDone) onDone({ code });
    }).catch((error) => {
      // A start that never got as far as a run id, so no done event is coming
      // for it (#43): without this the button stays spinning on a run that does
      // not exist. Same shape as runScript's catch.
      appendNpm(`\nFailed to start npm install: ${error && error.message ? error.message : String(error)}\n`);
      setInstalling(false);
      if (runFailedInTerminal({ code: -1, outputInTerminal })) onRunFailed();
      if (onDone) onDone({ code: -1 });
    });
  }, [appendNpm, ensureStick, loadStatus, onInitialized, onRunFailed, sitePath]);

  // `track` (default) records the run in currentRunIdRef so killCurrent/Ctrl+C
  // reach it; the decoupled watcher passes track:false and takes its runId
  // through onStart into its own ref instead. `mirrorToNpm` (default) copies the
  // output into the shared npm buffer; the watcher passes false so its stream
  // stays in its own tab (and does not grow that buffer without bound).
  const runScript = useCallback((name, options = {}) => {
    const { onLog, onDone, args = [], track = true, mirrorToNpm = true, outputInTerminal = true, onStart } = options;
    ensureStick('npm');
    // Clearing the failure here rather than on the next exit is what stops the
    // step reading "Failed" while its own retry is streaming to the terminal.
    if (name === 'build') { setBuilding(true); setBuildFailed(false); }
    if (track) { currentRunIdRef.current = null; stopRequestedRef.current = false; }
    return window.api.runNpmScript(sitePath, name, args, ({ data }) => {
      if (mirrorToNpm) appendNpm(data);
      if (onLog) onLog(data);
    }, async ({ code }) => {
      if (mirrorToNpm) appendNpm(`\n${name} exited with code ${code}\n`);
      if (name === 'build') {
        setBuilding(false);
        setBuildFailed(code !== 0);
        if (code === 0) markBuildInterrupted(false);
        try { await loadStatus(); } catch {}
        if (runFailedInTerminal({ code, outputInTerminal, stopRequested: stopRequestedRef.current })) onRunFailed();
      }
      if (track) currentRunIdRef.current = null;
      if (onDone) onDone({ code });
    }).then(({ runId }) => {
      if (track) currentRunIdRef.current = runId;
      if (onStart) onStart(runId);
    }).catch((error) => {
      if (track) currentRunIdRef.current = null;
      if (mirrorToNpm) appendNpm(`\nFailed to start npm run ${name}: ${error && error.message ? error.message : String(error)}\n`);
      if (name === 'build') {
        setBuilding(false);
        if (runFailedInTerminal({ code: -1, outputInTerminal })) onRunFailed();
      }
      if (onDone) onDone({ code: -1 });
    });
  }, [appendNpm, ensureStick, loadStatus, markBuildInterrupted, onRunFailed, sitePath]);

  // The last PHP unit test run on this site, for the Tests section to say how
  // it went (phpunit-result.cjs): the command, whether it is still running,
  // and once it ends its code, whether it was stopped, and the end of what it
  // printed, where PHPUnit's summary is. Kept for the session only. The output
  // gathers in a ref while the run streams, so the view is drawn twice per
  // run and not once per line.
  const [phpunitRun, setPhpunitRun] = useState(null);
  const phpunitOutputRef = useRef('');

  // Core's PHP unit tests, tracked like a script so killCurrent/Ctrl+C reach
  // them. What main's answer means is phpunit-start.cjs's to say; a run that
  // did not start gets no done event, so it is settled here with -1.
  const runPhpUnit = useCallback((args, options = {}) => {
    const { onLog, onDone } = options;
    const command = ['phpunit', ...args].join(' ');
    ensureStick('npm');
    currentRunIdRef.current = null;
    stopRequestedRef.current = false;
    phpunitOutputRef.current = '';
    setPhpunitRun({ command, running: true });
    const ended = (code, notStarted = false) => {
      setPhpunitRun({ command, running: false, code, notStarted, stopped: stopRequestedRef.current, output: phpunitOutputRef.current });
    };
    const settle = (answer) => {
      const { runId, error } = phpunitStart(answer);
      if (runId) {
        currentRunIdRef.current = runId;
        return;
      }
      currentRunIdRef.current = null;
      appendNpm(`\nFailed to start phpunit: ${error}\n`);
      ended(-1, true);
      if (onLog) onLog(`\n${error}\n`);
      if (onDone) onDone({ code: -1 });
    };
    return window.api.runPhpUnit(sitePath, args, ({ data }) => {
      appendNpm(data);
      // The summary is the last thing PHPUnit prints; the end is enough.
      phpunitOutputRef.current = (phpunitOutputRef.current + data).slice(-8000);
      if (onLog) onLog(data);
    }, ({ code }) => {
      appendNpm(`\nphpunit exited with code ${code}\n`);
      currentRunIdRef.current = null;
      ended(code);
      if (onDone) onDone({ code });
    }).then(settle, settle);
  }, [appendNpm, ensureStick, sitePath]);

  const killCurrent = useCallback(async () => {
    const runId = currentRunIdRef.current;
    stopRequestedRef.current = true;
    try {
      await window.api.npmKill({ runId, directoryPath: sitePath });
    } finally {
      currentRunIdRef.current = null;
    }
  }, [sitePath]);

  return {
    installing,
    building,
    buildFailed,
    buildInterrupted,
    buildInterruptedRef,
    markBuildInterrupted,
    currentRunIdRef,
    runInstall,
    runScript,
    runPhpUnit,
    phpunitRun,
    killCurrent
  };
}
