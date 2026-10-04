import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  Button,
  SlotFillProvider
} from '@wordpress/components';
import { Page } from '@wordpress/admin-ui';
import { __, _x, setLocaleData } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { drawerLeft, globe } from '@wordpress/icons';
import { ThemeProvider } from '@wordpress/theme';
import { Badge, Button as UiButton, Card as UiCard, EmptyState, IconButton, Notice, Spinner as UiSpinner, Stack, Text, VisuallyHidden } from '@wordpress/ui';
// The design system's tokens: every `--wpds-*` custom property, at its default,
// on `:root`.
import '@wordpress/theme/design-tokens.css';
import '@wordpress/components/build-style/style.css';
import '@wordpress/dataviews/build-style/style.css';
import '@xterm/xterm/css/xterm.css';
// After the libraries' own, so the shell's rules are the later ones.
import './shell.css';
import { computeSetupStepState, setupStepStatuses, setupStepCopy, setupAutoStartDecision } from './setup-steps.cjs';
import { deriveNextAction } from './next-action.cjs';
import { computeTerminalBusy } from './terminal-hints.cjs';
import { toggleTray, trayAfterReveal, trayList } from './tray.cjs';
import { formatElapsed, watchTabLabel } from './dev-server-command.cjs';
import { watchBusyMessage, appliedBannerState } from './watch-activity.cjs';
import { pathBasename } from './path-basename.cjs';
import { sitesListRows, siteToOpen } from './sites-list.cjs';
import { deleteSiteQuestion } from './site-dialogs.cjs';
import { serverProcess, watchProcess, serverSection } from './site-processes.cjs';
import { applyLocale, textDirection } from './locale-setup.cjs';
import { getProjectType } from '../project-type.cjs';
import { sanitizeSiteFolder, resolveTargetDir } from './site-folder.cjs';
import { noticeForOpenResult } from './open-failure.cjs';
import { describeAppliedLayer, attributeConflicts, layerExitFailure } from './applied-layer.cjs';
import { trunkAgeInfo, updateStepStatuses, planSetupSteps, SETUP_STATE_TO_STEP, setupOutcome, updateStepText } from './update-plan.cjs';
import { pickLatest } from '../latest-patch.cjs';
import { beginSetup, adoptSetupPath, discardSetup, rowPathAfterStatus } from './pending-setup.cjs';
import { workItemProvider } from '../work-item.cjs';
import { adminUrl } from './site-urls.cjs';
import { ticketBranchRows, ticketListCard, deleteWorkQuestion } from './ticket-branch-list.cjs';
import { ticketTrunkNotice } from './ticket-trunk-notice.cjs';
import { legacySiteNotice } from './legacy-site.cjs';
import { deepLinkNotice } from './deep-link-notice.cjs';
import { mergeInProgressNotice } from './merge-in-progress.cjs';
import { describePrCheckout, describePrPreview, prSubmissionBlocked } from './pr-checkout.cjs';
import { describeSwitchProgress } from '../switch-progress.cjs';
import { hasDiffLines } from './diff-highlight.cjs';
import { patchReviewContext, changesNoteParts, discardOutcome, applyFeedbackAfterDiscard, noteAfterDiscard, noteAfterProbe, discardBlocked, discardDisabledReason, DISCARD_CONFIRM_MESSAGE } from './changes-note.cjs';
import { ticketActionDisabledReason, rebaseDisabledReason, dirtyTrunkQuestion } from './ticket-actions.cjs';
import { initialConfirmations, confirmationReducer, deleteFailureMessage, setupFailureMessage, patchSavedMessage } from './confirmations.cjs';
import { ReasonedUiButton } from './components/reasoned-button.jsx';
import { DiscardChangesLink } from './components/discard-changes-link.jsx';
import { LogText } from './components/log-text.jsx';
import { DestinationGroup } from './components/destination.jsx';
import { TerminalCommandLink } from './components/terminal-command-link.jsx';
import { RenameSiteDialog } from './components/rename-site-dialog.jsx';
import { ConfirmDialog } from './components/confirm-dialog.jsx';
import { ToastStack } from './components/toast-stack.jsx';
import { TrunkUpdateCard } from './components/trunk-update-card.jsx';
import { SetupChecklist } from './components/setup-checklist.jsx';
import { EmailModal } from './components/email-modal.jsx';
import { DirtyTreeModal } from './components/dirty-tree-modal.jsx';
import { CreateSiteDialog } from './components/create-site-dialog.jsx';
import { PatchDiffPane } from './components/patch-diff-pane.jsx';
import { MentorHandoff } from './components/mentor-handoff.jsx';
import { TracDestination } from './components/trac-destination.jsx';
import { PullRequestDestination } from './components/pull-request-destination.jsx';
import { ReviewDialog } from './components/review-dialog.jsx';
import { SitesSidebar } from './components/sites-sidebar.jsx';
import { AppFooter, trayToggleId } from './components/app-footer.jsx';
import { BottomTray, SiteTrayFill } from './components/bottom-tray.jsx';
import { LogsPanel } from './components/logs-panel.jsx';
import { SiteHeaderActions, SiteHeaderActionsSlot } from './components/site-header-actions.jsx';
import { SiteDetails } from './components/site-details.jsx';
import { ApplyCard, ApplyPreviewDialog, PrCheckoutNotice } from './components/apply-card.jsx';
import { applyHeldReason, previewShown } from './apply-card.cjs';
import { TicketCard } from './components/ticket-card.jsx';
import { TicketListCard } from './components/ticket-list.jsx';
import { useDetectedEditors } from './hooks/use-detected-editors.jsx';
import { useContributorProvenance } from './hooks/use-contributor-provenance.jsx';
import { useNextActionCue } from './hooks/use-next-action-cue.jsx';
import { useSites } from './hooks/use-sites.jsx';
import { usePullRequest } from './hooks/use-pull-request.jsx';
import { useSiteMail } from './hooks/use-site-mail.jsx';
import { useSiteLogs } from './hooks/use-site-logs.jsx';
import { useSiteTerminal } from './hooks/use-site-terminal.jsx';
import { useSiteScripts } from './hooks/use-site-scripts.jsx';
import { useBuildWatch } from './hooks/use-build-watch.jsx';
import { useDevServer } from './hooks/use-dev-server.jsx';
import { useTrunkUpdate } from './hooks/use-trunk-update.jsx';
import { useSiteStatus } from './hooks/use-site-status.jsx';
import { useSiteTicket } from './hooks/use-site-ticket.jsx';
import { useApplyPatch } from './hooks/use-apply-patch.jsx';
import { ConfirmationContext, useConfirmation } from './hooks/use-confirmation.jsx';

// What the Copy button says about the press just made. Keyed rather than
// nested ternaries, so a fourth state is a line here instead of another branch
// in the middle of the JSX.
const COPY_BUTTON_LABELS = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Could not copy'
};

// A notice that is on the page as the page is drawn, or that already says
// itself through its role, is told to say nothing of its own: left to, it
// would be read out each time its site is opened, or said twice.
const SILENT = '';

const FEEDBACK_FORM_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScnMxicyDxZO2OoaS5ela8FArYWjCyLfC3hxRBBRSF7XLPzKg/viewform';

function App() {
  const { sites, siteMeta, refresh, setSiteMeta, applySetup } = useSites();
  // The confirmation queue for the whole window. It lives here, above every
  // SiteRow, because only one row is visible at a time and a per-row toast would
  // be hidden along with its inactive row. See ConfirmationContext in hooks/use-confirmation.jsx.
  const [confirmations, dispatchConfirmation] = useReducer(confirmationReducer, initialConfirmations);
  const confirm = useCallback((content, options = {}) => {
    dispatchConfirmation({ type: 'add', content, tone: options.tone });
  }, []);
  const removeConfirmation = useCallback((id) => {
    dispatchConfirmation({ type: 'remove', id });
  }, []);
  // One answer for the window, shared by every site row: which applications this
  // machine has is a fact about the machine, not about a site.
  const detectedApplications = useDetectedEditors();
  const wporg = useContributorProvenance();
  const [downloadPhase, setDownloadPhase] = useState('');
  // Where the row for the setup in flight currently lives. It starts as the
  // window's guess and becomes the directory the main process reports, and it
  // is a ref because the status subscription below has to read it without being
  // torn down and rebuilt every time it changes. Null when nothing is being
  // created.
  const setupRowPathRef = useRef(null);
  // Directories whose clone is still running. An array rather than a single
  // path because the main process may settle on a different (deduplicated)
  // directory than the one the renderer optimistically created a row for.
  const [pendingSites, setPendingSites] = useState([]);
  const addPendingSite = useCallback((dir) => {
    if (!dir) return;
    setPendingSites((prev) => (prev.includes(dir) ? prev : [...prev, dir]));
  }, []);
  const clearPendingSites = useCallback(() => setPendingSites([]), []);
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
  // Whether the sites list is showing. Closed, it gives its width to the page.
  const [sitesListOpen, setSitesListOpen] = useState(true);
  // Whether the open site's details are showing. One answer for the window,
  // not one per site: it is how the contributor likes the page, and it should
  // not change as they move between sites.
  const [detailsOpen, setDetailsOpen] = useState(true);
  const toggleDetails = useCallback(() => setDetailsOpen((open) => !open), []);
  // Which tray is open along the bottom of the window, if any (#558). One
  // answer for the window, like the details: it is how the contributor has the
  // window arranged, and the tray shows the open site's whichever site that is.
  const [tray, setTray] = useState(null);
  const trays = trayList();
  const pressTrayToggle = useCallback((id) => setTray((current) => toggleTray(current, id)), []);
  // The one time the tray opens without being asked: a site's view says so
  // when something failed or was refused and the only word of it is in the
  // terminal or in the logs. The page points there, and there has to be on
  // screen.
  const showTray = useCallback((id) => setTray((current) => trayAfterReveal(current, id)), []);
  // Closed from inside itself, the tray takes the focused button with it. The
  // focus goes back to the button that opened it, and not to the top of the
  // document.
  const closeTray = () => {
    if (tray) document.getElementById(trayToggleId(tray))?.focus();
    setTray(null);
  };
  const [activeSite, setActiveSite] = useState(null);
  const [deletingSites, setDeletingSites] = useState([]);
  // State paints the progress, while the ref closes the same-tick gap before
  // React renders it and prevents two delete requests for one site.
  const deletingSitesRef = useRef(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [setupLogsBySite, setSetupLogsBySite] = useState({});
  const setupLogAliasRef = useRef({});
  // Where a ticket switch has got to, per site (#173). Held here rather than in
  // SiteRow because every row stays mounted — subscribing per row would open one
  // listener per registered site and wake all of them for each other's events.
  const [switchProgressBySite, setSwitchProgressBySite] = useState({});
  const [carriedWorkBySite, setCarriedWorkBySite] = useState({});

  const appendSetupLog = useCallback((siteTarget, message) => {
    const key = siteTarget ? String(siteTarget) : '';
    if (!key) return;
    const chunk = message !== null && message !== undefined ? String(message) : '';
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
    const unsubProg = window.api.subscribeSetupProgress((p) => {
      if (p && p.message) {
        setTerminalMsgs((v) => v + p.message + '\n');
        appendSetupLog(p.target, `${p.message}\n`);
      }
      if (p && p.target) addPendingSite(p.target);
    });
    const unsubStat = window.api.subscribeSetupStatus((s) => {
      if (!s) return;
      // The first moment the window learns where the site is actually being
      // made. Until now the row kept the guess it was drawn with, which differs
      // whenever the folder name was taken — so it showed the wrong path and,
      // once the guards started keying on the real directory, asked about a
      // folder the app had never created (#180).
      const guess = setupRowPathRef.current;
      const adopted = rowPathAfterStatus(guess, s);
      if (adopted) {
        setupRowPathRef.current = adopted;
        moveSetupLog(guess, adopted);
        applySetup((state) => adoptSetupPath(state, { from: guess, to: adopted }));
        // The selection follows the row. Without this the panel is pointed at a
        // path that no longer exists in the list, and the contributor watches
        // their new site's checklist disappear mid-clone.
        setActiveSite((current) => (current === guess ? adopted : current));
      }
      if (s.target && s.phase !== 'done') addPendingSite(s.target);
      const key = s.sitePath || s.target;
      if (key) {
        const phaseLabel = s.phase ? `Status: ${s.phase}` : 'Status update';
        appendSetupLog(key, `${phaseLabel}\n`);
        if (s.phase === 'done') appendSetupLog(key, 'Setup finished.\n');
      }
      if (s.phase === 'cloning') setDownloadPhase('Cloning repository…');
      else if (s.phase === 'done') { setDownloadPhase(''); clearPendingSites(); setTerminalMsgs(''); }
    });
    return () => { if (unsubProg) unsubProg(); if (unsubStat) unsubStat(); };
  }, [addPendingSite, appendSetupLog, applySetup, clearPendingSites, moveSetupLog]);

  // Dropped when a switch begins, so a failed switch's last sentence is not the
  // next one's first frame.
  const clearSwitchNotices = useCallback((sitePath) => {
    setSwitchProgressBySite((prev) => (prev[sitePath] ? { ...prev, [sitePath]: null } : prev));
    setCarriedWorkBySite((prev) => (prev[sitePath] ? { ...prev, [sitePath]: null } : prev));
  }, []);

  // One subscription for every site; the payload says which one (#173).
  useEffect(() => {
    const unsub = window.api.subscribeSwitchProgress((p) => {
      if (!p || !p.sitePath) return;
      setSwitchProgressBySite((prev) => ({ ...prev, [p.sitePath]: p.stage === 'done' ? null : p }));
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // Arrives after the link has already answered (#108), so it is its own
  // subscription rather than a stage of the switch.
  useEffect(() => {
    const unsub = window.api.subscribeCarriedWork((p) => {
      if (!p || !p.sitePath) return;
      setCarriedWorkBySite((prev) => ({ ...prev, [p.sitePath]: p }));
    });
    return () => { if (unsub) unsub(); };
  }, []);

  // A ticket handed to the app by a `wpct://` link (#464). Held here rather
  // than in SiteRow for the reason the switch progress gives: every row stays
  // mounted, so subscribing per row would open one listener per site for an
  // event that concerns exactly one of them.
  //
  // `at` is what makes the same ticket arriving twice two events. Without it
  // the second link is the same state value, the effect below never re-runs,
  // and a banner the contributor dismissed never comes back.
  const [deepLink, setDeepLink] = useState(null);
  useEffect(() => {
    const unsub = window.api.subscribeDeepLinkTicket((p) => {
      if (!p || !p.ticket) return;
      setDeepLink({ ticket: p.ticket, at: Date.now() });
    });
    // Only after the subscription above exists: main holds a ticket that
    // arrived while this page was still loading until it hears this.
    Promise.resolve(window.api.deepLinkReady()).catch(() => {});
    return () => { if (unsub) unsub(); };
  }, []);
  const clearDeepLink = useCallback(() => setDeepLink(null), []);

  // Refused while one is already running. Everything about this flow is
  // single-file and always has been — one pending card, one terminal, one
  // `clearPendingSites()` that clears them all — and `setupRowPathRef` is one
  // slot for the row being created. The button was the only door left open on a
  // second setup, and a second setup does not half-work: it adopts the other
  // one's row. Until the flow is genuinely per-site, saying no is the honest
  // shape.
  const chooseAndSetup = useCallback(() => {
    if (createSubmitting) return;
    setCreateModalOpen(true);
  }, [createSubmitting]);

  // What the create-site dialog hands over once it has every answer: the name,
  // trimmed, the parent folder and the project. The dialog closes here, and the
  // setup it started goes on without it.
  const startSiteSetup = useCallback(async ({ name: nameTrimmed, dir: createSiteDir, projectType: createSiteType }) => {
    const cleanFolder = sanitizeSiteFolder(nameTrimmed);
    const targetDir = resolveTargetDir(createSiteDir, cleanFolder);
    let finalSitePath = targetDir;
    const placeholderCreatedAt = new Date().toISOString();

    setupRowPathRef.current = targetDir;
    applySetup((state) => beginSetup(state, {
      path: targetDir,
      label: nameTrimmed,
      createdAt: placeholderCreatedAt,
      projectType: createSiteType
    }));
    setActiveSite(targetDir);
    setCreateModalOpen(false);
    const chosenType = createSiteType;

    try {
      setCreateSubmitting(true);
      setTerminalMsgs('');
      addPendingSite(targetDir);
      appendSetupLog(targetDir, 'Starting site setup…\n');
      const createdPath = await window.api.setupWordPress(createSiteDir, { siteName: cleanFolder, siteLabel: nameTrimmed, projectType: chosenType });
      if (createdPath) {
        finalSitePath = createdPath;
        // Ordinarily already done, by the `cloning` status this handler's own
        // clone sent minutes ago. Kept because the status event is not a
        // guarantee — a missed one would otherwise leave the row on the guess
        // for good — and adopting a path the row already has is a no-op.
        const current = setupRowPathRef.current;
        if (current && current !== createdPath) {
          addPendingSite(createdPath);
          moveSetupLog(current, createdPath);
          applySetup((state) => adoptSetupPath(state, { from: current, to: createdPath }));
        }
        setupRowPathRef.current = createdPath;
      }
      await refresh();
      setActiveSite(finalSitePath);
      appendSetupLog(finalSitePath, 'Site setup request completed.\n');
    } catch (e) {
      // Whatever the row is *now*, which is not necessarily what it started as:
      // once the clone reports its directory the guess no longer exists, and
      // discarding the guess here would strand a row for a setup that failed.
      const rowPath = setupRowPathRef.current || targetDir;
      // Said in the window's corner, and until it is dismissed: the dialog
      // that asked for the site closed minutes ago, and the row that showed
      // the setup is about to go.
      confirm(setupFailureMessage(e), { tone: 'error' });
      appendSetupLog(rowPath, `Setup failed: ${String(e)}\n`);
      applySetup((state) => discardSetup(state, rowPath));
    } finally {
      setupRowPathRef.current = null;
      // `setupWordPress` resolving (or throwing) *is* the clone finishing, so
      // clearing here guarantees the checklist can never stay locked even if
      // the `done` status event is missed.
      clearPendingSites();
      setCreateSubmitting(false);
    }
  }, [addPendingSite, appendSetupLog, applySetup, clearPendingSites, confirm, moveSetupLog, refresh]);

  const closeCreateModal = useCallback(() => setCreateModalOpen(false), []);

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

  // Lets a SiteRow push meta changes (trunk date, update-incomplete flag)
  // into App's copy so the sidebar staleness dots update without a restart.
  const onSiteMetaPatch = useCallback((sitePath, patch) => {
    setSiteMeta((m) => ({ ...(m || {}), [sitePath]: { ...(m?.[sitePath] || {}), ...patch } }));
  }, [setSiteMeta]);

  const onDelete = useCallback(async (sitePath) => {
    if (deletingSitesRef.current.has(sitePath)) return;
    deletingSitesRef.current.add(sitePath);
    setDeletingSites((current) => (current.includes(sitePath) ? current : [...current, sitePath]));
    let result;
    try {
      try {
        result = await window.api.deleteSite(sitePath);
      } catch {
        result = { ok: false, reason: 'remove-failed', path: sitePath };
      }
      try { await refresh(); } catch {}
      if (result?.ok) removeSetupLog(sitePath);
      // A failed deletion stays visible and retryable. The error tone keeps its
      // notice on screen until dismissed rather than expiring on a timer.
      const failure = deleteFailureMessage(result);
      if (failure) confirm(failure, { tone: 'error' });
    } finally {
      deletingSitesRef.current.delete(sitePath);
      setDeletingSites((current) => current.filter((path) => path !== sitePath));
    }
  }, [refresh, removeSetupLog, confirm]);

  // Rejects when the name could not be written, and the dialog that asked
  // says why.
  const onRename = useCallback(async (sitePath, newLabel) => {
    await window.api.setSiteLabel(sitePath, newLabel);
    setSiteMeta((meta) => ({
      ...(meta || {}),
      [sitePath]: { ...(meta?.[sitePath] || {}), label: newLabel }
    }));
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

  // The list reports its selection; which site that opens is decided in
  // sites-list.cjs.
  const sitesRows = useMemo(
    () => sitesListRows({ sites: sortedSites, siteMeta, deleting: deletingSites }),
    [sortedSites, siteMeta, deletingSites]
  );
  const openRow = sitesRows.find((row) => row.path === activeSite) || null;
  const handleChangeSelection = useCallback((selection) => {
    setActiveSite((current) => siteToOpen({ selection, current, rows: sitesRows }));
  }, [sitesRows]);
  const openFeedbackForm = useCallback(() => { window.api.openExternal(FEEDBACK_FORM_URL); }, []);

  // What the window has to say that is about no one site: the Playground web
  // server where a build ships one, a setup in flight, and a ticket that
  // arrived from a link with no site to put it in. The prototype (#542) has no
  // place for these yet, so they stay above whatever the page area shows.
  const windowNotices = (
    <>
      {webAvailable ? (
        <Stack direction="row" align="center" justify="flex-end" gap="sm" className="window-notice">
          <UiButton
            loading={webStarting}
            loadingAnnouncement="Starting the Playground web server"
            variant={webUrl ? 'outline' : 'solid'}
            tone={webUrl ? 'neutral' : 'brand'}
            onClick={togglePlaygroundWeb}
          >{webUrl ? 'Stop Playground web server' : 'Start Playground web server'}</UiButton>
          {webStarting || webUrl ? (
            <Text variant="body-sm">
              {webStarting ? 'Starting…' : (
                <a href={webUrl || 'http://127.0.0.1:39372/'} onClick={(e) => { e.preventDefault(); window.api.openExternal(webUrl || 'http://127.0.0.1:39372/'); }}>{webUrl || 'http://127.0.0.1:39372/'}</a>
              )}
            </Text>
          ) : null}
        </Stack>
      ) : null}

      {/* Playground web server status + logs */}
      {(webStarting || webUrl || webError || webLogs) ? (
        <UiCard.Root className="window-notice">
          <UiCard.Content render={<Stack direction="column" gap="sm" />}>
            <Stack direction="row" align="center" justify="space-between" gap="sm">
              <Text variant="heading-md">Playground web server</Text>
              <Text variant="body-sm" className="muted-label">
                {webStarting ? 'Starting…' : null}
                {!webStarting && webUrl ? (
                  <a href={webUrl} onClick={(e)=>{ e.preventDefault(); window.api.openExternal(webUrl); }}>{webUrl}</a>
                ) : null}
                {!webStarting && !webUrl ? 'Stopped' : null}
              </Text>
            </Stack>
            {webError ? <Text variant="body-sm" className="error-text">{webError}</Text> : null}
            <div ref={webLogRef} className="log-pane is-short"><LogText text={webLogs} /></div>
          </UiCard.Content>
        </UiCard.Root>
      ) : null}

      {pendingSites.length > 0 && (
        <UiCard.Root className="window-notice">
          <UiCard.Content render={<Stack direction="column" gap="sm" />}>
            <Text variant="heading-md">Setting up new site…</Text>
            {downloadPhase && <Text variant="body-sm" className="muted-label">{downloadPhase}</Text>}
            <div ref={termRef} className="log-pane is-short">{terminalMsgs}</div>
          </UiCard.Content>
        </UiCard.Root>
      )}

      {/* A ticket arrived from a link and there is no site to put it
          in. The site in front of the contributor gets its own
          confirmation inside the ticket panel, where the ticket would
          go; `activeSite` is null only when there are no sites at all,
          so this is the one other case. */}
      {(() => {
        if (!deepLink || activeSite) return null;
        const notice = deepLinkNotice({ ticket: deepLink.ticket });
        if (!notice) return null;
        return (
          <Notice.Root className="window-notice" intent="info" role="status" spokenMessage={SILENT}>
            <Notice.Title>{notice.title}</Notice.Title>
            <Notice.Description>{notice.body}</Notice.Description>
            <Notice.Actions>
              <UiButton variant="outline" tone="neutral" size="compact" onClick={clearDeepLink}>Dismiss</UiButton>
            </Notice.Actions>
          </Notice.Root>
        );
      })()}
    </>
  );

  return (
    <ConfirmationContext.Provider value={confirm}>
    <SlotFillProvider>
    <div className="app-root">
      {sortedSites.length === 0 ? (
        // No site, so no list and no page: what there is to do is in the
        // middle of the window. The footer stays, since what it holds is
        // about the app and not about a site.
        <>
          <div className="page-body">
            <div className="page-body-notices">{windowNotices}</div>
            <div className="page-body-center">
              <EmptyState.Root>
                <EmptyState.Icon icon={globe} />
                <EmptyState.Title>{__('No sites')}</EmptyState.Title>
                <EmptyState.Description>{__('Create your first site to begin contributing')}</EmptyState.Description>
                <EmptyState.Actions>
                  <UiButton onClick={chooseAndSetup} disabled={createSubmitting}>{__('Create site')}</UiButton>
                </EmptyState.Actions>
              </EmptyState.Root>
            </div>
          </div>
          <AppFooter onOpenFeedbackForm={openFeedbackForm} />
        </>
      ) : (
        <div className={sitesListOpen ? 'site-shell' : 'site-shell is-sites-list-hidden'}>
          {/* Hidden, the list is out of the tab order and out of the
              accessibility tree as well as out of sight. `inert` is given as a
              string: React 18 drops the boolean. */}
          <div id="sites-list" className="sites-sidebar-slot" inert={sitesListOpen ? undefined : ''} aria-hidden={!sitesListOpen}>
            <SitesSidebar
              rows={sitesRows}
              selectedId={openRow ? openRow.id : null}
              onChangeSelection={handleChangeSelection}
              onCreateSite={chooseAndSetup}
              creating={createSubmitting}
            />
          </div>
          <div className="site-shell-main">
            <Page
              className="app-page"
              title={openRow ? openRow.name : ''}
              badges={openRow ? <Badge>{openRow.project}</Badge> : null}
              actions={<SiteHeaderActionsSlot />}
              showSidebarToggle
              hasPadding={false}
              ariaLabel={openRow ? openRow.name : __('Site')}
            >
              {/* The button says what pressing it does, and that is the one
                  place its state is said: a pressed state beside a name that
                  changes would say it twice, and the two would disagree. */}
              <Page.SidebarToggleFill>
                <IconButton
                  className="sites-list-toggle"
                  icon={drawerLeft}
                  label={sitesListOpen ? __('Hide sites list') : __('Show sites list')}
                  variant="minimal"
                  tone="neutral"
                  size="compact"
                  aria-expanded={sitesListOpen}
                  aria-controls="sites-list"
                  onClick={() => setSitesListOpen((open) => !open)}
                />
              </Page.SidebarToggleFill>
              <div className="site-workspace-main">
                <div className="site-workspace-content">
                  {windowNotices}
                  {/* Every site's view stays mounted, and only the open one is
                      shown: a site's terminal, its server and its watch live in
                      its view, and have to outlive the look at another site. */}
                  <div id="sites">
                    {sortedSites.map((s) => (
                    <div
                      key={s}
                      hidden={activeSite !== s}
                      aria-hidden={activeSite === s ? false : true}
                    >
                      <SiteRow
                        sitePath={s}
                        initialized={Boolean(siteMeta?.[s]?.initialized)}
                        createdAt={siteMeta?.[s]?.createdAt}
                        label={siteMeta?.[s]?.label}
                        projectType={siteMeta?.[s]?.projectType}
                        onInitialized={onInitialized}
                        onSiteMetaPatch={onSiteMetaPatch}
                        onDelete={onDelete}
                        onRename={onRename}
                        onCreateSite={() => setCreateModalOpen(true)}
                        editor={detectedApplications}
                        wporg={wporg}
                        isPending={pendingSites.includes(s)}
                        isDeleting={deletingSites.includes(s)}
                        setupLogs={setupLogsBySite[s] || ''}
                        switchProgress={switchProgressBySite[s] || null}
                        onClearSwitchNotices={clearSwitchNotices}
                        carriedWork={carriedWorkBySite[s] || null}
                        deepLink={activeSite === s ? deepLink : null}
                        onDeepLinkDone={clearDeepLink}
                        isActive={activeSite === s}
                        detailsOpen={detailsOpen}
                        onToggleDetails={toggleDetails}
                        tray={tray}
                        onShowTray={showTray}
                      />
                    </div>
                  ))}
                  </div>
                </div>
              </div>
            </Page>
            {/* Between the page and the footer, and taking its height from
                the page: the page is the part that scrolls, so nothing on it
                is ever under the tray. */}
            <BottomTray title={trays.find((entry) => entry.id === tray)?.title || null} onClose={closeTray} />
            <AppFooter trays={trays} activeTray={tray} onToggleTray={pressTrayToggle} onOpenFeedbackForm={openFeedbackForm} />
          </div>
        </div>
      )}
      <CreateSiteDialog open={createModalOpen} submitting={createSubmitting} onCreate={startSiteSetup} onClose={closeCreateModal} />
    </div>
    </SlotFillProvider>
    {/* One toast region for the window (#253, #557). In the bottom corner,
        above the footer: the top one is where the open site's actions are
        (#555), and a toast that stays until dismissed would sit on them. Its
        z-index clears the older library's modal overlay
        (components-modal__screen-overlay is 100000, and a modal is a later
        body portal that would otherwise win the tie) so a confirmation for
        an action taken inside a modal — saving a patch, opening a PR — is
        still seen. It stays below popovers/dropdowns (1000000), which should
        sit over it. It is drawn on `body`, outside the app's own element,
        because that element is a stacking context of its own (see shell.css)
        and nothing inside it can rise over a dialog. */}
    {createPortal(<ToastStack notices={confirmations.notices} onRemove={removeConfirmation} />, document.body)}
    </ConfirmationContext.Provider>
  );
}

function SiteRow({ sitePath, initialized, createdAt, label, projectType = null, onInitialized, onSiteMetaPatch, onDelete, onRename, onCreateSite, editor, wporg, isPending = false, isDeleting = false, setupLogs = '', isActive = false, switchProgress = null, carriedWork = null, onClearSwitchNotices = null, deepLink = null, onDeepLinkDone = null, detailsOpen = true, onToggleDetails = null, tray = null, onShowTray = null }) {
  // The window's confirmation queue (#253): confirm(message) after an action
  // completes, so the outcome is announced rather than left silent or buried in
  // the terminal.
  const confirm = useConfirmation();
  // Kept in a ref so that `loadStatus`, in useSiteStatus, keeps its identity:
  // a recreated callback prop must not retrigger the status-loading effect.
  const metaPatchRef = useRef(onSiteMetaPatch);
  useEffect(() => { metaPatchRef.current = onSiteMetaPatch; }, [onSiteMetaPatch]);
  // What this site's processes have said (#554): the text of the Logs panel's
  // panes, which tab is open and the debug.log tail. Whoever runs a process
  // appends to its pane, so the functions those callbacks call are taken out
  // by name; each keeps its identity, which their dependency lists rely on.
  const logs = useSiteLogs({ sitePath, shown: isActive && tray === 'logs' });
  const { appendNpm, appendRuntime, appendWatch, ensureStick, selectTab: selectLogTab, startDebugTail, stopDebugTail } = logs;
  const [isPatchOpen, setIsPatchOpen] = useState(false);
  const [patchText, setPatchText] = useState('');
  const [patchLoading, setPatchLoading] = useState(false);
  const [patchLoadFailed, setPatchLoadFailed] = useState(false);
  // What the last save did, reported in the modal rather than in an alert:
  // the destination panel is where the contributor is looking, and the path
  // matters — it is the file they are about to upload or hand over (#166).
  const [patchSaved, setPatchSaved] = useState(null);
  // '' | 'copied' | 'failed', shown on the Copy button for two seconds.
  const [patchCopied, setPatchCopied] = useState('');
  // Held so a second press restarts the message rather than being cut short by
  // the first press's timer, and so an unmount does not leave one running.
  const copyFeedbackTimer = useRef(null);
  const [patchSaveError, setPatchSaveError] = useState('');
  // The unsubmitted-changes note. Null until the first probe answers, so a
  // card never opens on a note that a clean tree then takes away.
  const [worktreeDirty, setWorktreeDirty] = useState(null);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState(null);
  // Opening a pull request (#167): the account, the sign-in, the form and the
  // attempt. Held here because all of it outlives the card that shows it.
  const prSubmission = usePullRequest({ sitePath, confirm });
  // The mail this site's WordPress sent (#554): the list, the port and the one
  // open in the dialog. The dev server below says when the list is live, so
  // the three functions it calls are taken out by name; each keeps its
  // identity, which the callbacks that list them as dependencies rely on.
  const mail = useSiteMail({ sitePath });
  const { listen: listenForMail, stopListening: stopListeningForMail, load: loadMail } = mail;
  // What the main process says about this site (#554): installed, built, the
  // ticket, what is applied, the trunk's age, and the two states the app only
  // reads. `loadStatus` reads it all again, and is what every chain below
  // calls when it has changed what the answer would be.
  const { hasNodeModules, installFailed, hasBuilt, setHasBuilt, skipInit, setSkipInit, statusLoading, tracTicket, setTracTicket, ticketBehindTrunk, setTicketBehindTrunk, legacy, mergeInProgress, trunkDate, updateIncomplete, appliedPatch, setAppliedPatch, pullRequest, loadStatus } = useSiteStatus({ sitePath, metaPatchRef });
  // Which target this site is a checkout of (#251): the site record's field,
  // carried by the placeholder from the moment the dialog closes, and Core
  // for any site made before the field existed. `build` is what the watcher
  // and the terminal's script list read. The work-item card shows on every
  // site and takes its words from the provider; what is Trac's alone (the
  // attachments, "Attach to Trac", the patch-file picker, the pull-request
  // flow until PR 5) shows only where the work item is a Trac ticket.
  const project = getProjectType(projectType);
  const projectBuild = project.build;
  // A watch that rebuilds build/ from scratch when it starts (Gutenberg's npm
  // run dev, the registry's readyPattern) does the one build after an apply
  // that paused it; the apply skips its own (#506).
  const watchRebuildsOnStart = Boolean(projectBuild.watch.readyPattern);
  // Trac's alone: the attachments, "Attach to Trac", "Read details from Trac".
  // The pull-request destination is on every site since #251.
  const showTracCards = project.workItem.provider === 'trac';
  // Memoised on the registry entry, which is a stable object, so the
  // callbacks that parse a reference do not change identity every render.
  const workItem = useMemo(
    () => workItemProvider(project.workItem.provider, `${project.upstream.owner}/${project.upstream.repo}`),
    [project]
  );
  // Initial setup chain (#246): install then build, started by the clone
  // finishing rather than by a click. Same shape as the two chains below.
  const [setupChainState, setSetupChainState] = useState('idle'); // idle | installing | building
  // How the last chain ended, or null while one is running or none has run.
  const [setupChainEnd, setSetupChainEnd] = useState(null);
  // Where "try another patch" goes. The list is already on screen when a patch
  // fails — three rows above, in the case that prompted this — so the way out
  // is a scroll, not a fetch.
  const ticketPatchesRef = useRef(null);
  // The apply card, for focus to come to when its preview closes.
  const applyCardRef = useRef(null);
  const setupLogsRef = useRef('');

  const siteName = pathBasename(sitePath);
  const displayName = (label && label.trim()) || siteName;
  // Whether the rename dialog is up. Everything else about it, the value being
  // typed, the refusal, the busy flag, is the dialog's own (#553).
  const [renameModalOpen, setRenameModalOpen] = useState(false);
  const openRenameModal = useCallback(() => setRenameModalOpen(true), []);
  const closeRenameModal = useCallback(() => setRenameModalOpen(false), []);
  const createdLabel = createdAt ? new Date(createdAt).toLocaleString() : '';
  const [pathCopied, setPathCopied] = useState(false);
  const copyTimeoutRef = useRef(null);

  useEffect(() => () => {
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
  }, []);

  // Puts the path on the clipboard and resolves to whether it got there. Each
  // of the two things that copy says so in its own way, and only in that way:
  // said twice, a screen reader reads it twice.
  const writePathToClipboard = useCallback(async () => {
    try {
      if (!navigator?.clipboard?.writeText) {
        throw new Error('Clipboard access is not available in this environment');
      }
      await navigator.clipboard.writeText(sitePath);
      return true;
    } catch (err) {
      // eslint-disable-next-line no-alert -- see the note above confirmAnd.
      alert('Unable to copy path: ' + (err?.message ?? String(err)));
      return false;
    }
  }, [sitePath]);
  // The details' button, which says "Copied" on itself for a moment.
  const copyPath = useCallback(async () => {
    if (!(await writePathToClipboard())) return;
    setPathCopied(true);
    if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
    copyTimeoutRef.current = setTimeout(() => setPathCopied(false), 1500);
  }, [writePathToClipboard]);

  // --- opening the directory ------------------------------------------------
  //
  // One menu, one intention: open this folder, in that. The application is the
  // argument to the action rather than a setting configured first, so there is
  // nothing remembered, nothing to change later, and no first-run picker.
  //
  // What is offered is what detection found (see editor-launch.js — a
  // convenience, not a claim about what is installed) plus the file manager and
  // "Other application…", which is what covers everything the table misses. No
  // application is ever drawn disabled: one this app cannot find is not one it
  // refuses to use, and copying the path is the floor under all of it. Since
  // #556 these are items of the site's menu, in the page's header; which ones
  // and in what order is site-menu.cjs.
  const { detected: detectedEditors, loading: detectingEditors, loadDetected } = editor;
  // `{ message, offerPicker }` from open-failure.cjs, or null for nothing to
  // say. Both what it reads and whether "Choose application…" is a way out of
  // it are decided there, per reason — the two callers below deciding that
  // separately is what #180 was.
  const [editorNotice, setEditorNotice] = useState(null);
  // The notice is drawn at the top of the site's cards, and the menu that
  // caused it can be used from anywhere down the page: said out of sight, a
  // refusal looks like a button that did nothing. Each refusal is brought
  // into view once. A new notice object is a new refusal, so one that repeats
  // is brought back; one that is merely still there when the site is opened
  // again is not this effect's to move to. Where the page goes then is the
  // next-action cue's (useNextActionCue), which centres the next step each
  // time a site is opened, and two effects scrolling the same page in one
  // commit would only be the second one's.
  const editorNoticeRef = useRef(null);
  const shownEditorNoticeRef = useRef(null);
  useEffect(() => {
    if (!editorNotice || !isActive || !editorNoticeRef.current) return;
    if (shownEditorNoticeRef.current === editorNotice) return;
    shownEditorNoticeRef.current = editorNotice;
    editorNoticeRef.current.scrollIntoView({ block: 'nearest' });
  }, [editorNotice, isActive]);


  // `editorPath` is one of the detected applications; null asks the main process
  // for the file dialog instead.
  //
  // The invoke itself can reject — a handler that throws, a window being torn
  // down — and a rejection here would leave the notice unset: the menu item
  // would appear to do nothing, which is the one outcome this feature is not
  // allowed to produce.
  const openIn = useCallback(async (editorPath = null) => {
    let result;
    try {
      result = await window.api.openInEditor(sitePath, editorPath);
    } catch (err) {
      // eslint-disable-next-line no-console -- see the note on the console.error in hooks/use-detected-editors.jsx.
      console.error('Could not open the site directory:', err);
      result = { ok: false, reason: 'unavailable', error: String(err?.message ?? err) };
    }
    const notice = noticeForOpenResult(result, { picked: editorPath === null });
    setEditorNotice(notice);
    // An application that was detected and then failed is one detection should be
    // asked about again, so the next menu does not offer it as if nothing had
    // happened.
    if (notice && editorPath !== null) await loadDetected();
  }, [loadDetected, sitePath]);

  // Through the same function as `openIn` above, deliberately: this used to
  // build its own sentence out of `error` alone, so a refusal — which carries a
  // `reason` and no `error` — came out as the words "unknown error" (#180).
  const showInFileManager = useCallback(async () => {
    let result;
    try {
      result = await window.api.showSiteInFileManager(sitePath);
    } catch (err) {
      // eslint-disable-next-line no-console -- see the note on the console.error in hooks/use-detected-editors.jsx.
      console.error('Could not reveal the site folder:', err);
      result = { ok: false, reason: 'unavailable', error: String(err?.message ?? err) };
    }
    setEditorNotice(noticeForOpenResult(result));
  }, [sitePath]);

  // The note's probe. It asks the wide question — unsubmitted work measured
  // from the ticket's branch point, the same measurement the patch makes —
  // not whether the tree has uncommitted edits (#239): under the ticket-as-
  // branch model a ticket's work is parked in a WIP commit, so the narrow
  // reading is correctly "clean" for every change that has survived a ticket
  // switch, which is exactly the work this note exists to speak about. The
  // checkout guards (startTrunkUpdate) keep asking the narrow question:
  // parked work survives a force checkout, uncommitted edits do not.
  //
  // A failed probe clears the last answer. Once the app knows it could not
  // measure this ticket, keeping an earlier count would present stale data as
  // current (#308).
  //
  // The ref guards two races the probe's cost makes real — it walks the whole
  // checkout, so it can still be in flight when the next focus fires or when
  // a discard answers the question locally. `inFlight` keeps walks from
  // stacking; `generation` lets a local answer outrank a probe that started
  // before it, so a stale "dirty" cannot resurrect the note over a tree that
  // was just reset.
  const dirtyProbeRef = useRef({ inFlight: false, generation: 0, again: false });
  // The local answer a discard supplies (#239) — what survived the reset,
  // decided by the module so the card has one rule for it and a test to hold
  // it. The generation bump is what makes it outrank a probe that started
  // before the discard did.
  // Memoised with nothing to depend on: it touches a ref and a setter. The
  // ticket hook lists it among a callback's dependencies, and a new function
  // here on every render would give that callback a new identity each time.
  const applyDiscardToNote = useCallback((outcome) => {
    dirtyProbeRef.current.generation++;
    setWorktreeDirty(noteAfterDiscard(outcome));
  }, []);
  const refreshDirty = useCallback(async () => {
    const probe = dirtyProbeRef.current;
    // A walk already running answers for the tree as it was when it started.
    // Asking again mid-walk used to be dropped, which was safe while the
    // answer could only change behind the app's back — a branch switch
    // changes it in-app, without the window ever losing focus (#239), so the
    // request is remembered and re-run rather than lost.
    if (probe.inFlight) {
      probe.again = true;
      return;
    }
    probe.inFlight = true;
    try {
      do {
        probe.again = false;
        const generation = probe.generation;
        try {
          const res = await window.api.hasUnsubmittedWork(sitePath);
          if (probe.generation === generation) {
            setWorktreeDirty((current) => noteAfterProbe(current, res));
          }
        } catch {}
      } while (probe.again);
    } finally { probe.inFlight = false; }
  }, [sitePath]);

  // A branch change invalidates the note outright rather than staling it: the
  // count is measured from the ticket's branch point (#239), so the previous
  // ticket's answer is not an old version of this one's, it is about a
  // different body of work. Left alone it would put the outgoing ticket's
  // count and the incoming ticket's number in the same sentence, over a
  // discard link — so the note is cleared while the new walk runs, and the
  // generation bump keeps the outgoing branch's answer from landing on it.
  const reprobeAfterBranchChange = useCallback(() => {
    dirtyProbeRef.current.generation++;
    setWorktreeDirty(null);
    refreshDirty();
  }, [refreshDirty]);

  // Only the open card probes, and only while it is open: the probe walks the
  // whole checkout, which is too much to pay for every card on the shelf. The
  // edits themselves happen in an external editor, so returning focus to the
  // app is the moment the answer can have changed.
  useEffect(() => {
    if (!isActive) return undefined;
    refreshDirty();
    // The status too (#352): a merge started outside the app ends outside
    // it, and returning focus is when the banner can have become stale.
    const onFocus = () => { refreshDirty(); loadStatus().catch(() => {}); };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [isActive, refreshDirty, loadStatus]);

  // The ticket or issue this site is working on (#554): linking, leaving,
  // switching, moving onto trunk and deleting, with the question a switch
  // asks about trunk's loose edits. The three refs are how it and the apply
  // chain, called further down, reach each other.
  const { ticketInput, setTicketInput, ticketError, setTicketError, ticketSaving, ticketBranches, deletingBranch, blockedByTrunkWork, setBlockedByTrunkWork, patchSavedNotice, patchSavedTo, setPatchSavedTo, saveTicket, linkTicket, unlinkTicket, rebaseTicket, discardTrunkWorkAndSwitch, saveTrunkWorkThenStartClean, deleteTicketWork, retryPrSwitchRef, ticketSwitchLifecycleRef, autoReadTicketRef } = useSiteTicket({ sitePath, workItem, tracTicket, setTracTicket, setTicketBehindTrunk, metaPatchRef, loadStatus, onClearSwitchNotices, reprobeAfterBranchChange, applyDiscardToNote });

  // A ticket arrived from a link and this is the site in front of the
  // contributor (#464). The answer goes through `saveTicket` like any other
  // link, so every guard the panel already has — a running install, a
  // mid-switch site, a merge started in a terminal, the dirty-trunk question —
  // applies unchanged.
  //
  // Read straight off the prop, never copied into state here. Every row stays
  // mounted behind `display: none`, so a row that kept its own copy would go on
  // showing the question after another row answered it, and would raise it
  // again the moment the contributor came back. The App's one value is the one
  // truth, and answering clears it for everybody.
  //
  // The ticket field is deliberately left alone. It is free text the
  // contributor may be halfway through, the question already says which ticket
  // it means, and its button links that ticket directly — so writing over what
  // they typed would buy nothing.
  const deepLinkTicket = (deepLink && deepLink.ticket) ? deepLink.ticket : null;
  // Which of the states the link is in is the module's decision, not this
  // file's; here it is only rendered and dispatched.
  const deepLinkState = deepLinkNotice({
    ticket: deepLinkTicket,
    provider: project.workItem.provider,
    siteLabel: displayName,
    currentTicket: tracTicket
  });
  const deepLinkPrompt = deepLinkState && deepLinkState.state === 'confirm' ? deepLinkState : null;
  // A ticket that cannot land on this site (#251): said, dismissable, never
  // consumed, so a Core site opened next still gets the question.
  const deepLinkNoteState = deepLinkState && deepLinkState.state === 'unsupported' ? deepLinkState : null;
  // Hidden here, on this site only: the ticket stays with the app, so a Core
  // site opened next still gets the question. Reset when a link arrives, and
  // only then: the prop is the event (App stamps each arrival, so the same
  // ticket twice is two events), and it is null while another site is in
  // front, which must not un-hide what the contributor hid here.
  const [deepLinkNoteHidden, setDeepLinkNoteHidden] = useState(false);
  // The stamp, not the object: the prop goes object → null → the same object
  // when another site is looked at and this one comes back, and that is not
  // a new arrival.
  const deepLinkAt = deepLink ? deepLink.at : null;
  useEffect(() => { if (deepLinkAt) setDeepLinkNoteHidden(false); }, [deepLinkAt]);
  const deepLinkNote = deepLinkNoteHidden ? null : deepLinkNoteState;
  // `settled` is a link for the ticket this site is on already. Cleared rather
  // than merely hidden, so the question does not resurface on the next site the
  // contributor opens.
  const deepLinkSettled = Boolean(deepLinkState && deepLinkState.state === 'settled');
  useEffect(() => {
    if (deepLinkSettled && onDeepLinkDone) onDeepLinkDone();
  }, [deepLinkSettled, onDeepLinkDone]);

  const dismissDeepLink = useCallback(() => {
    if (onDeepLinkDone) onDeepLinkDone();
  }, [onDeepLinkDone]);

  const acceptDeepLink = useCallback(() => {
    if (deepLinkTicket !== null) saveTicket(String(deepLinkTicket));
    if (onDeepLinkDone) onDeepLinkDone();
  }, [deepLinkTicket, onDeepLinkDone, saveTicket]);

  // Brings one of this site's trays up (#558), for what is said nowhere else:
  // an install or a build that failed, whose output is in the terminal; an
  // action that was refused because a command is running, which is a line
  // printed there; and a build watch that ended by itself, whose last lines
  // are in the logs. The tray shows the open site's, so a site that is not
  // the open one waits until it is: its page will be saying where to look
  // when it is looked at.
  const siteRef = useRef({ active: isActive, deleting: isDeleting });
  const trayWantedRef = useRef(null);
  useLayoutEffect(() => {
    siteRef.current = { active: isActive, deleting: isDeleting };
    return () => {
      siteRef.current = { active: false, deleting: true };
    };
  }, [isActive, isDeleting]);
  const revealTray = useCallback((id) => {
    // Nothing is brought up, now or later, for a site on its way out: its
    // processes are ended as it goes, and if it stays after all, because its
    // folder could not be removed, their ending was the deletion's doing.
    if (siteRef.current.deleting) return;
    if (siteRef.current.active) onShowTray?.(id);
    else trayWantedRef.current = id;
  }, [onShowTray]);
  useEffect(() => {
    if (!isActive || !trayWantedRef.current) return;
    const wanted = trayWantedRef.current;
    trayWantedRef.current = null;
    onShowTray?.(wanted);
  }, [isActive, onShowTray]);
  const revealTerminal = useCallback(() => revealTray('terminal'), [revealTray]);
  // The logs, on the build watch's tab: where the page says a watch's last
  // lines are. And on the
  // server's tab, for a server that could not start or went by itself, which
  // is said there and nowhere on the page. The tab is selected whether or
  // not the logs come up: they do not take the terminal's place (tray.cjs),
  // and are then on the right tab when they are opened.
  const revealWatchLog = useCallback(() => {
    selectLogTab('watch');
    revealTray('logs');
  }, [revealTray, selectLogTab]);
  const revealServerLog = useCallback(() => {
    selectLogTab('runtime');
    revealTray('logs');
  }, [revealTray, selectLogTab]);

  // The npm runs this view starts (#554): the install and the scripts, and the
  // flags the rest of the view reads about them. Called here because it needs
  // `loadStatus` above; the terminal and the build watch below run through it.
  const { installing, building, buildFailed, buildInterrupted, buildInterruptedRef, markBuildInterrupted, currentRunIdRef, runInstall, runScript, killCurrent } = useSiteScripts({ sitePath, appendNpm, ensureStick, loadStatus, onInitialized, onRunFailed: revealTerminal });

  // The site's terminal (#554): the xterm instance, what is typed in it and
  // the commands it runs through the three runners above. The lock, the kill
  // handler and the writer are taken out by name because every chain below
  // holds the lock and writes its progress there, as it always has.
  const { terminalContainerRef, terminalStateRef, terminalKillRef, terminalRunning, markTerminalRunning, writeToTerminal, prefillTerminalCommand } = useSiteTerminal({ allowedScripts: projectBuild.allowedScripts, runInstall, runScript, killCurrent, shown: isActive && tray === 'terminal' });
  // What a chain says when it is asked to start while a command holds the
  // terminal. The line is printed there and nowhere else, so the terminal is
  // brought up with it: a refusal nobody sees is a button that did nothing.
  const refuseInTerminal = useCallback(() => {
    writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
    revealTerminal();
  }, [revealTerminal, writeToTerminal]);
  // The scroll root for the next-action cue (#252): the whole detail section, so
  // the cue can find whichever block is the next step wherever it sits.
  const nextActionSectionRef = useRef(null);

  // Taking a step back by hand is the answer to "Setup stopped." — so the
  // notice goes away here rather than lingering over work already resumed.
  const runInstallWithTerminal = useCallback(() => {
    setSetupChainEnd(null);
    writeToTerminal('Running npm install…\n');
    runInstall({
      onLog: (chunk) => writeToTerminal(chunk),
      onDone: ({ code }) => {
        writeToTerminal(`npm install exited with code ${code}\n`);
      }
    });
  }, [runInstall, writeToTerminal]);

  const runBuildWithTerminal = useCallback(() => {
    setSetupChainEnd(null);
    writeToTerminal('Running npm run build…\n');
    runScript('build', {
      onLog: (chunk) => writeToTerminal(chunk),
      onDone: ({ code }) => {
        writeToTerminal(`npm run build exited with code ${code}\n`);
      }
    });
  }, [runScript, writeToTerminal]);

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

  // The build watch (#554): its state, its run and what can be done to it. It
  // is called here because it needs the script runner and the terminal's lock
  // above. What the chains below use of it is taken out by name.
  const { watchState, watchExitCode, watchExitOf, watchCompiling, watchStateRef, watchWaitersRef, applyHandOffRef, handOffToWatch, startBuildWatch, pauseWatcher, resumeWatcher, toggleWatch } = useBuildWatch({ sitePath, projectBuild, hasBuilt, runScript, killCurrent, markBuildInterrupted, appendWatch, selectLogTab, refuseInTerminal, terminalStateRef, terminalKillRef, markTerminalRunning });
  // A watch that ended by itself, or was never started because the build
  // ahead of it failed, is said on the page with "Its last lines are in the
  // Logs." So the logs come up, on the watch's tab, when that happens. A
  // watch stopped by its button goes to idle and not to this, and brings
  // nothing up.
  useEffect(() => {
    if (watchState === 'exited') revealWatchLog();
  }, [watchState, revealWatchLog]);

  // The count is on the tab rather than beside it because the tab is what the
  // contributor is not looking at: a notice landing while they read the server
  // output is the case this panel exists for.
  const logTabs = useMemo(() => ([
    { name: 'runtime', title: 'Server' },
    { name: 'watch', title: watchTabLabel(watchState, watchExitCode, watchCompiling) },
    { name: 'debug', title: logs.debugUnread ? `Debug.log (${logs.debugUnread})` : 'Debug.log' }
  ]), [logs.debugUnread, watchState, watchExitCode, watchCompiling]);

  // The dev server (#554): its state, its guards and its one button. It is
  // called here because starting it needs everything above: the build watch,
  // the logs, the mail, the terminal's lock and the script runner.
  const { serverUrl, starting, running, isServerStarting, isDevProcessActive, startElapsed, toggleDevServer } = useDevServer({ sitePath, projectBuild, hasBuilt, setHasBuilt, skipInit, appendRuntime, revealServerLog, ensureStick, startDebugTail, stopDebugTail, listenForMail, stopListeningForMail, loadMail, startBuildWatch, watchStateRef, buildInterruptedRef, currentRunIdRef, terminalKillRef, markTerminalRunning });
  const markSkipWizard = useCallback(async () => {
    await window.api.setSkipInitWizard(sitePath, true);
    setSkipInit(true);
  }, [sitePath, setSkipInit]);
  // The system's own alert and confirm are an older convention of this
  // file. Each is replaced with the app's own as its part of the window is
  // redrawn (#557), which is a larger change than a lint cleanup should make.
  // eslint-disable-next-line no-alert
  const confirmAnd = async (m,a)=>{ if(window.confirm(m)) await a(); };
  // The question asked before a site or a ticket's work is deleted (#557),
  // in a dialog of the app's own: what is asked, and what a yes does. The
  // discards above still ask through the system's.
  const [asking, setAsking] = useState(null);
  const askFirst = (question, action) => setAsking({ question, action });

  // Updating to the latest trunk (#94, #554): the chain, the question it asks
  // about edits in the tree, and the retry. Called here because it runs
  // through everything above, and because what follows reads whether an
  // update is under way.
  const { updateState, isUpdating, updateHeld, updateWaitingOnWatch, updateSteps, updateStepStates, lastUpdateSummary, setLastUpdateSummary, dirtyModalOpen, setDirtyModalOpen, dirtySaving, dirtyFiles, dirtyError, startTrunkUpdate, dirtySaveAndUpdate, dirtyDiscardAndUpdate, retryInstallAndBuild } = useTrunkUpdate({ sitePath, confirm, confirmAnd, installing, building, runInstall, runScript, killCurrent, terminalStateRef, terminalKillRef, markTerminalRunning, writeToTerminal, refuseInTerminal, revealTerminal, watchStateRef, watchWaitersRef, pauseWatcher, resumeWatcher, watchRebuildsOnStart, loadStatus, refreshDirty, applyDiscardToNote });
  // What the page says about the site's two processes (#557), in the header
  // and in the details alike. Decided in site-processes.cjs, and worked out
  // here because an update of trunk holds both.
  const serverState = serverProcess({ active: isDevProcessActive, starting: isServerStarting, isUpdating });
  const watchProcessState = watchProcess({ state: watchState, compiling: watchCompiling, exitCode: watchExitCode, exitOf: watchExitOf, isUpdating, updateWaitingOnWatch, sourceDir: project.cards.sourceDir });
  const serverSectionState = serverSection({ url: serverUrl, running, starting: isServerStarting, elapsed: startElapsed });
  // A link to the running site is opened in the browser by the main process.
  const openSiteLink = (url) => window.api.openExternal(url);

  // What the site's menu does (#556). Which items it offers is decided in
  // site-menu.cjs; this is each one's function. Copying the path says so in a
  // toast, since the menu is gone by then and the details, whose own button
  // says it on itself, may be put away.
  const detailsId = useId();
  // The heading of the mail under the cards, which names it.
  const mailTitleId = useId();
  const runSiteMenuAction = async (item) => {
    if (item.id === 'rename') openRenameModal();
    else if (item.id === 'copy-path') { if (await writePathToClipboard()) confirm(__('Copied the path')); }
    else if (item.id === 'show-in-file-manager') await showInFileManager();
    else if (item.id === 'update-trunk') await startTrunkUpdate();
    else if (item.id === 'open-in') await openIn(item.path);
    else if (item.id === 'open-in-other') await openIn(null);
    else if (item.id === 'delete') askFirst(deleteSiteQuestion(displayName), () => onDelete(sitePath));
  };

  // Putting someone else's patch or pull request on this site (#554): what a
  // ticket offers, the preview, and the chain. Called here because it runs
  // through everything above, and because what follows reads whether an
  // apply is under way.
  const { applyState, isApplying, applyKind, applySteps, applyStepStates, applyPreview, setApplyPreview, applyError, setApplyError, applyConflict, setApplyConflict, applyNotice, setApplyNotice, clearApplyError, prUrlInput, setPrUrlInput, fetchingPr, fetchingAttachment, ticketPatches, ticketPatchesLoading, tracAttachments, tracAttachmentsLoading, patchAttachments, loadTicketPatches, loadTracAttachments, choosePatchFile, previewPr, previewAttachment, previewPrFromInput, runPrSwitch, runApply } = useApplyPatch({ sitePath, project, workItem, showTracCards, isActive, tracTicket, appliedPatch, pullRequest, ticketBranches, setTicketError, setBlockedByTrunkWork, retryPrSwitchRef, ticketSwitchLifecycleRef, autoReadTicketRef, confirm, loadStatus, refreshDirty, runInstall, runScript, killCurrent, terminalStateRef, terminalKillRef, markTerminalRunning, writeToTerminal, refuseInTerminal, revealTerminal, watchStateRef, watchWaitersRef, applyHandOffRef, handOffToWatch, pauseWatcher, resumeWatcher, watchRebuildsOnStart });

  // The tickets with work on this site (#108), in a card of their own (#240)
  // below the Trac ticket card and the patch one — which ticket am I on, what
  // work can I bring into it, which of my other tickets do I want. The sentence
  // differs with the state — with no ticket linked the rows offer to continue,
  // with one linked they point out the other open tickets — but the rows, the
  // ordering and the delete action are the same list, and it lives in the one
  // card in both states rather than jumping somewhere else on unlink.
  //
  // Switch and delete are checkouts of the same working directory that an
  // install, a build or a trunk update is using, so they block on the long
  // operations as well as on each other — the same trio every destructive
  // control in the ticket panel guards on.
  const branchRows = ticketBranchRows({ branches: ticketBranches.branches, current: ticketBranches.current, tracTicket, now: Date.now() });
  const ticketsCard = ticketListCard({ rowCount: branchRows.length, linked: Boolean(tracTicket), provider: project.workItem.provider });
  // What the switch is doing, while it does it (#173). Gated on the busy flag
  // rather than merely cleared by it: the last sends can land after the invoke
  // has already answered, which would flash a sentence under an idle panel.
  // Where loose work went, said once and plainly (#108). Carrying uncommitted
  // edits into a new ticket is now something the contributor chooses in the
  // panel below (#234), so this confirms an answered question rather than
  // announcing a move the app made on its own.
  const carriedNotice = carriedWork ? (
    <Notice.Root intent="info" spokenMessage={SILENT}>
      <Notice.Description>
        Your {carriedWork.files} uncommitted {carriedWork.files === 1 ? 'change' : 'changes'} came along into #{carriedWork.ticket}, and will go into its patch.
      </Notice.Description>
    </Notice.Root>
  ) : null;

  // The counterpart for the other answer to the same question: the edits were
  // saved and the ticket started clean. Rendered wherever the panel that
  // asked could have been, because that panel — and the path it showed — is
  // gone once the switch completes.
  const savedCleanNotice = patchSavedNotice ? (
    <Notice.Root intent="info" spokenMessage={SILENT}>
      <Notice.Description>
        Your edits were saved to {patchSavedNotice} and are no longer in the working tree.
      </Notice.Description>
    </Notice.Root>
  ) : null;

  const switchProgressLine = ticketSaving && switchProgress ? (
    <Stack direction="row" align="center" gap="sm">
      <UiSpinner />
      <Text variant="body-md" className="muted-label">{describeSwitchProgress(switchProgress)}</Text>
    </Stack>
  ) : null;
  // One gate for every ticket action, and the sentence that goes with it
  // (#409): a control this disables says why, through ReasonedButton.
  const ticketActionsReason = ticketActionDisabledReason({ ticketSaving, deletingBranch, updateState, installing, building, applyState, noun: workItem.noun });

  // The one question both paths now ask (#234). Picking a ticket while trunk
  // has uncommitted edits used to do opposite things — carry them silently
  // into a new ticket, refuse the switch to a known one — split by an
  // implementation fact the contributor cannot see. Now main refuses both
  // ways with `dirty-trunk` and this panel asks once. Only the carry needs
  // the ticket to be new: an existing branch has its own work to restore, so
  // loose edits cannot ride into it. Rendered as a variable because two
  // views hold a "Link ticket" field, and a refusal with no panel under it
  // would be a dead end in the second one.
  const dirtyQuestion = blockedByTrunkWork ? dirtyTrunkQuestion({
    ...blockedByTrunkWork,
    pullRequest: blockedByTrunkWork.kind === 'pr' ? blockedByTrunkWork.number : null,
    noun: workItem.noun
  }) : null;
  const blockedPanel = blockedByTrunkWork ? (
    <Notice.Root intent="warning" spokenMessage={SILENT}>
      <Notice.Description>{dirtyQuestion.question}</Notice.Description>
      {patchSavedTo ? (
        <Notice.Description>
          <strong>Saved to {patchSavedTo}. The edits are still in the working tree.</strong>
        </Notice.Description>
      ) : null}
      <Notice.Actions>
        {dirtyQuestion.carry ? (
          <ReasonedUiButton
            variant="outline"
            tone="neutral"
            size="compact"
            reason={ticketActionsReason}
            onClick={() => saveTicket(blockedByTrunkWork.ref, { carryTrunkWork: true })}
          >{dirtyQuestion.carry}</ReasonedUiButton>
        ) : null}
        <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={ticketActionsReason} onClick={() => saveTrunkWorkThenStartClean(blockedByTrunkWork)}>
          {dirtyQuestion.save}
        </ReasonedUiButton>
        <ReasonedUiButton
          variant="outline"
          tone="neutral"
          size="compact"
          reason={ticketActionsReason}
          onClick={() => confirmAnd('Discard the uncommitted edits on trunk? This cannot be undone.', () => discardTrunkWorkAndSwitch(blockedByTrunkWork))}
        >{dirtyQuestion.discard}</ReasonedUiButton>
        {/* The way out that touches nothing — three consequential actions
            with no fourth door is its own trap (#234). */}
        {/* For a pull request it takes the preview with it: the preview is
            a dialog, set aside while this is asked, and would otherwise come
            back in front of whoever has just said "not now". */}
        <ReasonedUiButton variant="minimal" tone="neutral" size="compact" reason={ticketActionsReason} onClick={() => { if (blockedByTrunkWork.kind === 'pr') setApplyPreview(null); setBlockedByTrunkWork(null); setPatchSavedTo(''); }}>
          {dirtyQuestion.cancel}
        </ReasonedUiButton>
      </Notice.Actions>
    </Notice.Root>
  ) : null;

  // What the panel says back after an action: the refusal, the switch's
  // progress line, the carried-work and saved-clean notices, and the
  // dirty-trunk question. Rendered under the controls that cause them, the
  // Unlink row and the trunk notice's button when a ticket is linked, the
  // Link ticket field when none is, rather than at the foot of a card that
  // can be a screen tall by the time the pull requests have loaded.
  const ticketFeedback = (
    <>
      {ticketError ? (
        <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
          <Notice.Description>{ticketError}</Notice.Description>
        </Notice.Root>
      ) : null}
      {switchProgressLine}
      {carriedNotice}
      {savedCleanNotice}
      {blockedPanel}
    </>
  );
  // How old the site's trunk is (#94), for the notice that offers an update.
  const age = trunkAgeInfo({ trunkDate });
  // Where the note goes moves with the ticket: a change that belongs to
  // #12345 is news for the ticket card, one that belongs to nothing is news
  // for the buttons that would give it somewhere to go.
  const changesNote = changesNoteParts({ ...(worktreeDirty || {}), tracTicket, pullRequest, workItemNoun: workItem.noun });
  const staleTicketNotice = ticketTrunkNotice({ ticketId: tracTicket, behind: ticketBehindTrunk, noun: workItem.noun });
  const legacyNotice = legacySiteNotice({ legacy });
  const mergeNotice = mergeInProgressNotice({ mergeInProgress });

  // Whether the terminal is free, and what the site's view says about the
  // patch or pull request that is applied (#11).
  const showTerminalHints = Boolean(hasBuilt);
  const terminalBusy = computeTerminalBusy({
    terminalRunning, installing, building, starting, running, isUpdating, isApplying
  });

  // The applied patch as a layer with a name (#306), not an undo blob. Both
  // answers come from the same record: whether it can still be lifted out —
  // measured in main on every status read, so it comes back on its own when the
  // overlapping edit is undone — and whose changes the next patch would land on.
  const appliedLayer = describeAppliedLayer(appliedPatch, {
    when: appliedPatch?.appliedAt ? new Date(appliedPatch.appliedAt).toLocaleString() : ''
  });
  const appliedPatchLabel = appliedPatch?.label || 'The patch you applied';
  const previewAttribution = attributeConflicts({ conflicts: applyPreview?.conflicts, appliedPatch });
  const prCheckout = pullRequest ? describePrCheckout({ ...pullRequest, noun: workItem.noun }) : null;
  // The banner's tone and headline follow the watch (#509): green only once
  // the site is built around the checkout.
  const prBanner = pullRequest ? appliedBannerState({ number: pullRequest.number, watchState, compiling: watchCompiling, buildInterrupted, actionsReason: ticketActionsReason }) : null;
  const prPreview = applyPreview?.kind === 'pr' ? describePrPreview({
    number: applyPreview.number,
    files: applyPreview.files,
    needsInstall: applyPreview.needsInstall,
    exists: applyPreview.exists,
    moved: applyPreview.moved,
    hasEdits: applyPreview.hasEdits,
    state: applyPreview.prState
  }) : null;
  // The layer exits reach the same two operations the changes note does, so
  // they go through the same guard: a discard is a force checkout, and running
  // it under a live dev server or a half-finished install rewrites the tree
  // from under it. Not re-derived here — that is how a second answer starts.
  const layerExitBlocked = discardBlocked({ isUpdating, installing, building, devServerActive: isDevProcessActive, discarding });
  const layerExit = layerExitFailure({ patchSaveError, discardError });

  // --- Initial setup, as one chain (#246) ---
  // The third chain, and the only one nobody starts: between the clone, the
  // install and the build there is no decision to make, so making the
  // contributor notice each one end and click the next was work the app was
  // handing back for nothing. It runs on its own once the clone finishes.
  //
  // What makes that reasonable rather than presumptuous is that it is visible
  // and it stops: the checklist names the running step, and Stop actually ends
  // the child (an install included, since the kill path learned to reach one).
  const isSettingUp = setupChainState !== 'idle';
  const setupSteps = planSetupSteps();
  const setupStepStates = updateStepStatuses(setupSteps, setupChainState, SETUP_STATE_TO_STEP);
  // Whether this chain is ending because the contributor asked it to. A killed
  // npm exits non-zero — on Windows without even a signal — so the exit code
  // cannot tell a stop from a failure; only the fact that we asked for the kill
  // can.
  const setupStoppedRef = useRef(false);

  // One sentence per way the chain can end, and `setupOutcome` is what picks
  // between them. Every one of them ends by naming where the rest of the work
  // now lives, because the chain going quiet is otherwise indistinguishable
  // from the app having forgotten about the site.
  const SETUP_END_MESSAGES = {
    done: '\nSetup complete — start the dev server when you are ready.\n',
    stopped: '\nSetup stopped. The remaining steps are in the checklist above — run them whenever you are ready.\n',
    'failed-install': '\nnpm install failed — setup stopped here. Its output is above; retry the install from the checklist.\n',
    'failed-build': '\nThe build failed — dependencies are installed. Its output is above; retry the build from the checklist.\n'
  };

  const finishSetupChain = (outcome) => {
    markTerminalRunning(false);
    terminalKillRef.current = null;
    setSetupChainState('idle');
    setSetupChainEnd(outcome);
    writeToTerminal(SETUP_END_MESSAGES[outcome] || '');
    if (outcome === 'done') confirm(__('This site is ready to work on'));
  };

  const stopSetupChain = () => {
    setupStoppedRef.current = true;
    writeToTerminal('\nStopping setup…\n');
    killCurrent().catch(() => {});
  };

  const startSetupChain = () => {
    const state = terminalStateRef.current;
    if (state.running) return;
    setupStoppedRef.current = false;
    setSetupChainEnd(null);
    markTerminalRunning(true);
    terminalKillRef.current = () => { stopSetupChain(); };
    setSetupChainState('installing');
    writeToTerminal('\nSetting this site up — running npm install…\n');
    runInstall({
      onLog: (chunk) => writeToTerminal(chunk),
      onDone: ({ code }) => {
        const stopped = setupStoppedRef.current;
        // Stopping at the first failure is not politeness — a build on a
        // half-installed tree cannot work, and its failure would bury the one
        // that mattered (#42).
        if (stopped || code !== 0) {
          finishSetupChain(setupOutcome({ stopped, installCode: code }));
          return;
        }
        // Checked again here: Stop is reachable in the moment between the
        // install ending and the build being spawned, and a stop that quietly
        // started a half-hour build would be the worst possible answer to it.
        if (setupStoppedRef.current) {
          finishSetupChain(setupOutcome({ stopped: true }));
          return;
        }
        setSetupChainState('building');
        writeToTerminal('\nRunning npm run build…\n');
        runScript('build', {
          onLog: (chunk) => writeToTerminal(chunk),
          onDone: ({ code: buildCode }) => {
            finishSetupChain(setupOutcome({
              stopped: setupStoppedRef.current,
              installCode: 0,
              buildCode
            }));
          }
        });
      }
    });
  };

  // The chain is started by an edge, not by a state: the clone finishing. The
  // ref keeps that edge reachable from an effect that must not re-run whenever
  // the chain's own callbacks are rebuilt on a render.
  const startSetupChainRef = useRef(startSetupChain);
  useEffect(() => { startSetupChainRef.current = startSetupChain; });

  const wasPendingRef = useRef(isPending);
  const setupChainArmedRef = useRef(false);
  useEffect(() => {
    const gate = {
      wasPending: wasPendingRef.current,
      isPending,
      alreadyArmed: setupChainArmedRef.current
    };
    wasPendingRef.current = isPending;
    // Two calls, because the decision is: is this the clone-finished edge (so
    // reading the site's state off disk is worth it), and then does that state
    // say this is a fresh clone we should drive. See setupAutoStartDecision.
    if (setupAutoStartDecision(gate) !== 'probe') return undefined;
    setupChainArmedRef.current = true;
    let cancelled = false;
    (async () => {
      // The status this row is holding was probed while the clone was still
      // running, so it is re-read here rather than trusted.
      const status = (await loadStatus()) || null;
      if (cancelled) return;
      if (setupAutoStartDecision({ ...gate, status }) !== 'start') return;
      startSetupChainRef.current();
    })();
    return () => { cancelled = true; };
  }, [isPending, loadStatus]);

  // The single most recent patch across whatever is loaded — PRs always, Trac
  // attachments once the contributor has opened them (#11). Drives the "Latest"
  // pill and the "latest is a patch file" note.
  // `rankComplete` travels with the list: when the commit-date walk stopped
  // early there is no pill, because an unranked row could be the newer fix
  // (#281).
  const latestPatch = pickLatest({
    prs: ticketPatches?.items,
    attachments: tracAttachments?.items,
    prRankComplete: ticketPatches?.rankComplete
  });
  // Attachments are Trac's; a GitHub issue never has one, whatever a stale
  // scrape says (#251).
  const latestIsAttachment = showTracCards && latestPatch?.kind === 'attachment';
  // The ticket's own facts (#292), riding the same scrape as the attachments:
  // one Trac visit, one challenge, both answers.
  const tracInfo = showTracCards ? (tracAttachments?.ticket || null) : null;

  // The diff fetch, shared by opening the modal and by a discard that happens
  // while it is open — the pane has to show what the tree now holds, which
  // after a discard is the "nothing to send" banner.
  const loadPatchText = async () => {
    setPatchLoading(true);
    setPatchLoadFailed(false);
    try {
      const res = await window.api.getPatch(sitePath);
      if (res && res.ok) setPatchText((res.patch && res.patch.trim().length) ? res.patch : 'No changes.');
      else {
        setPatchLoadFailed(true);
        setPatchText(res && res.error ? `Error: ${res.error}` : 'Failed to generate patch');
      }
    } catch (e) {
      setPatchLoadFailed(true);
      setPatchText(`Error: ${e && e.message ? e.message : String(e)}`);
    } finally {
      setPatchLoading(false);
    }
  };

  const openPatchModal = async ()=>{
    setIsPatchOpen(true);
    setPatchText('');
    setPatchLoadFailed(false);
    // Last time's outcome belongs to last time's patch.
    setPatchSaved(null);
    setPatchSaveError('');
    setDiscardError(null);
    // Same rule for the pull request card, which also reads the account again.
    prSubmission.startReview();
    await loadPatchText();
  };

  // One discard for both entry points — the note's link and the modal's. The
  // confirm is the same native one the dirty-update modal uses; the user has
  // already chosen, this is the last chance to notice they chose wrong.
  // Both links disable through discardBlocked; no re-check in here. The
  // native confirm blocks the renderer, so the states discardBlocked names
  // cannot flip while the dialog is up — a check after it would read the
  // same render-time values the disabled prop already enforced.
  const discardAllChanges = () => confirmAnd(DISCARD_CONFIRM_MESSAGE, async () => {
    setDiscarding(true);
    setDiscardError(null);
    try {
      let outcome;
      try {
        outcome = discardOutcome(await window.api.discardToBase(sitePath));
      } catch (e) {
        // A rejected invoke never returns a reply object; shape it into one so
        // the failure reaches the same red line instead of vanishing.
        outcome = discardOutcome({ ok: false, error: e && e.message ? e.message : String(e) });
      }
      if (!outcome.ok) {
        setDiscardError(outcome.message);
        return;
      }
      applyDiscardToNote(outcome);
      const feedback = applyFeedbackAfterDiscard(outcome);
      setAppliedPatch(feedback.appliedPatch);
      setApplyError(feedback.applyError);
      setApplyConflict(feedback.applyConflict);
      setApplyNotice(feedback.applyNotice);
      writeToTerminal('\nDiscarded local changes.\n');
      confirm(__('All changes discarded.'));
      if (isPatchOpen) await loadPatchText();
    } finally {
      setDiscarding(false);
    }
  });

  // The sentence is one thing wherever it renders; only the wrapper differs.
  const changesNoteBody = changesNote ? (
    <>
      {changesNote.lead}
      <Button variant="link" onClick={openPatchModal} disabled={isUpdating}>{changesNote.patchLabel}</Button>
      {changesNote.middle}
      <DiscardChangesLink
        label={changesNote.discardLabel}
        onClick={discardAllChanges}
        reason={discardDisabledReason({
          patchHasChanges: true,
          isUpdating,
          installing,
          building,
          devServerActive: isDevProcessActive,
          discarding
        })}
      />
      {changesNote.end}
      {discardError ? <Text variant="body-sm" className="error-text">{discardError}</Text> : null}
    </>
  ) : null;

  // Copying is the one action here with no visible result: the clipboard is
  // somewhere else, the diff does not move, and a button that answers nothing
  // reads as a button that did nothing — so it gets pressed again, and the
  // contributor is left unsure whether they have the patch at all.
  //
  // A failed copy says so rather than staying quiet. `writeText` rejects when
  // the document is not focused, which is exactly the case where someone has
  // clicked away mid-action and is least likely to notice nothing happened.
  useEffect(() => () => { if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current); }, []);

  const copyPatch = async () => {
    // Cleared first so a second press restarts the message instead of
    // inheriting the timer of the one before it.
    if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
    let state = 'copied';
    try {
      await navigator.clipboard.writeText(patchText);
    } catch {
      state = 'failed';
    }
    setPatchCopied(state);
    copyFeedbackTimer.current = setTimeout(() => setPatchCopied(''), 2000);
  };

  // Naming destinations for a patch that does not exist would be noise, and
  // both of the states that produce one are already spelled out in the pane
  // below: `getPatch` returns the literal 'No changes.', and its failures are
  // put in the same box prefixed with 'Error'. The sentinel can arrive under
  // `#` lines naming binaries that could not be carried (#85), so the test is
  // "is there a diff under the commentary" rather than a string comparison.
  const reviewContext = patchReviewContext({ pullRequest, tracTicket, workItemNoun: workItem.noun });
  const patchHasChanges = Boolean(patchText)
    && hasDiffLines(patchText)
    && !patchText.startsWith('Error');
  const modalDiscardReason = discardDisabledReason({
    patchLoading,
    patchLoadFailed,
    patchHasChanges,
    isUpdating,
    installing,
    building,
    devServerActive: isDevProcessActive,
    discarding
  });

  // Saving the file, for every destination that needs one (#166). `handoff`
  // asks the main process for the provenance header and the name that carries
  // the handle; `destination: 'trac'` keeps the diff plain but lets main enforce
  // the same applied-layer guard as the UI. With no options this is the backup
  // the Save button has always produced. Returns the path so a caller can say
  // what it did next — the Trac route saves and then opens the attach page.
  const savePatchFile = async (options) => {
    setPatchSaved(null);
    setPatchSaveError('');
    try {
      const res = await window.api.savePatch(sitePath, options);
      if (res && res.ok && res.filePath) {
        setPatchSaved(res.filePath);
        // The green line below is the record of where it went; this is the
        // announcement, for a contributor who saved from a menu and is no
        // longer looking at the pane (#253).
        confirm(patchSavedMessage(pathBasename(res.filePath)));
        return res.filePath;
      }
      if (res && res.canceled) return null;
      setPatchSaveError(res && res.error ? res.error : 'Unknown error');
    } catch (e) {
      setPatchSaveError(e && e.message ? e.message : String(e));
    }
    return null;
  };

  const savePatch = () => savePatchFile();

  // The Trac destination in full: save the file, then open the ticket's attach
  // page so the contributor uploads it themselves. Nothing is posted from here
  // — that would mean carrying a wordpress.org session, which #166 rules out.
  // The page is opened only after a file exists, so the browser never lands on
  // an attach form with nothing to attach.
  const saveForTrac = async () => {
    const filePath = await savePatchFile({ destination: 'trac' });
    // Trac's alone; the destination only renders where the provider has one.
    if (filePath && tracTicket && workItem.attachUrlFor) window.api.openExternal(workItem.attachUrlFor(tracTicket));
  };

  const saveForHandoff = async () => {
    if (!wporg?.handle) return;
    await savePatchFile({ handoff: true });
  };

  const setupFlags = {
    isPending,
    statusLoading,
    hasNodeModules,
    hasBuilt,
    installing,
    building,
    starting,
    installFailed,
    buildFailed,
    isUpdating
  };
  const stepState = computeSetupStepState(setupFlags);
  const { installLabel, installDescription, buildLabel, buildDescription } = setupStepCopy(setupFlags, project.setup);

  const baseSteps = [
    {
      key: 'download',
      label: project.setup.cloneLabel,
      description: isPending
        // The clone is also the trigger for everything after it (#246), so the
        // step says what happens next rather than implying a click is coming.
        ? 'Cloning the repository… install and build start on their own when it finishes.'
        : project.setup.cloneDescription,
      ...stepState.download,
      running: isPending
    },
    {
      key: 'install',
      label: 'Install npm dependencies',
      description: installDescription,
      ...stepState.install,
      running: installing,
      action: (
        <UiButton
          variant={stepState.install.done ? 'outline' : 'solid'}
          tone={stepState.install.done ? 'neutral' : 'brand'}
          size="compact"
          onClick={runInstallWithTerminal}
          disabled={stepState.install.disabled}
        >{installLabel}</UiButton>
      )
    },
    {
      key: 'build',
      label: 'Run full build',
      description: buildDescription,
      ...stepState.build,
      running: building,
      action: (
        <UiButton
          variant={stepState.build.done ? 'outline' : 'solid'}
          tone={stepState.build.done ? 'neutral' : 'brand'}
          size="compact"
          onClick={runBuildWithTerminal}
          disabled={stepState.build.disabled}
        >{buildLabel}</UiButton>
      )
    },
    {
      key: 'dev',
      label: 'Start dev server & finish wizard',
      description: project.setup.serverDescription,
      ...stepState.dev,
      running: starting,
      action: (
        <Stack direction="row" align="center" gap="sm" wrap="wrap">
          <UiButton
            variant={running ? 'outline' : 'solid'}
            tone={running ? 'neutral' : 'brand'}
            size="compact"
            onClick={async () => {
              await markSkipWizard();
              await toggleDevServer();
            }}
            disabled={stepState.dev.disabled}
          >{running ? 'Stop dev server' : 'Start dev server and finish the wizard'}</UiButton>
          {starting || serverUrl ? (
            <Text variant="body-sm">
              {starting ? `Starting… (${formatElapsed(startElapsed)})` : null}
              {!starting && serverUrl ? (
                <>
                  <a href={serverUrl} onClick={(e) => { e.preventDefault(); window.api.openExternal(serverUrl); }}>{serverUrl}</a>
                  <span aria-hidden="true"> · </span>
                  <a href={adminUrl(serverUrl)} onClick={(e) => { e.preventDefault(); window.api.openExternal(adminUrl(serverUrl)); }}>wp-admin</a>
                </>
              ) : null}
            </Text>
          ) : null}
        </Stack>
      )
    }
  ];

  const stepItems = setupStepStatuses(baseSteps);

  // The one block to point the contributor at next (#252). The checklist has
  // already worked out its own current step; the resolver folds that together
  // with the post-init state into a single id, which the render tags onto the
  // matching block (`data-next-action` + the `.next-action-cue` class) and the
  // cue hook scrolls into view.
  // A failed step counts as the one to point at: retrying it is exactly what
  // the contributor should do next, and it consumes no `current` of its own, so
  // without this a chain that stopped would leave the view with no cue at all.
  const currentSetupStep = stepItems.find((s) => s.status === 'current' || s.status === 'failed')?.key || null;
  const nextAction = deriveNextAction({
    skipInit,
    currentSetupStep,
    isApplying,
    applyPreview: Boolean(applyPreview),
    updateIncomplete,
    isUpdating,
    stale: age.stale,
    running,
    pullRequest,
    hasChanges: Boolean(worktreeDirty && worktreeDirty.dirty),
    ticketLinked: Boolean(tracTicket),
    workItemLabel: project.workItem.label
  });
  const nextActionId = nextAction ? nextAction.id : null;
  useNextActionCue(nextActionId, isActive, nextActionSectionRef);

  // Tags a block as a cue target: the `data-next-action` the hook scrolls to,
  // and the `.next-action-cue` class React draws the ring with when this block
  // is the one. Spread onto the block that carries the id's action.
  const cueProps = (id) => ({
    'data-next-action': id,
    className: nextActionId === id ? 'next-action-cue' : undefined
  });

  // What the work-item card is handed besides its own content: the banner of
  // a checked-out pull request, the note about uncommitted changes when it
  // belongs with the ticket, and whether a patch can be read now. Reading
  // one is held by everything that would be working on the files it reads
  // against, and by a preview that is already open.
  const prCheckoutBanner = prCheckout && !isApplying ? (
    <PrCheckoutNotice cue={cueProps('pr-checkout')} banner={prBanner} checkout={prCheckout} onRevert={() => runPrSwitch({ leaving: true })} />
  ) : null;
  const ticketChangesNote = changesNote && changesNote.placement === 'ticket' ? (
    <Stack direction="column" gap="xs">
      <Text variant="body-md">{changesNoteBody}</Text>
      <Text variant="body-sm" className="muted-label">{changesNote.unlinkNote}</Text>
    </Stack>
  ) : null;
  const patchReadBlocked = isApplying || isUpdating || installing || building || Boolean(applyPreview);
  // The two ways out the apply card offers of a patch that cannot be lifted
  // back out, or that would not go on: the same two the changes note has,
  // behind the same guard, with what either said when it failed.
  const layerExits = { blocked: layerExitBlocked, onSaveCopy: savePatch, onDiscard: discardAllChanges, message: layerExit.message };
  // Choosing another patch is walking away from this one, so everything
  // about it goes: the preview, whose presence holds the lists' Apply
  // buttons, and the failure itself, which would otherwise sit above the new
  // attempt as noise. The list is already on screen, so the way to it is a
  // scroll.
  const tryAnotherPatch = () => {
    setApplyPreview(null);
    clearApplyError();
    ticketPatchesRef.current?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
    });
  };

  return (
    <section ref={nextActionSectionRef} className="site-view">
      {/* The glow on the next-action block is purely visual, invisible to a
          screen reader. This is its spoken equivalent: a polite live region that
          names the next step as the cue moves, so a non-sighted contributor gets
          the same hint. The region is always mounted and only its text toggles —
          a live region that appears already holding text is not reliably read,
          whereas a change to one already in the DOM is. Only the active row ever
          holds text, so only the visible site speaks; it clears to nothing when
          there is no next action. */}
      <VisuallyHidden role="status" aria-live="polite">
        {isActive && nextAction ? `Next step: ${nextAction.reason}` : ''}
      </VisuallyHidden>
      {/* What this site has in the tray along the bottom of the window (#558).
          Every site's is there, and all but the open site's are hidden: a
          terminal is drawn in one element for as long as it lives, and what a
          site's commands print has to be there when the site is looked at
          again. Inside it, the tray that is open is the one shown. */}
      <SiteTrayFill>
        <div className="tray-site" hidden={!isActive}>
          <div className="tray-panel" hidden={tray !== 'terminal'}>
            {/* The pane has the padding and the element inside it has none,
                so that what the terminal is fitted to is the room it has. */}
            <div className="terminal-pane"><div ref={terminalContainerRef} className="terminal-screen" /></div>
            <Stack direction="column" gap="xs" className="tray-notes">
              {showTerminalHints ? (
                <>
                  <Text variant="body-sm" className="muted-label">Edited files in <code>{project.cards.sourceDir}</code>? Run <TerminalCommandLink command="npm run build" onPrefill={prefillTerminalCommand} disabled={terminalBusy} /> so the site picks them up.</Text>
                  <Text variant="body-sm" className="muted-label">Added a dependency to <code>package.json</code>? Run <TerminalCommandLink command="npm install" onPrefill={prefillTerminalCommand} disabled={terminalBusy} />.</Text>
                </>
              ) : null}
              <Text variant="body-sm" className="muted-label">
                Type <code>help</code> to list supported commands. Press <code>Ctrl+C</code> to stop the current command.
              </Text>
            </Stack>
          </div>
          <LogsPanel
            hidden={tray !== 'logs'}
            tabs={logTabs}
            logs={logs}
            copyLabel={COPY_BUTTON_LABELS[logs.debugCopied] || COPY_BUTTON_LABELS.idle}
          />
        </div>
      </SiteTrayFill>
      {/* What is done to the site as a whole is in the page's header (#556):
          the window leaves a slot there, and the site that is open fills it. */}
      {isActive ? (
        <SiteHeaderActions
          detailsOpen={detailsOpen}
          detailsId={detailsId}
          onToggleDetails={onToggleDetails}
          menu={{ platform: window.api?.platform, editors: detectedEditors, detecting: detectingEditors, isPending, isDeleting, updateHeld }}
          onMenuOpen={loadDetected}
          onAction={runSiteMenuAction}
          work={skipInit ? {
            server: serverState,
            watch: watchProcessState,
            onToggleServer: toggleDevServer,
            onToggleWatch: toggleWatch,
            // The site and its admin, while there is a server to go to: the
            // details have them too, and can be put away.
            serverLinks: serverSectionState.menuLinks,
            onOpenLink: openSiteLink,
            onReview: openPatchModal,
            reviewDisabled: isUpdating,
            serverCue: cueProps('start-dev'),
            reviewCue: cueProps('review-changes')
          } : null}
        />
      ) : null}
      <div className={detailsOpen ? 'dashboard' : 'dashboard is-sidebar-collapsed'}>
      <div className="dashboard-main">
    {/* With no modal in the way, this is the only place a failed open can
        speak — and it carries the way out with it, rather than leaving the
        contributor to find the menu again. The menu is in the header, which
        does not scroll, so this is brought into view when it appears. */}
    {editorNotice ? (
      <Notice.Root ref={editorNoticeRef} intent="warning" role="alert" spokenMessage={SILENT}>
        <Notice.Description>{editorNotice.message}</Notice.Description>
        {editorNotice.offerPicker ? (
          <Notice.Actions>
            <UiButton variant="outline" tone="neutral" size="compact" onClick={() => void openIn(null)}>Choose application…</UiButton>
          </Notice.Actions>
        ) : null}
      </Notice.Root>
    ) : null}
      {legacyNotice && !isPending ? (
        <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
          <Notice.Title>{legacyNotice.title}</Notice.Title>
          <Notice.Description>{legacyNotice.body}</Notice.Description>
          <Notice.Actions>
            <UiButton size="compact" onClick={onCreateSite}>Create site</UiButton>
          </Notice.Actions>
        </Notice.Root>
      ) : null}
      {mergeNotice && !isPending ? (
        <Notice.Root intent="error" role="alert" spokenMessage={SILENT}>
          <Notice.Title>{mergeNotice.title}</Notice.Title>
          <Notice.Description>{mergeNotice.body}</Notice.Description>
        </Notice.Root>
      ) : null}
      {updateIncomplete && !isUpdating ? (
        <Notice.Root {...cueProps('retry-install-build')} intent="error" spokenMessage={SILENT}>
          <Notice.Title>Update incomplete</Notice.Title>
          <Notice.Description>The code is new but the built assets are old. The site may not run correctly until install and build succeed.</Notice.Description>
          <Notice.Actions>
            <UiButton variant="outline" tone="neutral" size="compact" onClick={retryInstallAndBuild} disabled={installing || building}>Retry install &amp; build</UiButton>
          </Notice.Actions>
        </Notice.Root>
      ) : null}
      {age.stale && !updateIncomplete && !isUpdating ? (
        <Notice.Root {...cueProps('update-trunk')} intent="warning" spokenMessage={SILENT}>
          <Notice.Title>This site&apos;s WordPress code is {age.ageDays} days old</Notice.Title>
          <Notice.Description>Patches you create now may not apply on Trac. Updating takes a few minutes.</Notice.Description>
          <Notice.Actions>
            <ReasonedUiButton variant="outline" tone="neutral" size="compact" reason={updateHeld} onClick={startTrunkUpdate}>Update to latest trunk</ReasonedUiButton>
          </Notice.Actions>
        </Notice.Root>
      ) : null}
      {isUpdating ? (
        <TrunkUpdateCard
          cue={cueProps('updating')}
          rows={updateStepStates.map((step) => ({ key: step.key, label: updateStepText(updateSteps, step), status: step.status }))}
          count={`step ${Math.max(1, updateStepStates.filter((step) => step.status === 'complete' || step.status === 'skipped').length + 1)} of ${updateSteps.length}`}
          note={updateState === 'installing' ? 'Most packages are already cached, so this is a download of the difference — not the whole tree.' : ''}
        />
      ) : null}
      {lastUpdateSummary && !isUpdating && !updateIncomplete ? (
        <Notice.Root intent="success" spokenMessage={SILENT}>
          <Notice.Title>Up to date with trunk as of today.</Notice.Title>
          <Notice.Description>
            {lastUpdateSummary.lockfileChanged ? 'Dependencies updated' : 'Dependencies unchanged'}
            {typeof lastUpdateSummary.elapsedSeconds === 'number' ? `, rebuilt in ${formatElapsed(lastUpdateSummary.elapsedSeconds)}.` : ', rebuilt.'}
            {lastUpdateSummary.savedPatchPath ? ` Your changes were saved to ${lastUpdateSummary.savedPatchPath} before the reset.` : ''}
          </Notice.Description>
          <Notice.CloseIcon onClick={() => setLastUpdateSummary(null)} />
        </Notice.Root>
      ) : null}
      {!skipInit ? (
        <SetupChecklist
          steps={stepItems}
          cueId={nextActionId}
          running={isSettingUp ? {
            // The step counter comes from the same `updateStepStatuses` the
            // update card uses.
            title: `Setting this site up for you — step ${setupStepStates.filter((s) => s.status === 'complete').length + 1} of ${setupSteps.length}`,
            body: setupChainState === 'installing'
              ? 'Installing dependencies. You can leave this running — the build follows on its own.'
              : 'Running the full build. This can take up to half an hour on Windows; the Terminal shows what it is doing.',
            onStop: stopSetupChain
          } : null}
          stopped={setupChainEnd === 'stopped'}
          onSkip={markSkipWizard}
        />
      ) : null}
      {/* The server, the build watch and the way to the changes are in the
          page's header and in the details (#557). What the changes note says
          when it has no card of its own to sit in stays here. */}
      {skipInit && changesNote && changesNote.placement === 'buttons' ? (
        <Text variant="body-md">{changesNoteBody}</Text>
      ) : null}
      {/* Above the ticket panel rather than inside it, and outside the wizard
          gate: a link can arrive whether or not this site already has a ticket,
          and a site still in the setup wizard shows no ticket panel at all —
          which is exactly when a ticket that vanished silently would be worst. */}
      {deepLinkNote ? (
        <Notice.Root intent="warning" role="status" spokenMessage={SILENT}>
          <Notice.Title>{deepLinkNote.title}</Notice.Title>
          <Notice.Description>{deepLinkNote.body}</Notice.Description>
          <Notice.Actions>
            <UiButton variant="outline" tone="neutral" size="compact" onClick={() => setDeepLinkNoteHidden(true)}>Hide</UiButton>
          </Notice.Actions>
        </Notice.Root>
      ) : null}
      {deepLinkPrompt ? (
        <Notice.Root intent="info" role="status" spokenMessage={SILENT}>
          <Notice.Title>{deepLinkPrompt.title}</Notice.Title>
          <Notice.Description>{deepLinkPrompt.body}</Notice.Description>
          <Notice.Actions>
            {/* No `loading`: answering clears the App's deep-link value, so this
                button is gone in the same tick it is pressed. What the link
                started is then reported where every other ticket link reports
                it — the panel's own progress line and `ticketError`. */}
            <ReasonedUiButton
              size="compact"
              onClick={acceptDeepLink}
              reason={skipInit ? ticketActionsReason : 'Finish setting this site up first.'}
            >{deepLinkPrompt.confirmLabel}</ReasonedUiButton>
            <UiButton variant="minimal" tone="neutral" size="compact" onClick={dismissDeepLink}>Not now</UiButton>
          </Notice.Actions>
        </Notice.Root>
      ) : null}
      {skipInit ? (
        <TicketCard
          cue={cueProps('link-ticket')}
          provider={project.workItem.provider}
          ticketId={tracTicket || null}
          ticketUrl={tracTicket ? workItem.urlFor(tracTicket) : ''}
          onOpen={openSiteLink}
          link={{
            value: ticketInput,
            onChange: (value) => { setTicketInput(value); setTicketError(''); },
            onSubmit: linkTicket,
            saving: ticketSaving,
            reason: ticketActionsReason,
            browseUrl: project.workItem.browseUrl
          }}
          unlink={{ onUnlink: unlinkTicket, reason: ticketActionsReason }}
          details={showTracCards ? { info: tracInfo, loading: tracAttachmentsLoading, onRead: loadTracAttachments } : null}
          staleNotice={staleTicketNotice ? {
            ...staleTicketNotice,
            busy: ticketSaving,
            reason: rebaseDisabledReason({ ticketSaving, deletingBranch, updateState, installing, building, devServerActive: isDevProcessActive, discarding, noun: workItem.noun }),
            onAction: rebaseTicket
          } : null}
          feedback={ticketFeedback}
          changesNote={ticketChangesNote}
          banner={prCheckoutBanner}
          pullRequests={{
            list: ticketPatches,
            loading: ticketPatchesLoading,
            onRefresh: loadTicketPatches,
            latest: latestPatch,
            appliedNumber: pullRequest ? pullRequest.number : null,
            apply: { hidden: Boolean(pullRequest), disabled: patchReadBlocked, fetching: fetchingPr, onApply: previewPr }
          }}
          pullRequestsRef={ticketPatchesRef}
          attachments={showTracCards ? {
            result: tracAttachments,
            loading: tracAttachmentsLoading,
            items: patchAttachments,
            latest: latestPatch,
            onLoad: loadTracAttachments,
            loadDisabled: isApplying || isUpdating || installing || building,
            apply: { hidden: Boolean(pullRequest), disabled: patchReadBlocked, fetching: fetchingAttachment, onApply: previewAttachment }
          } : null}
          latestIsAttachment={latestIsAttachment}
        />
      ) : null}
      {skipInit && (!pullRequest || isApplying || Boolean(applyError)) ? (
        <ApplyCard
          cardRef={applyCardRef}
          patchFiles={Boolean(project.cards.patchFiles)}
          entry={!pullRequest && !isApplying ? {
            value: prUrlInput,
            onChange: (value) => { setPrUrlInput(value); clearApplyError(); setApplyNotice(''); },
            onSubmit: previewPrFromInput,
            onChooseFile: choosePatchFile,
            // A patch already read is being looked at, or waits on a
            // question: one at a time.
            disabled: isUpdating || installing || building || Boolean(applyPreview)
          } : null}
          applied={appliedLayer && !isApplying ? {
            layer: appliedLayer,
            watchMessage: watchBusyMessage(watchState, watchCompiling),
            onRevert: () => runApply({ reverse: true }),
            revertDisabled: isUpdating || installing || building,
            exits: layerExits
          } : null}
          progress={isApplying ? { steps: applySteps, states: applyStepStates, cue: cueProps('applying-patch') } : null}
          failure={applyError ? {
            error: applyError,
            kind: applyKind,
            conflict: applyConflict,
            exits: layerExits,
            onDismiss: () => clearApplyError(),
            onTryAnother: tryAnotherPatch,
            onOpen: openSiteLink
          } : null}
          notice={applyNotice ? { text: applyNotice, onDismiss: () => setApplyNotice('') } : null}
        />
      ) : null}
      {skipInit ? (
        <ApplyPreviewDialog
          preview={previewShown({ preview: applyPreview, active: isActive, applying: isApplying, asking: Boolean(blockedByTrunkWork) })}
          pr={prPreview}
          warnings={applyPreview && applyPreview.kind !== 'pr' ? previewAttribution.sentences : []}
          cueId="apply-preview"
          applyDisabled={isUpdating || installing || building}
          applyReason={applyHeldReason({ terminalRunning })}
          focusAfter={applyCardRef}
          onApply={() => runApply()}
          onCancel={() => { setApplyPreview(null); clearApplyError(); setApplyNotice(''); }}
        />
      ) : null}
      {skipInit && ticketsCard ? (
        <TicketListCard
          words={ticketsCard}
          rows={branchRows}
          reason={ticketActionsReason}
          deleting={deletingBranch}
          onSwitch={(row) => saveTicket(String(row.ticketId))}
          onDelete={(row) => askFirst(deleteWorkQuestion(row.ticketId, project.workItem.provider), () => deleteTicketWork(row.ref))}
        />
      ) : null}
      <Stack direction="column" gap="sm" render={<section aria-labelledby={mailTitleId} />}>
        <Text id={mailTitleId} variant="heading-md" render={<h2 />} className="site-panel-title">Mail</Text>
        <Stack direction="row" align="center" justify="space-between" gap="sm">
          <Text variant="body-sm" className="muted-label">{mail.smtpPort ? `SMTP listening on 127.0.0.1:${mail.smtpPort}` : 'SMTP will start with the dev server.'}</Text>
          <UiButton variant="outline" tone="neutral" size="compact" onClick={mail.clear}>Clear emails</UiButton>
        </Stack>
        <div className="mail-list">
          {mail.emails && mail.emails.length ? mail.emails.map((m)=>{
            const when = m.sentAt || m.date; const whenStr = when ? new Date(when).toLocaleString() : '';
            return (
              <div key={m.id}
                className="mail-row"
                role="button"
                tabIndex={0}
                onClick={()=>mail.open(m)}
                onKeyDown={(e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mail.open(m); } }}
              >
                <span className="mail-when">{whenStr}</span>
                <span className="mail-from">{m.from || ''}</span>
                <span className="mail-subject">{m.subject || '(no subject)'}</span>
              </div>
            );
          }) : (
            <Text variant="body-md" className="muted-label mail-empty">No emails yet.</Text>
          )}
        </div>
      </Stack>
      </div>
      <SiteDetails
        id={detailsId}
        open={detailsOpen}
        siteName={displayName}
        facts={{ initialized, created: createdLabel, trunk: age, path: sitePath, checkout: project.label }}
        pathCopied={pathCopied}
        onCopyPath={copyPath}
        server={skipInit ? { process: serverState, section: serverSectionState, onToggle: toggleDevServer, onOpen: openSiteLink } : null}
        watch={skipInit ? { process: watchProcessState, onToggle: toggleWatch } : null}
      />
      </div>
      {dirtyModalOpen ? (
        <DirtyTreeModal
          files={dirtyFiles}
          saving={dirtySaving}
          error={dirtyError}
          onSave={dirtySaveAndUpdate}
          onDiscard={dirtyDiscardAndUpdate}
          onClose={() => setDirtyModalOpen(false)}
        />
      ) : null}
      <RenameSiteDialog open={renameModalOpen} sitePath={sitePath} displayName={displayName} onRename={onRename} onClose={closeRenameModal} />
      <ConfirmDialog question={asking ? asking.question : null} onConfirm={() => asking.action()} onClose={() => setAsking(null)} />
      {isPatchOpen && (
        <ReviewDialog
          onClose={()=>setIsPatchOpen(false)}
          age={age}
          loading={patchLoading}
          loadFailed={patchLoadFailed}
          hasChanges={patchHasChanges}
          emptyMessage={reviewContext.empty}
          pullRequest={pullRequest}
          appliedPatch={appliedPatch}
          appliedPatchLabel={appliedPatchLabel}
          diff={
            <PatchDiffPane
              heading={reviewContext.heading}
              description={reviewContext.description}
              patchText={patchText}
              patchLoading={patchLoading}
              patchLoadFailed={patchLoadFailed}
              patchSaved={patchSaved}
              patchSaveError={patchSaveError}
              copyLabel={COPY_BUTTON_LABELS[patchCopied] || COPY_BUTTON_LABELS.idle}
              copied={patchCopied === 'copied'}
              discardReason={modalDiscardReason}
              discardError={discardError}
              onSave={savePatch}
              onCopy={copyPatch}
              onDiscard={discardAllChanges}
            />
          }
        >
          {/*
            Alone in its own group, because it is the one destination
            that acts for the contributor: it signs them in, forks, and
            pushes. That is also where the signup cliff is (#167), named
            here before anything happens rather than sprung after they
            have left the venue.
          */}
          <DestinationGroup>
            <PullRequestDestination
              pr={prSubmission}
              project={project}
              workItem={workItem}
              ticket={tracTicket}
              refusal={prSubmissionBlocked({ pullRequest, appliedPatch, appliedPatchLabel })}
              onSavePatch={savePatch}
            />
          </DestinationGroup>

          <DestinationGroup>
            {showTracCards ? (
            <TracDestination
              ticket={tracTicket}
              saveDisabled={Boolean(appliedPatch || pullRequest)}
              onSave={saveForTrac}
              ticketInput={ticketInput}
              onTicketInputChange={(value) => { setTicketInput(value); setTicketError(''); }}
              onLinkTicket={linkTicket}
              linking={ticketSaving}
              linkReason={ticketActionsReason}
              ticketError={ticketError}
            >
              {switchProgressLine}
              {savedCleanNotice}
              {blockedPanel}
            </TracDestination>
            ) : null}

            <MentorHandoff wporg={wporg} saveDisabled={Boolean(appliedPatch || pullRequest)} onSave={saveForHandoff} />
          </DestinationGroup>
        </ReviewDialog>
      )}
      {mail.activeEmail && (
        <EmailModal email={mail.activeEmail} onClose={mail.close} />
      )}
    </section>
  );
}

// The locale loads before the first render, so no string is ever painted in
// English and then swapped. A failed read leaves the page in English.
async function loadLocale() {
  let reply;
  try {
    reply = await window.api.getLocale();
  } catch (err) {
    // eslint-disable-next-line no-console -- reaches the log file: logging.js initializes electron-log with spyRendererConsole, so this is how the renderer records a diagnostic.
    console.error('Could not load the locale; showing English:', err);
  }
  document.documentElement.lang = applyLocale(reply, { setLocaleData, addFilter });
  document.documentElement.dir = textDirection(_x);
  document.title = __('WordPress Contributor Toolkit');
}

// The design system's provider, at its defaults: the tokens stylesheet already
// holds every value, so this changes nothing on screen yet. It is here so the
// redesign (#542) has one place to set colour and corner radius from. `isRoot`
// puts whatever it overrides on the document rather than on its own wrapper,
// which is what reaches a modal or a popover: those are portalled to `body`,
// outside this tree.
loadLocale().then(() => {
  const root = createRoot(document.getElementById('root'));
  root.render(<ThemeProvider isRoot><App /></ThemeProvider>);
});
