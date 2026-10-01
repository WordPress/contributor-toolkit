import { useRef, useState } from 'react';
import { planUpdateSteps, updateStepStatuses, SKIP_INSTALL_MESSAGE, planWatchImpact } from '../update-plan.cjs';
import { planUpdateHandOff } from '../update-handoff.cjs';
import { watchOccupiesBuild } from '../watch-waiters.cjs';
import { discardOutcome, DISCARD_CONFIRM_MESSAGE } from '../changes-note.cjs';
import { pathBasename } from '../path-basename.cjs';

// Updating a site to the latest trunk (#94, #554): the chain that fetches and
// resets the checkout, installs if the lockfile moved, and rebuilds; the
// question it asks first when the tree has edits in it; and the way back in
// when a run was cut short.
//
// It is a chain, not a process of its own. The fetch and the reset are the
// main process's; everything after goes through what the site's view already
// has, which is why so much comes in as arguments. `runInstall`, `runScript`
// and `killCurrent` are the script runner, with `installing` and `building`
// the flags that keep a second chain from starting. `terminalStateRef`,
// `terminalKillRef`, `markTerminalRunning` and `writeToTerminal` are the
// terminal: the chain holds its lock, writes its progress there and leaves
// there what Ctrl+C should stop. `watchStateRef`, `watchWaitersRef`,
// `pauseWatcher`, `resumeWatcher` and `watchRebuildsOnStart` are the build
// watch, which is paused for the reset and brought back after, and which on
// some projects does the update's build (#507). `loadStatus` and
// `refreshDirty` re-read the site once the tree has changed, and
// `applyDiscardToNote` tells the unsubmitted-changes note that edits were
// thrown away. `confirm` announces an outcome, and `confirmAnd` asks before
// one that loses work.
//
// None of the functions here is memoised, as none was: they are called from
// handlers and from each other, never listed as a dependency.
//
// Not here: the date of the site's trunk and the marker that an update is
// incomplete. Both are read from the site's status with everything else the
// status says, and this hook only asks for the status to be read again.
export function useTrunkUpdate({ sitePath, confirm, confirmAnd, installing, building, runInstall, runScript, killCurrent, terminalStateRef, terminalKillRef, markTerminalRunning, writeToTerminal, watchStateRef, watchWaitersRef, pauseWatcher, resumeWatcher, watchRebuildsOnStart, loadStatus, refreshDirty, applyDiscardToNote }) {
  const [updateState, setUpdateState] = useState('idle'); // idle | fetching | installing | building
  // Who runs the update's build: null for the chain itself, 'resumed-watch'
  // when the watch paused for the reset rebuilds from scratch as it resumes and
  // the chain leaves the one build to it (Gutenberg, #507). Decided where the
  // watch is paused, read by the step card and the install step's hand-off.
  const [updateBuildBy, setUpdateBuildBy] = useState(null);
  // True from the hand-off to the resumed watch until its ready line or exit.
  // The card stays on step 3 and every isUpdating gate holds, except Stop build
  // watch: it is the one control that can end the wait, and a hung watch would
  // otherwise leave the site row inert until an app restart (#507). The terminal
  // lock is released (the watch holds none), but the prompt hints stay busy so
  // the card does not offer npm run build over the tree the watch is rebuilding.
  const [updateWaitingOnWatch, setUpdateWaitingOnWatch] = useState(false);
  const [dirtyModalOpen, setDirtyModalOpen] = useState(false);
  const [dirtySaving, setDirtySaving] = useState(false);
  const [dirtyFiles, setDirtyFiles] = useState([]);
  const [dirtyError, setDirtyError] = useState(null); // failure text shown inside the dirty-tree modal
  const [updateLockfileChanged, setUpdateLockfileChanged] = useState(false);
  const [lastUpdateSummary, setLastUpdateSummary] = useState(null);
  const updateStartRef = useRef(null);
  const savedPatchPathRef = useRef(null);
  const isUpdating = updateState !== 'idle';
  const updateSteps = planUpdateSteps({ lockfileChanged: updateLockfileChanged, buildByWatcher: updateBuildBy });
  const updateStepStates = updateStepStatuses(updateSteps, updateState);

  const finishUpdate = (message) => {
    markTerminalRunning(false);
    terminalKillRef.current = null;
    setUpdateState('idle');
    setUpdateWaitingOnWatch(false);
    if (message) writeToTerminal(message);
    // Resume the watch if the update paused it (#262). Safe on every exit path
    // and a no-op if nothing was paused.
    resumeWatcher();
    loadStatus().catch(() => {});
    refreshDirty();
  };

  // Steps 2 and 3 of the chain: npm install (only when the lockfile moved,
  // and named when skipped) then a rebuild. Reuses the wizard's runInstall /
  // runScript so exit codes, retries and terminal streaming all behave
  // exactly as they do everywhere else (same pattern as toggleDevServer).
  const runUpdateInstallAndBuild = (lockfileChanged, { buildBy = null } = {}) => {
    // build/ matches the new source: persist it, summarise, confirm. Shared by
    // the chain's own build and the resumed watch's ready line.
    const completeUpdate = async () => {
      try { await window.api.markUpdateComplete(sitePath); } catch {}
      const elapsedSeconds = updateStartRef.current ? Math.round((Date.now() - updateStartRef.current) / 1000) : null;
      setLastUpdateSummary({ lockfileChanged, elapsedSeconds, savedPatchPath: savedPatchPathRef.current });
      confirm('Updated to the latest trunk');
    };
    const runBuildStep = () => {
      setUpdateState('building');
      writeToTerminal('\nRunning npm run build…\n');
      runScript('build', {
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: async ({ code }) => {
          if (code === 0) {
            await completeUpdate();
            finishUpdate('\nUpdate complete — this site is now on the latest trunk.\n');
          } else {
            finishUpdate('\nUpdate incomplete — the build failed. The code is new but the built assets are old; retry install & build from the banner above.\n');
          }
        }
      });
    };
    // The watch paused for the reset rebuilds build/ from scratch when it
    // resumes (Gutenberg, #507), so a build of our own would be thrown away the
    // moment it comes back. Resume it now and let that be the one build. Unlike
    // an apply (#506), the update is not done at the hand-off: the card stays
    // on step 3, naming the watch, and the persisted "complete" marker waits for
    // the ready line, so a watch that exits first leaves the update incomplete
    // with the same banner and retry a failed build would. The terminal is
    // released: the watch writes to its own tab and holds no terminal lock.
    // No generation token here, unlike the apply: any ready line means build/
    // is complete, which is exactly what "update complete" claims, and a card
    // left on step 3 by a skipped settle would have no way off it. That is safe
    // only because every path that pauses or restarts the watch (a PR switch,
    // a ticket switch, an apply, a retry) is gated on isUpdating, which holds
    // through the wait; the terminal lock those paths also check is released
    // here, so the isUpdating gates are what keeps a pause (which kills the
    // watch without settling the waiters) from orphaning this waiter. Loosen
    // one of those gates and this needs the token.
    const handOffToResumedWatch = () => {
      const plan = planUpdateHandOff(watchStateRef.current);
      if (!plan.waits) {
        finishUpdate(plan.finish.message);
        return;
      }
      // One way to apply an outcome, so the ready line and the exit cannot
      // drift apart: the plan says which state each lands in and whether it is
      // the one that completes the update.
      const settle = async (phase) => {
        if (phase.completesUpdate) await completeUpdate();
        setUpdateState(phase.updateState);
        setUpdateWaitingOnWatch(phase.waitingOnWatch);
        writeToTerminal(phase.message);
        loadStatus().catch(() => {});
        refreshDirty();
      };
      // Registered before the resume so a watch that dies at once still lands
      // in onFail. The waiters settle once per run: on the ready line or on exit.
      watchWaitersRef.current.add(
        () => { settle(plan.ready); },
        () => { settle(plan.failed); }
      );
      setUpdateState(plan.waiting.updateState);
      setUpdateWaitingOnWatch(plan.waiting.waitingOnWatch);
      // The watch writes to its own tab and holds no terminal lock, so the
      // chain gives this one back while it waits.
      markTerminalRunning(false);
      terminalKillRef.current = null;
      writeToTerminal(plan.waiting.message);
      resumeWatcher();
    };
    const afterInstall = buildBy === 'resumed-watch' ? handOffToResumedWatch : runBuildStep;
    if (lockfileChanged) {
      setUpdateState('installing');
      writeToTerminal('\npackage-lock.json changed — running npm install (only the changed packages are downloaded)…\n');
      runInstall({
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          if (code !== 0) {
            finishUpdate('\nUpdate incomplete — npm install failed. The code is new but dependencies and built assets are old; retry install & build from the banner above.\n');
            return;
          }
          afterInstall();
        }
      });
    } else {
      writeToTerminal(`\n${SKIP_INSTALL_MESSAGE}\n`);
      afterInstall();
    }
  };

  // Step 1: fetch + reset in the main process, then hand over to the npm
  // steps. Assumes the tree is clean (startTrunkUpdate handles dirty trees).
  const beginTrunkUpdate = async () => {
    const state = terminalStateRef.current;
    if (state.running) {
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
      return;
    }
    // A trunk reset rewrites the whole tree at once; a live watch would try to
    // recompile mid-reset. Pause it for the update; finishUpdate resumes it. The
    // PHP server stays up — the rebuild regenerates build/ under it (#262).
    // Whether the update builds after depends on what the resumed watch does:
    // on Gutenberg it rebuilds from scratch anyway, so the one build is its
    // (#507). Decided here, where the watch is paused, like a PR checkout.
    const impact = planWatchImpact({ needsInstall: false, watcherActive: watchOccupiesBuild(watchStateRef.current), watchRebuildsOnStart, wholeTree: true });
    setUpdateBuildBy(impact.buildBy);
    setUpdateWaitingOnWatch(false);
    if (impact.pauseWatcher) await pauseWatcher();
    markTerminalRunning(true);
    terminalKillRef.current = () => { killCurrent().catch(() => {}); };
    setUpdateLockfileChanged(false);
    setLastUpdateSummary(null);
    updateStartRef.current = Date.now();
    setUpdateState('fetching');
    window.api.updateTrunk(sitePath, ({ data }) => writeToTerminal(data), (res) => {
      if (!res || !res.ok) {
        // The main process already wrote the failure message to the stream.
        finishUpdate();
        return;
      }
      if (res.upToDate) {
        // Nothing to fetch — but "Already up to date." only reaching the
        // terminal left the contributor unsure the check had even run (#253).
        // The confirmation says so where it will be seen; there is no install
        // or build to follow.
        confirm('Already up to date with trunk');
        finishUpdate();
        return;
      }
      setUpdateLockfileChanged(Boolean(res.lockfileChanged));
      runUpdateInstallAndBuild(Boolean(res.lockfileChanged), { buildBy: impact.buildBy });
    });
  };

  const startTrunkUpdate = async () => {
    // The dev server no longer blocks an update: the watch is paused for the
    // reset and the PHP server stays up (#262). Only real in-progress work
    // (an update, install or build already running) still blocks.
    if (isUpdating || installing || building) return;
    savedPatchPathRef.current = null;
    try {
      const res = await window.api.isWorktreeDirty(sitePath);
      if (res && res.ok && res.dirty) {
        setDirtyFiles(Array.isArray(res.files) ? res.files : []);
        setDirtyError(null);
        setDirtyModalOpen(true);
        return;
      }
    } catch {}
    beginTrunkUpdate();
  };

  // Dirty-tree resolutions. Saving is the default: it is what the tool is
  // for, and it is the only option that cannot lose work.
  const dirtySaveAndUpdate = async () => {
    setDirtySaving(true);
    setDirtyError(null);
    try {
      const res = await window.api.savePatch(sitePath);
      if (res && res.canceled) return; // stay in the modal
      if (!res || !res.ok || !res.filePath) {
        setDirtyError(`Error saving diff: ${res && res.error ? res.error : 'Unknown error'}`);
        return;
      }
      const d = await window.api.discardChanges(sitePath);
      if (!d || !d.ok) {
        setDirtyError(`Saved your changes to ${res.filePath}, but resetting the working tree failed: ${d && d.error ? d.error : 'Unknown error'}`);
        return;
      }
      savedPatchPathRef.current = res.filePath;
      applyDiscardToNote(discardOutcome(d));
      setDirtyModalOpen(false);
      writeToTerminal(`\nSaved your changes to ${res.filePath} and reset the working tree.\n`);
      // This ran as the contributor closed the modal; the confirmation is the
      // only trace of it outside the terminal (#253).
      confirm(`Saved your changes to ${pathBasename(res.filePath)} and reset the working tree`);
      beginTrunkUpdate();
    } finally {
      setDirtySaving(false);
    }
  };

  const dirtyDiscardAndUpdate = () => confirmAnd(DISCARD_CONFIRM_MESSAGE, async () => {
    setDirtyError(null);
    const d = await window.api.discardChanges(sitePath);
    if (!d || !d.ok) {
      setDirtyError(`Failed to discard changes: ${d && d.error ? d.error : 'Unknown error'}`);
      return;
    }
    applyDiscardToNote(discardOutcome(d));
    setDirtyModalOpen(false);
    writeToTerminal('\nDiscarded local changes.\n');
    confirm('Local changes discarded.');
    beginTrunkUpdate();
  });

  // Re-entry point for a previously interrupted update: trunk already moved,
  // so only install+build remain. Install runs unconditionally — the
  // lockfile delta from the failed run is no longer known.
  const retryInstallAndBuild = async () => {
    const state = terminalStateRef.current;
    if (state.running) {
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
      return;
    }
    // Same as beginTrunkUpdate: install + a full build need the tree to
    // themselves, so pause the watch; finishUpdate resumes it (#262). And the
    // same hand-off when the resumed watch is the one that rebuilds (#507).
    const impact = planWatchImpact({ needsInstall: true, watcherActive: watchOccupiesBuild(watchStateRef.current), watchRebuildsOnStart, wholeTree: true });
    setUpdateBuildBy(impact.buildBy);
    setUpdateWaitingOnWatch(false);
    if (impact.pauseWatcher) await pauseWatcher();
    markTerminalRunning(true);
    terminalKillRef.current = () => { killCurrent().catch(() => {}); };
    setUpdateLockfileChanged(true);
    setLastUpdateSummary(null);
    updateStartRef.current = Date.now();
    runUpdateInstallAndBuild(true, { buildBy: impact.buildBy });
  };

  return {
    updateState,
    isUpdating,
    updateWaitingOnWatch,
    updateSteps,
    updateStepStates,
    lastUpdateSummary,
    setLastUpdateSummary,
    dirtyModalOpen,
    setDirtyModalOpen,
    dirtySaving,
    dirtyFiles,
    dirtyError,
    startTrunkUpdate,
    dirtySaveAndUpdate,
    dirtyDiscardAndUpdate,
    retryInstallAndBuild
  };
}
