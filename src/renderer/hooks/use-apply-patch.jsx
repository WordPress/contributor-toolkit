import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { __, sprintf } from '@wordpress/i18n';
import { parsePrRef } from '../../patch-sources.cjs';
import { describeApplyFailure, otherPatchCount } from '../apply-conflict.cjs';
import { applyDoneMessage } from '../confirmations.cjs';
import { prCheckoutRefusal } from '../pr-checkout.cjs';
import { savedPrForSwitch } from '../ticket-branch-list.cjs';
import { planApplySteps, updateStepStatuses, planWatchImpact, planTicketSwitchImpact, skipInstallMessage, APPLY_STATE_TO_STEP } from '../update-plan.cjs';
import { applyLines, applyFinishMessage, resumedWatchHandOff } from '../watch-activity.cjs';
import { watchOccupiesBuild } from '../watch-waiters.cjs';

// Putting someone else's work on a site (#11, #458, #554): the patches and
// pull requests a ticket offers, the preview of what one would change, and
// the chain that applies it, takes it off again, checks a pull request out
// or leaves one, and rebuilds the site around the result.
//
// Three things are one here because they cannot be told apart at the edges.
// What there is to apply (the ticket's linked pull requests and its Trac
// attachments) is read for the same panel that previews and applies it, and a
// failed apply counts the other patches on offer. The chain itself is a
// chain, not a process: the checkout and the patch are the main process's,
// and what follows goes through the script runner, the terminal and the
// build watch, which is why they come in as arguments. And a ticket switch
// that puts a parked pull request back ends in this chain's install and
// build.
//
// That last one is why this hook and useSiteTicket hold each other's refs.
// The ticket hook is called first and makes them; this one fills them, on
// every render, with what a switch calls before, after and at its end
// (`ticketSwitchLifecycleRef`) and with the pull request's checkout to try
// again (`retryPrSwitchRef`), and reads from `autoReadTicketRef` the ticket a
// link made by hand wants its details read for. `setTicketError` and
// `setBlockedByTrunkWork` are the ticket hook's, for a switch refused here
// and for the question about trunk's loose edits; `ticketBranches` is its
// list of the tickets with work on this site.
//
// `tracTicket`, `appliedPatch` and `pullRequest` are what the site's status
// says is linked, applied and checked out. `loadStatus` and `refreshDirty`
// re-read the site once the tree has changed. `confirm` announces an outcome.
// `showTracCards` and `isActive` say whether this project has Trac's
// attachments and whether this site is the one in front, which is when its
// ticket's pull requests are fetched. `project` and `workItem` name the
// repository and read a ticket's reference.
//
// The build watch's part: a change it can recompile is handed to it
// (`handOffToWatch`), a change of the whole tree pauses it (`pauseWatcher`)
// and brings it back (`resumeWatcher`), and where the watcher rebuilds
// everything as it starts, the chain waits on `watchWaitersRef` for it to be
// ready, checking `applyHandOffRef` that it is still the apply being waited
// for. `watchStateRef` and `watchRebuildsOnStart` are what those decisions
// read.
//
// `refuseInTerminal` says in the terminal that a command is already running,
// and brings the terminal up to be read (#558); `revealTerminal` brings it up
// for a failure that is only printed there.
//
// None of the chain's functions is memoised, as none was.
export function useApplyPatch({ sitePath, project, workItem, showTracCards, isActive, tracTicket, appliedPatch, pullRequest, ticketBranches, setTicketError, setBlockedByTrunkWork, retryPrSwitchRef, ticketSwitchLifecycleRef, autoReadTicketRef, confirm, loadStatus, refreshDirty, runInstall, runScript, killCurrent, terminalStateRef, terminalKillRef, markTerminalRunning, writeToTerminal, refuseInTerminal, revealTerminal, watchStateRef, watchWaitersRef, applyHandOffRef, handOffToWatch, pauseWatcher, resumeWatcher, watchRebuildsOnStart }) {
  // Patches on the linked ticket (#11): { status, items, cachedAt } or null.
  const [ticketPatches, setTicketPatches] = useState(null);
  const [ticketPatchesLoading, setTicketPatchesLoading] = useState(false);
  const [fetchingPr, setFetchingPr] = useState(null);
  // Trac attachments (#11): loaded on demand, since opening a real Trac window
  // can surface the proof-of-work challenge. null until the user asks.
  const [tracAttachments, setTracAttachments] = useState(null);
  const [tracAttachmentsLoading, setTracAttachmentsLoading] = useState(false);
  const [fetchingAttachment, setFetchingAttachment] = useState(null);
  // Applying someone else's patch (#11)
  const [applyState, setApplyState] = useState('idle'); // idle | applying | installing | building
  const [applyPreview, setApplyPreview] = useState(null);
  const [applyKind, setApplyKind] = useState('patch');
  // Held separately from applyPreview: the preview is cleared the moment the
  // chain starts, and the step list still has to know whether install runs.
  const [applyNeedsInstall, setApplyNeedsInstall] = useState(false);
  // Which watch does the rebuild instead of the apply chain, so its build step
  // shows skipped and attributed to it: 'live-watch' when a running watch
  // recompiles the change (#262), 'resumed-watch' when the watch paused for the
  // apply rebuilds from scratch as it resumes (#506), null when the chain builds.
  const [applyBuildByWatcher, setApplyBuildByWatcher] = useState(null);
  const [applyError, setApplyError] = useState('');
  // The failure broken down: which regions of the patch no longer fit, where,
  // why, and what they were trying to change (#282, #226). Held beside
  // applyError rather than replacing it — a refusal with nothing to break down
  // (a parse error, a rolled-back write) still has only its sentence.
  const [applyConflict, setApplyConflict] = useState(null);
  // One call, because the breakdown must never outlive the sentence it belongs
  // to: every place that took the error banner down predates it, and any that
  // cleared only one would leave regions on screen describing a patch the
  // contributor has moved on from.
  const clearApplyError = () => { setApplyError(''); setApplyConflict(null); };
  // Not every unhappy ending is a failure: a revert can find that the patch is
  // already gone, which resolves the situation rather than blocking it. Red
  // would read as "you broke something" when nothing is left to do.
  const [applyNotice, setApplyNotice] = useState('');
  const [prUrlInput, setPrUrlInput] = useState('');
  // The watch decision a saved-work restore made in begin, for its complete.
  const switchImpactRef = useRef(null);
  // Same three-stage shape as the update chain, and the same npm wrappers, so
  // exit codes and terminal streaming behave identically.
  const isApplying = applyState !== 'idle';
  const applySteps = planApplySteps({ needsInstall: applyNeedsInstall, buildByWatcher: applyBuildByWatcher, kind: applyKind });
  const applyStepStates = updateStepStatuses(applySteps, applyState, APPLY_STATE_TO_STEP);
  // The panel lists only what can be applied — screenshots and other non-patch
  // attachments are noise here. The parser still returns them (pickLatest and
  // tests rely on the full list); the filtering is purely what's shown.
  const patchAttachments = (tracAttachments?.items || []).filter((a) => a.applyable);

  // `settled` is what the terminal says instead of `message` while a resumed
  // watch is still rebuilding (applyFinishMessage).
  const finishApply = (message, settled) => {
    markTerminalRunning(false);
    terminalKillRef.current = null;
    setApplyState('idle');
    // Resume the watch if this apply paused it. Safe on every exit path
    // (success, failure, cancel) and a no-op if nothing was paused (#262).
    resumeWatcher();
    // A resumed watch that rebuilds from scratch (Gutenberg's npm run dev)
    // leaves the site unusable until it is watching again, and the banner
    // above is already up (#492). The banner says so; so does the terminal,
    // in place of "open the site to try it out".
    if (message) writeToTerminal(applyFinishMessage(message, watchStateRef.current, settled));
    loadStatus().catch(() => {});
    refreshDirty();
  };

  const runApplyInstallAndBuild = (needsInstall, verb, { buildBy = null, noun = 'patch' } = {}) => {
    const lines = applyLines(verb, noun);
    const finishTryIt = () => finishApply(`\n${lines.tryIt}\n`, `\n${lines.settled}\n`);
    const runBuildStep = () => {
      setApplyState('building');
      // translators: %s: the command being run, such as npm run build.
      writeToTerminal(`\n${sprintf(__('Running %s…'), 'npm run build')}\n`);
      runScript('build', {
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          // Only now is the apply genuinely done — the patch is on disk and the
          // site is rebuilt around it, so "open the site to try it out" is true
          // (#253). A failed build leaves stale assets and its own banner, so it
          // gets no success confirmation.
          if (code === 0) {
            confirm(applyDoneMessage(verb, noun));
            finishTryIt();
          } else {
            finishApply(`\n${lines.buildFailed}\n`);
          }
        }
      });
    };
    // The watch paused for this apply rebuilds build/ from scratch when it
    // resumes (Gutenberg, #506), so a build of our own would be thrown away the
    // moment finishApply resumes it. Skip it and let the resume be the one
    // build; the confirmation waits for the watch's ready line, the same one the
    // dev-server start waits for (#488). Until then the terminal and the banner
    // say the watch is rebuilding (#492).
    const handOffToResumedWatch = () => {
      const handOff = resumedWatchHandOff(verb, noun, watchStateRef.current);
      if (!handOff.waits) {
        finishApply(handOff.stopped);
        return;
      }
      // Registered before the resume so a watch that dies at once still lands
      // in onFail. The waiters settle once per run: on the ready line or on exit.
      const token = applyHandOffRef.current.next();
      watchWaitersRef.current.add(
        () => {
          if (!applyHandOffRef.current.isCurrent(token)) return;
          confirm(applyDoneMessage(verb, noun));
          writeToTerminal(handOff.ready);
        },
        () => {
          if (!applyHandOffRef.current.isCurrent(token)) return;
          // Said in the terminal and nowhere else, after the page has said
          // the patch is applied: the terminal is brought up to be read.
          writeToTerminal(handOff.failed);
          revealTerminal();
        }
      );
      finishTryIt();
    };
    const afterInstall = buildBy === 'resumed-watch' ? handOffToResumedWatch : runBuildStep;
    if (buildBy === 'live-watch') {
      // A running build watch recompiles the src/ change on its own, so there is
      // no install and no build of our own to run — just hand off to it (#262).
      confirm(applyDoneMessage(verb, noun));
      handOffToWatch();
      finishApply(`\n${lines.compiling}\n`);
      return;
    }
    if (needsInstall) {
      setApplyState('installing');
      writeToTerminal(`\n${lines.installing}\n`);
      runInstall({
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          if (code !== 0) {
            finishApply(`\n${lines.installFailed}\n`);
            return;
          }
          afterInstall();
        }
      });
    } else {
      writeToTerminal(`\n${skipInstallMessage()}\n`);
      afterInstall();
    }
  };

  // Reads a patch file and works out what it would do, without touching the
  // checkout — the contributor decides after seeing the file list.
  const choosePatchFile = async () => {
    clearApplyError();
    setApplyNotice('');
    try {
      const chosen = await window.api.choosePatchFile();
      if (!chosen) return;
      if (chosen.error) {
        setApplyError(`Could not read that file: ${chosen.error}`);
        return;
      }
      const preview = await window.api.previewPatch(sitePath, chosen.text);
      if (!preview || !preview.ok) {
        setApplyError(preview?.error || 'Could not read that patch.');
        return;
      }
      setApplyPreview({ ...preview, label: chosen.name, text: chosen.text });
    } catch (e) {
      setApplyError(String(e));
    }
  };

  // Loads the PRs linked to the ticket. Manual, not on a timer: each call is a
  // request against a shared, unauthenticated GitHub limit, so it runs when the
  // contributor asks — on link, and on an explicit refresh.
  const loadTicketPatches = useCallback(async () => {
    setTicketPatchesLoading(true);
    try {
      const res = await window.api.listTicketPatches(sitePath);
      setTicketPatches(res && res.ok ? res.prs : { status: 'error', items: [] });
    } catch {
      setTicketPatches({ status: 'error', items: [] });
    } finally {
      setTicketPatchesLoading(false);
    }
  }, [sitePath]);

  // Load the ticket's PRs only for the active site. Every SiteRow stays mounted
  // (the parent hides inactive ones), so fetching on mount would spend the
  // shared, unauthenticated GitHub quota once per linked site on every launch.
  // The ref keeps re-activating a site from re-fetching the same ticket; a
  // relink (ticket change) and the Refresh button still fetch. Unlinking clears
  // the list. Placed after loadTicketPatches is defined: an effect that named it
  // earlier in the body would read the const before its declaration ran.
  const loadedTicketRef = useRef(null);
  const tracScrapeRef = useRef(null);
  // A Trac scrape can run up to 90s. Bump a generation on every ticket change so
  // a scrape that resolves after the ticket has moved on is dropped, rather than
  // shown under the wrong ticket or clearing a newer request's loading flag. Kept
  // on its own [tracTicket]-only effect, deliberately not folded into the one
  // below: that effect also re-runs on an `isActive` toggle (switching site tabs
  // and back), which must not bump the generation of an in-flight scrape that
  // has nothing to do with this ticket change (#299 follow-up). Declared first —
  // React runs same-component passive effects in declaration order — so the
  // bump always lands before the auto-triggered scrape a few lines down (#299).
  const scrapeGenRef = useRef(0);
  useEffect(() => { scrapeGenRef.current += 1; }, [tracTicket]);
  useEffect(() => {
    if (!tracTicket) {
      setTicketPatches(null);
      // Attachments are per-ticket and loaded on demand; a stale list from the
      // previous ticket must not linger, and a scrape dropped by the generation
      // bump above must not leave a stuck spinner.
      setTracAttachments(null);
      setTracAttachmentsLoading(false);
      loadedTicketRef.current = null;
      return;
    }
    if (!isActive || loadedTicketRef.current === tracTicket) return;
    // A new ticket on the active site: drop any attachments the previous one
    // loaded (and clear its loading flag, so a scrape dropped by the generation
    // bump above cannot leave a stuck spinner with no button to recover), then
    // fetch its PRs. Marked loaded before the fetch resolves, on purpose: a
    // failed initial fetch is not retried on every re-activation (which could
    // keep spending a rate-limited quota) — Refresh is the retry.
    setTracAttachments(null);
    setTracAttachmentsLoading(false);
    loadedTicketRef.current = tracTicket;
    loadTicketPatches();
    // Auto-read the ticket's own facts when this ticket was just linked by
    // hand (#292). Only then: the contributor just acted on this ticket, so a
    // human-check window appearing has context. On mount or re-activation the
    // ref is empty and nothing opens — details stay on demand, the #109 rule.
    // And only for a Trac ticket (#251): a GitHub issue has nothing on Trac,
    // and the Core ticket that shares its number is not it.
    if (showTracCards && autoReadTicketRef.current === tracTicket) {
      autoReadTicketRef.current = null;
      // Through the ref, not the function: loadTracAttachments is declared
      // below this effect and recreated per render — the same shape as
      // SiteRow's metaPatchRef.
      if (tracScrapeRef.current) tracScrapeRef.current();
    }
  }, [tracTicket, isActive, loadTicketPatches, showTracCards, autoReadTicketRef]);

  // Fetches the PR head through the site's origin and previews its own file
  // list. No diff text crosses the renderer boundary: checkout retains the
  // author's commits, while files and Trac attachments keep the patch path.
  const previewPr = async (pr) => {
    clearApplyError();
    setApplyNotice('');
    setFetchingPr(pr.number);
    try {
      const preview = await window.api.previewPullRequest(sitePath, pr.number);
      if (!preview || !preview.ok) {
        setApplyError(prCheckoutRefusal({ ...preview, number: pr.number }));
        return;
      }
      setApplyPreview({
        kind: 'pr', ...preview, label: `PR #${pr.number}`,
        paths: preview.files.map((file) => file.path),
        prUrl: pr.url, prState: pr.state || null
      });
    } catch (e) {
      setApplyError(String(e));
    } finally {
      setFetchingPr(null);
    }
  };

  // Opens the real Trac ticket (the user clears the challenge once if shown),
  // scrapes its attachment list, and shows it in-app. On demand, not on link.
  const loadTracAttachments = async () => {
    const gen = scrapeGenRef.current;
    clearApplyError();
    setTracAttachmentsLoading(true);
    try {
      const res = await window.api.listTracAttachments(sitePath);
      if (gen !== scrapeGenRef.current) return; // ticket changed mid-scrape; drop the stale result
      setTracAttachments(res && res.ok ? res : { status: 'error', items: [] });
    } catch {
      if (gen !== scrapeGenRef.current) return;
      setTracAttachments({ status: 'error', items: [] });
    } finally {
      if (gen === scrapeGenRef.current) setTracAttachmentsLoading(false);
    }
  };

  useEffect(() => { tracScrapeRef.current = loadTracAttachments; });

  // Downloads an attachment through the challenge-passing session and hands it
  // to the same preview the PR and file paths use.
  const previewAttachment = async (att) => {
    clearApplyError();
    setApplyNotice('');
    setFetchingAttachment(att.url);
    try {
      const res = await window.api.fetchTracAttachment(att.url);
      if (!res || !res.ok) {
        setApplyError(res?.error || `Could not download ${att.filename}.`);
        return;
      }
      const preview = await window.api.previewPatch(sitePath, res.text);
      if (!preview || !preview.ok) {
        setApplyError(preview?.error || 'Could not read that patch.');
        return;
      }
      setApplyPreview({ ...preview, label: att.filename, text: res.text });
    } catch (e) {
      setApplyError(String(e));
    } finally {
      setFetchingAttachment(null);
    }
  };

  // Apply a PR straight from a pasted URL or number, without needing it to be
  // linked to the ticket — same fetch → preview flow as the linked-PR list.
  const previewPrFromInput = () => {
    // Guarded against this site's own repository: a wordpress-develop pull
    // request pasted into a Gutenberg site is refused by name, not fetched
    // from a repository that has no such ref.
    const parsed = parsePrRef(prUrlInput, { repoPath: `${project.upstream.owner}/${project.upstream.repo}` });
    // clearApplyError first, not setApplyError alone: a parse error arriving on
    // top of a conflict breakdown would otherwise leave the stale regions on
    // screen hiding it, since the banner leads with the breakdown's headline.
    if (!parsed.ok) { clearApplyError(); setApplyError(parsed.error); setApplyNotice(''); return; }
    setPrUrlInput('');
    previewPr({ number: parsed.number, url: `https://github.com/${project.upstream.owner}/${project.upstream.repo}/pull/${parsed.number}` });
  };

  const runPrSwitch = async ({ leaving = false } = {}) => {
    const preview = applyPreview;
    const number = leaving ? pullRequest?.number : preview?.number;
    if (!number) return;
    const state = terminalStateRef.current;
    if (state.running) {
      refuseInTerminal();
      return;
    }
    // A checkout rewrites far more than a src/ patch, so a live watch is always
    // paused. Whether we build after depends on what the resumed watch does (#506).
    const watcherActive = watchOccupiesBuild(watchStateRef.current);
    const impact = planWatchImpact({ needsInstall: false, watcherActive, watchRebuildsOnStart, wholeTree: true });
    clearApplyError();
    setApplyNotice('');
    setApplyKind(leaving ? 'leave-pr' : 'pr');
    setApplyNeedsInstall(Boolean(preview?.needsInstall));
    setApplyBuildByWatcher(impact.buildBy);
    setApplyState('applying');
    applyHandOffRef.current.invalidate();
    markTerminalRunning(true);
    if (impact.pauseWatcher) await pauseWatcher();
    terminalKillRef.current = () => { killCurrent().catch(() => {}); };
    const run = leaving
      ? window.api.leavePullRequest(sitePath, ({ data }) => writeToTerminal(data), complete)
      : window.api.checkoutPullRequest(sitePath, number, ({ data }) => writeToTerminal(data), complete);

    function complete(res) {
      if (!res?.ok) {
        if (!leaving && res?.code === 'dirty-trunk') {
          setBlockedByTrunkWork({ kind: 'pr', number, ref: `pr/${number}`, canCarry: false, files: Number.isInteger(res.files) ? res.files : null, ticket: null });
        } else {
          // The preview is a dialog (#557), and a refusal is said on the
          // card behind it: the preview goes, so that the refusal can be
          // read. The question above keeps it, for the answer that goes on
          // with this same checkout.
          setApplyPreview(null);
          setApplyError(prCheckoutRefusal({ ...res, number }));
        }
        finishApply();
        return;
      }
      setApplyPreview(null);
      setApplyNeedsInstall(Boolean(res.needsInstall));
      runApplyInstallAndBuild(
        Boolean(res.needsInstall),
        leaving ? 'Restored' : 'Checked out',
        { buildBy: impact.buildBy, noun: leaving ? 'previous branch' : 'pull request' }
      );
    }

    run.catch((e) => {
      setApplyPreview(null);
      setApplyError(String(e));
      finishApply();
    });
  };
  // The pull request a switch to this ref would put back (#510), read from the
  // branch list the panel already reloads after every switch, so no round trip
  // is added in front of one. An unlink and a ref this site's provider does not
  // parse are not switches to a work item at all; the rest is the module's
  // decision.
  const savedPrForRef = (ref) => {
    const parsed = workItem.parseRef(typeof ref === 'string' ? ref.trim() : '');
    if (!parsed.ok) return null;
    return savedPrForSwitch({
      branches: ticketBranches.branches,
      ticketId: parsed.id,
      linkedTicket: tracTicket,
      currentPr: pullRequest?.number ?? null
    });
  };
  useLayoutEffect(() => {
    retryPrSwitchRef.current = runPrSwitch;
    ticketSwitchLifecycleRef.current = {
      begin: async (ref) => {
        if (terminalStateRef.current.running) {
          setTicketError('A command is already running. Stop it before switching tickets.');
          return false;
        }
        markTerminalRunning(true);
        terminalKillRef.current = () => { killCurrent().catch(() => {}); };
        applyHandOffRef.current.invalidate();
        // Only the switch that puts a parked pull request back is a whole-tree
        // change that pauses the watch (#506); a plain link, unlink or switch
        // moves the checkout and leaves the running watch to recompile what
        // changed (#510). Which one this is has to be known before the
        // checkout starts, and `sites:set-ticket` only says so afterwards — so
        // it is read from the same record main will consult: the PR checked
        // out now, and the one saved on the work item being switched to.
        //
        // The decision is made here, where the watch is paused, and read back
        // in complete. This effect has no dependency list, so it runs on every
        // render and a variable scoped to it would be reset between begin and
        // complete; a ref is what survives the IPC round trip.
        const impact = planTicketSwitchImpact({
          fromPr: pullRequest?.number ?? null,
          toPr: savedPrForRef(ref),
          watchState: watchStateRef.current,
          watchRebuildsOnStart
        });
        switchImpactRef.current = impact;
        if (impact.pauseWatcher) await pauseWatcher();
        return true;
      },
      complete: async (res) => {
        if (!res.prTransition) {
          // The watch was left running for this switch and the checkout has
          // landed: the files it wrote are what the watch now recompiles, so
          // the banner and the tab say so until it goes quiet (#492).
          if (switchImpactRef.current?.buildBy === 'live-watch') handOffToWatch();
          return false;
        }
        setApplyKind('pr');
        setApplyNeedsInstall(Boolean(res.needsInstall));
        // A restore begin did not see coming — a retry of a failed switch,
        // where main reads the ref the switch was leaving and the renderer
        // cannot. The install and the build that follow still need the build
        // directory and node_modules to themselves, so the pause happens late
        // rather than not at all. The plan's own answer wins whenever it
        // already paused, since a paused watch reads as inactive here.
        let impact = switchImpactRef.current;
        if (!impact?.pauseWatcher) {
          impact = planWatchImpact({ needsInstall: false, watcherActive: watchOccupiesBuild(watchStateRef.current), watchRebuildsOnStart, wholeTree: true });
          if (impact.pauseWatcher) await pauseWatcher();
        }
        setApplyBuildByWatcher(impact.buildBy);
        clearApplyError();
        runApplyInstallAndBuild(Boolean(res.needsInstall), 'Restored', { buildBy: impact.buildBy, noun: 'saved work' });
        return true;
      },
      finish: () => finishApply()
    };

  });

  const runApply = async ({ reverse = false } = {}) => {
    const state = terminalStateRef.current;
    if (state.running) {
      refuseInTerminal();
      return;
    }
    const preview = applyPreview;
    if (!reverse && preview?.kind === 'pr') {
      await runPrSwitch();
      return;
    }
    const needsInstall = reverse
      ? Boolean(appliedPatch?.files?.includes('package-lock.json'))
      : Boolean(preview.needsInstall);
    // A running build watch already recompiles src/, so a src-only patch skips
    // the build and is not interrupted; an install/full build pauses it (#262).
    const watcherActive = watchOccupiesBuild(watchStateRef.current);
    const impact = planWatchImpact({ needsInstall, watcherActive, watchRebuildsOnStart });
    clearApplyError();
    setApplyNotice('');
    setApplyNeedsInstall(needsInstall);
    setApplyKind('patch');
    setApplyBuildByWatcher(impact.buildBy);
    setApplyState('applying');
    applyHandOffRef.current.invalidate();
    markTerminalRunning(true);
    if (impact.pauseWatcher) await pauseWatcher();
    // Same contract as the other chains: while `running` is set, Ctrl+C in the
    // terminal has to reach the child process the chain is about to spawn.
    terminalKillRef.current = () => { killCurrent().catch(() => {}); };
    window.api.applyPatch(
      sitePath,
      reverse ? { reverse: true } : { patchText: preview.text, label: preview.label },
      ({ data }) => writeToTerminal(data),
      (res) => {
        if (!res || !res.ok) {
          // The main process has already dropped the stale record, so reloading
          // the status is what takes the "is applied" banner down and frees the
          // panel to accept another patch. Nothing was written, so there is
          // nothing to install or build.
          if (res?.notApplied) {
            if (res.recordCleared) {
              setApplyNotice(`${res.error} The applied-patch record has been cleared.`);
            } else {
              setApplyError(`${res.error} The record of it could not be cleared, so this site still thinks it is applied.`);
            }
            // finishApply reloads the status, which is what takes the banner
            // down now that the main process has dropped the record.
            finishApply();
            return;
          }
          // The preview goes with its failure, as a pull request's does:
          // it is a dialog, and what went wrong is on the card behind it.
          // What the breakdown needs of it was read before the apply began.
          setApplyPreview(null);
          setApplyError(res?.error || 'The patch could not be applied.');
          // A conflict is where the panel used to stop: one file named, the
          // rest of the failures left in the terminal, and no sense of whether
          // one region of twenty missed or all of them. The breakdown is what
          // turns that into a decision (#282). A reverse gets its own framing
          // (#306): it fails only because the contributor's own edits are on the
          // patch's lines, so the ticket's other patches and the pull request's
          // author are both the wrong place to send them.
          setApplyConflict(describeApplyFailure(res, reverse
            ? { reverting: appliedPatch?.label || 'That patch' }
            : {
              otherPatchCount: otherPatchCount({
                label: preview?.label,
                prs: ticketPatches?.items,
                attachments: patchAttachments
              }),
              prUrl: preview?.prUrl || null,
              prState: preview?.prState || null,
              appliedPatch,
              // The preview's own collision list: the files this ticket has work
              // in, measured from its base (#301). Without it an open pull
              // request is always narrated as stale, so a failure caused by the
              // contributor's own edits sends them to ask a stranger for a
              // rebase that would not help (#303).
              ownWorkPaths: preview?.conflicts || []
            }));
          finishApply();
          return;
        }
        setApplyPreview(null);
        // The confirmation waits until the rebuild finishes (see runBuildStep) —
        // the patch is on disk now, but the site is not usable until it is built
        // around it, so announcing "applied" here would be premature. When a
        // watch will rebuild it, runApplyInstallAndBuild confirms right away.
        runApplyInstallAndBuild(needsInstall, reverse ? 'Reverted' : 'Applied', { buildBy: impact.buildBy });
      }
    ).catch((e) => {
      // A rejected invoke never reaches onDone, so without this the terminal
      // stays wedged with `running` set and no way back short of a reload.
      setApplyPreview(null);
      setApplyError(String(e));
      finishApply();
    });
  };

  return {
    applyState,
    isApplying,
    applyKind,
    applySteps,
    applyStepStates,
    applyPreview,
    setApplyPreview,
    applyError,
    setApplyError,
    applyConflict,
    setApplyConflict,
    applyNotice,
    setApplyNotice,
    clearApplyError,
    prUrlInput,
    setPrUrlInput,
    fetchingPr,
    fetchingAttachment,
    ticketPatches,
    ticketPatchesLoading,
    tracAttachments,
    tracAttachmentsLoading,
    patchAttachments,
    loadTicketPatches,
    loadTracAttachments,
    choosePatchFile,
    previewPr,
    previewAttachment,
    previewPrFromInput,
    runPrSwitch,
    runApply
  };
}
