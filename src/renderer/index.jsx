import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Button,
  TabPanel,
  Card,
  CardBody,
  Dropdown,
  Flex,
  DropdownMenu,
  Icon,
  MenuGroup,
  MenuItem,
  SnackbarList,
  TextControl,
  Spinner
} from '@wordpress/components';
import { __, setLocaleData } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { plus, chevronLeft, chevronRight, chevronDown, copy as copyIcon, check as checkIcon, pencil, comment } from '@wordpress/icons';
import { ThemeProvider } from '@wordpress/theme';
import { VisuallyHidden } from '@wordpress/ui';
// The design system's tokens: every `--wpds-*` custom property, at its default,
// on `:root`.
import '@wordpress/theme/design-tokens.css';
import '@wordpress/components/build-style/style.css';
import '@xterm/xterm/css/xterm.css';
import { computeSetupStepState, setupStepStatuses, setupStepCopy, setupAutoStartDecision, setupStepLabel } from './setup-steps.cjs';
import { deriveNextAction } from './next-action.cjs';
import { computeTerminalBusy } from './terminal-hints.cjs';
import { formatElapsed, watchTabLabel } from './dev-server-command.cjs';
import { watchOccupiesBuild } from './watch-waiters.cjs';
import { compilingMessage, watchBusyMessage, applyFinishMessage, resumedWatchHandOff, appliedBannerState } from './watch-activity.cjs';
import { pathBasename } from './path-basename.cjs';
import { applyLocale } from './locale-setup.cjs';
import { getProjectType } from '../project-type.cjs';
import { sanitizeSiteFolder, resolveTargetDir } from './site-folder.cjs';
import { noticeForOpenResult } from './open-failure.cjs';
import { describeApplyFailure, otherPatchCount } from './apply-conflict.cjs';
import { describeAppliedLayer, attributeConflicts, layerExitFailure } from './applied-layer.cjs';
import { trunkAgeInfo, updateStepStatuses, SKIP_INSTALL_MESSAGE, planApplySteps, planWatchImpact, planTicketSwitchImpact, APPLY_STATE_TO_STEP, planSetupSteps, SETUP_STATE_TO_STEP, setupOutcome, updateStepText } from './update-plan.cjs';
import { pickLatest } from '../latest-patch.cjs';
import { beginSetup, adoptSetupPath, discardSetup, rowPathAfterStatus } from './pending-setup.cjs';
import { parsePrRef } from '../patch-sources.cjs';
import { prStateBadge } from './pr-state.cjs';
import { statusBadge } from '../trac-ticket-info.cjs';
import { prDateLabel } from './pr-date-label.cjs';
import { workItemProvider } from '../work-item.cjs';
import { adminUrl, adminerUrl } from './site-urls.cjs';
import { ticketBranchRows, savedPrForSwitch, ticketListCard } from './ticket-branch-list.cjs';
import { ticketTrunkNotice, rebaseRefusal } from './ticket-trunk-notice.cjs';
import { legacySiteNotice } from './legacy-site.cjs';
import { deepLinkNotice } from './deep-link-notice.cjs';
import { mergeInProgressNotice } from './merge-in-progress.cjs';
import { describePrCheckout, describePrPreview, prCheckoutRefusal, prSubmissionBlocked } from './pr-checkout.cjs';
import { describeSwitchProgress } from '../switch-progress.cjs';
import { hasDiffLines } from './diff-highlight.cjs';
import { patchReviewContext, changesNoteParts, discardOutcome, applyFeedbackAfterDiscard, noteAfterDiscard, noteAfterProbe, discardBlocked, discardDisabledReason, DISCARD_CONFIRM_MESSAGE } from './changes-note.cjs';
import { ticketActionDisabledReason, rebaseDisabledReason, dirtyTrunkQuestion } from './ticket-actions.cjs';
import { initialConfirmations, confirmationReducer, deleteFailureMessage } from './confirmations.cjs';
import { ReasonedButton } from './components/reasoned-button.jsx';
import { DiscardChangesLink } from './components/discard-changes-link.jsx';
import { LogText } from './components/log-text.jsx';
import { DestinationGroup } from './components/destination.jsx';
import { TerminalCommandLink } from './components/terminal-command-link.jsx';
import { RenameSiteModal } from './components/rename-site-modal.jsx';
import { EmailModal } from './components/email-modal.jsx';
import { DirtyTreeModal } from './components/dirty-tree-modal.jsx';
import { CreateSiteModal } from './components/create-site-modal.jsx';
import { PatchDiffPane } from './components/patch-diff-pane.jsx';
import { MentorHandoff } from './components/mentor-handoff.jsx';
import { TracDestination } from './components/trac-destination.jsx';
import { PullRequestDestination } from './components/pull-request-destination.jsx';
import { ReviewDialog } from './components/review-dialog.jsx';
import { useDetectedEditors } from './hooks/use-detected-editors.jsx';
import { useContributorProvenance } from './hooks/use-contributor-provenance.jsx';
import { useNextActionCue } from './hooks/use-next-action-cue.jsx';
import { useSites } from './hooks/use-sites.jsx';
import { usePullRequest } from './hooks/use-pull-request.jsx';
import { useSiteMail } from './hooks/use-site-mail.jsx';
import { useSiteLogs } from './hooks/use-site-logs.jsx';
import { useSiteTerminal, TERMINAL_FONT } from './hooks/use-site-terminal.jsx';
import { useSiteScripts } from './hooks/use-site-scripts.jsx';
import { useBuildWatch } from './hooks/use-build-watch.jsx';
import { useDevServer } from './hooks/use-dev-server.jsx';
import { useTrunkUpdate } from './hooks/use-trunk-update.jsx';
import { ConfirmationContext, useConfirmation } from './hooks/use-confirmation.jsx';

// Shared by every log pane so the tabs cannot drift apart visually. The line
// height is looser than xterm's: this is wrapped text in a div, not painted rows.
const LOG_PANE_STYLE = { ...TERMINAL_FONT, lineHeight: 1.4, whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 12, borderRadius: 6, height: 220, overflow: 'auto' };
// The build-watch status dot, by state (#247). Keyed rather than nested
// ternaries; an unknown state falls back to the grey "stopped" colour.
const WATCH_DOT_COLORS = { watching: '#00a32a', building: '#dba617', paused: '#dba617', exited: '#d63638' };
// The applied banner's colours by tone (#509): green for a built site, amber
// while the watch rebuilds it, red when the rebuild was cut short.
const APPLIED_BANNER_COLORS = {
  ready: { border: '#94d3ae', background: '#f4fbf4', text: '#0f5132' },
  building: { border: '#dba617', background: '#fcf9e8', text: '#6e5406' },
  unbuilt: { border: '#d63638', background: '#fcf0f1', text: '#8a1f21' }
};
// What the Copy button says about the press just made. Keyed rather than
// nested ternaries, so a fourth state is a line here instead of another branch
// in the middle of the JSX.
const COPY_BUTTON_LABELS = {
  idle: 'Copy',
  copied: 'Copied',
  failed: 'Could not copy'
};

// Per-status wording for the update chain card (#94), following the issue's
// mockups: the skipped install step is named, never hidden, and the build
// step points at the Terminal instead of opening a second log surface.
// Checkmark/pointer and color per step status; pending/skipped fall back to
// no symbol in muted gray.
const UPDATE_STEP_MARKS = {
  complete: { symbol: '✓', color: '#0f5132' },
  current: { symbol: '›', color: '#0b5d95' }
};
// The file manager has a name on the two platforms that have one; everywhere
// else it is whatever the desktop provides, so it is called what it is.
//
// Two forms, because it appears in two places: an instruction in a list of
// commands ("Show in Finder"), and an application named alongside the editors in
// the "Open directory in" menu, where every other row is a bare name.
const FILE_MANAGER_LABELS = { darwin: 'Show in Finder', win32: 'Show in Explorer' };
const FILE_MANAGER_NAMES = { darwin: 'Finder', win32: 'File Explorer' };
// Why the ticket's PR list could not be read, worded for the contributor.
const TICKET_PATCH_STATUS_MESSAGE = {
  'rate-limited': 'GitHub is rate-limiting this connection.',
  offline: 'Could not reach GitHub.',
  error: 'Could not read the pull requests from GitHub.'
};

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSite, setActiveSite] = useState(null);
  const [deletingSites, setDeletingSites] = useState([]);
  // State paints the progress, while the ref closes the same-tick gap before
  // React renders it and prevents two delete requests for one site.
  const deletingSitesRef = useRef(new Set());
  const [createModalOpen, setCreateModalOpen] = useState(false);
  // The one message under the create-site form: the dialog's complaint about
  // a missing answer, or why the setup it started failed. Held here because
  // the second is written here, possibly after the dialog has closed.
  const [createSiteError, setCreateSiteError] = useState('');
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
    setCreateSiteError('');
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
      setCreateSiteError('');
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
      setCreateSiteError(String(e));
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
  }, [addPendingSite, appendSetupLog, applySetup, clearPendingSites, moveSetupLog, refresh]);

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

  const onRename = useCallback(async (sitePath, newLabel) => {
    try {
      await window.api.setSiteLabel(sitePath, newLabel);
      setSiteMeta((meta) => ({
        ...(meta || {}),
        [sitePath]: { ...(meta?.[sitePath] || {}), label: newLabel }
      }));
    } catch (err) {
      // Pre-existing UX convention in this file; replacing every alert()/confirm()
      // with an in-app notice is a separate, larger UX change than a lint cleanup should make.
      // eslint-disable-next-line no-alert
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
    <ConfirmationContext.Provider value={confirm}>
    <div style={{ display: 'flex', height: '100vh', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>
      <div style={{ width: sidebarCollapsed ? 56 : 280, background: '#1f1f1f', color: '#f7f7f7', display: 'flex', flexDirection: 'column', transition: 'width 0.2s ease', borderRight: '1px solid #2b2b2b' }}>
        <div style={{ padding: sidebarCollapsed ? '12px 8px' : '16px', borderBottom: '1px solid #2b2b2b' }}>
          <Flex align="center" justify="space-between">
            {!sidebarCollapsed ? (<div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{__('Contributor Toolkit')}</div>) : null}
            <Button
              icon={sidebarCollapsed ? chevronRight : chevronLeft}
              onClick={() => setSidebarCollapsed((v) => !v)}
              variant="tertiary"
              aria-label={sidebarCollapsed ? __('Expand site list') : __('Collapse site list')}
              isSmall
              style={{ color: '#f7f7f7' }}
            >
              {!sidebarCollapsed ? __('Collapse') : null}
            </Button>
          </Flex>
          <Dropdown
            popoverProps={{
              placement: sidebarCollapsed ? 'right-start' : 'bottom-start',
              offset: 8
            }}
            renderToggle={({ isOpen, onToggle }) => (
              <Button
                variant="secondary"
                onClick={onToggle}
                aria-expanded={isOpen}
                aria-haspopup="dialog"
                aria-label={__('Share feedback')}
                icon={comment}
                isSmall
                style={{
                  width: '100%',
                  justifyContent: 'center',
                  marginTop: 12,
                  background: '#e8e8e8',
                  color: '#1e1e1e',
                  borderColor: '#e8e8e8',
                  padding: sidebarCollapsed ? '10px 0' : '10px 12px',
                  borderRadius: 0
                }}
              >
                {!sidebarCollapsed ? __('Share feedback') : null}
              </Button>
            )}
            renderContent={({ onClose }) => (
              <div style={{ width: 320, padding: 16, color: '#1d2327' }}>
                <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{__('Share feedback')}</div>
                <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>{__('Your feedback helps decide what to build next.')}</p>
                <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>{__('Responses go into a shared form the team reviews regularly. Submissions are anonymous unless you add your email.')}</p>
                <Button
                  variant="link"
                  onClick={() => {
                    onClose();
                    window.api.openExternal(FEEDBACK_FORM_URL);
                  }}
                  style={{ padding: 0, height: 'auto' }}
                >
                  {__('Open the feedback form ↗')}
                </Button>
              </div>
            )}
          />
        </div>
        <div style={{ flex: 1, overflowY: 'auto', padding: sidebarCollapsed ? '12px 8px' : '12px 16px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {sortedSites.length === 0 && !sidebarCollapsed ? (
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)' }}>{__('No sites yet.')}</div>
          ) : null}
          {sortedSites.map((sitePath) => {
            const meta = siteMeta?.[sitePath] || {};
            const siteName = (meta.label && meta.label.trim()) || pathBasename(sitePath);
            // Every row says which project its site is (#251), so a list
            // of mixed sites reads at a glance.
            const projectTag = getProjectType(meta.projectType).tag;
            const isActive = activeSite === sitePath;
            const isDeleting = deletingSites.includes(sitePath);
            let siteButtonMinHeight = 40;
            if (sidebarCollapsed) siteButtonMinHeight = 36;
            else if (isDeleting) siteButtonMinHeight = 58;
            // Staleness surfaces in the sidebar before the site is even
            // opened (#94): amber = old trunk snapshot, red = an update that
            // moved trunk but never finished install/build.
            const trunkAge = trunkAgeInfo({ trunkDate: meta.trunkDate });
            let staleDotColor = null;
            if (meta.updateIncomplete) staleDotColor = '#d63638';
            else if (trunkAge.stale) staleDotColor = '#dba617';
            const staleDotTitle = meta.updateIncomplete
              ? 'Update incomplete — code is new, built assets are old'
              : `WordPress code is ${trunkAge.ageDays} days old — update to latest trunk`;
            const staleDot = staleDotColor ? (
              <span
                title={staleDotTitle}
                style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: staleDotColor, flexShrink: 0 }}
              />
            ) : null;
            return (
              <Button
                key={sitePath}
                onClick={() => handleSelectSite(sitePath)}
                aria-busy={isDeleting}
                aria-label={isDeleting ? `${siteName}, Deleting` : undefined}
                disabled={isDeleting}
                accessibleWhenDisabled={isDeleting}
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
                  height: 'auto',
                  minHeight: siteButtonMinHeight,
                  opacity: 1,
                }}
              >
                {sidebarCollapsed && !isDeleting ? (
                  <span style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}>{siteName.slice(0, 1).toUpperCase()}{staleDot}</span>
                ) : null}
                {sidebarCollapsed && isDeleting ? <Spinner style={{ width: 16, height: 16, margin: 0 }} /> : null}
                {!sidebarCollapsed ? (
                  <div style={{ width: '100%', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <div style={{ minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
                      <span style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6 }}>{siteName}{staleDot}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 999, background: 'rgba(255,255,255,0.14)', color: 'rgba(255,255,255,0.85)' }}>{projectTag}</span>
                      {isDeleting ? <span style={{ fontSize: 11, lineHeight: 1.3, color: 'rgba(255,255,255,0.72)' }}>Deleting site…</span> : null}
                    </div>
                    {isDeleting ? <Spinner style={{ width: 16, height: 16, margin: 0, flexShrink: 0 }} /> : null}
                  </div>
                ) : null}
              </Button>
            );
          })}
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
            disabled={createSubmitting}
            style={{ width: '100%', justifyContent: 'center' }}
            aria-label={__('Create a site')}
            label={createSubmitting ? __('Finish creating the current site first') : undefined}
          >
            {!sidebarCollapsed ? __('Create a site') : null}
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
                      {webStarting ? 'Starting…' : null}
                      {!webStarting && webUrl ? (
                        <a href={webUrl} onClick={(e)=>{ e.preventDefault(); window.api.openExternal(webUrl); }}>{webUrl}</a>
                      ) : null}
                      {!webStarting && !webUrl ? 'Stopped' : null}
                    </div>
                  </div>
                  {webError ? (<div style={{ marginTop:6, color:'#C00', fontSize:12 }}>{webError}</div>) : null}
                  <div ref={webLogRef} style={{ ...LOG_PANE_STYLE, marginTop:8, padding:8, height:140 }}><LogText text={webLogs} /></div>
                </CardBody>
              </Card>
            ) : null}

            <div id="sites">
              {pendingSites.length > 0 && (
                <Card style={{ marginBottom: 24 }}>
                  <CardBody>
                    <div style={{ fontWeight: 600 }}>Setting up new site…</div>
                    {downloadPhase && <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>{downloadPhase}</div>}
                    <div ref={termRef} style={{ whiteSpace: 'pre-wrap', background: '#111', color: '#eee', padding: 8, borderRadius: 6, height: 140, overflow: 'auto' }}>{terminalMsgs}</div>
                  </CardBody>
                </Card>
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
                  <div role="status" style={{ marginBottom: 24, padding: '12px 14px', background: '#f0f6fc', border: '1px solid #72aee6', borderRadius: 8, color: '#1d2327' }}>
                    <div style={{ fontWeight: 600 }}>{notice.title}</div>
                    <div style={{ marginTop: 4, fontSize: 13 }}>{notice.body}</div>
                    <div style={{ marginTop: 8 }}>
                      <Button variant="link" onClick={clearDeepLink} style={{ fontSize: 12 }}>Dismiss</Button>
                    </div>
                  </div>
                );
              })()}

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
                    />
                  </div>
                ))
              ) : (
                <Card>
                  <CardBody>
                    <div style={{ marginBottom: 8 }}>{__('No sites yet.')}</div>
                    <div>{__('Use the sidebar to create your first site.')}</div>
                  </CardBody>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
      {createModalOpen ? (
        <CreateSiteModal submitting={createSubmitting} error={createSiteError} onError={setCreateSiteError} onCreate={startSiteSetup} onClose={closeCreateModal} />
      ) : null}
    </div>
    {/* One toast region for the window (#253). Anchored top-right and sized to
        its content so it never covers the rest of the UI; SnackbarList announces
        each message via aria-live. The z-index clears the modal overlay
        (components-modal__screen-overlay is 100000, and a modal is a later body
        portal that would otherwise win the tie) so a confirmation for an action
        taken inside a modal — saving a patch, opening a PR — is still seen. It
        stays below popovers/dropdowns (1000000), which should sit over it. */}
    <div style={{ position: 'fixed', right: 24, top: 24, zIndex: 100001, pointerEvents: 'none' }}>
      <SnackbarList
        className="toolkit-snackbars"
        // The icon and the tone class are added here, at render, rather than in
        // the reducer — an icon is a React element and the tone class is styling,
        // neither of which belongs in the DOM-free confirmations module.
        notices={confirmations.notices.map((n) => ({
          ...n,
          // Wrapped in <Icon> so it renders at a set size with the tone colour;
          // Snackbar drops the raw icon element straight into the DOM, where the
          // bare @wordpress/icons export has no dimensions of its own.
          icon: n.tone === 'error' ? undefined : <Icon icon={checkIcon} size={20} />,
          className: n.tone === 'error' ? 'toolkit-toast toolkit-toast--error' : 'toolkit-toast toolkit-toast--success'
        }))}
        onRemove={removeConfirmation}
      />
    </div>
    </ConfirmationContext.Provider>
  );
}

function SiteRow({ sitePath, initialized, createdAt, label, projectType = null, onInitialized, onSiteMetaPatch, onDelete, onRename, onCreateSite, editor, wporg, isPending = false, isDeleting = false, setupLogs = '', isActive = false, switchProgress = null, carriedWork = null, onClearSwitchNotices = null, deepLink = null, onDeepLinkDone = null }) {
  // The window's confirmation queue (#253): confirm(message) after an action
  // completes, so the outcome is announced rather than left silent or buried in
  // the terminal.
  const confirm = useConfirmation();
  // Kept in a ref so loadStatus's dependency list stays [sitePath] — a
  // recreated callback prop must not retrigger the status-loading effect.
  const metaPatchRef = useRef(onSiteMetaPatch);
  useEffect(() => { metaPatchRef.current = onSiteMetaPatch; }, [onSiteMetaPatch]);
  // What this site's processes have said (#554): the text of the Logs panel's
  // panes, which tab is open and the debug.log tail. Whoever runs a process
  // appends to its pane, so the functions those callbacks call are taken out
  // by name; each keeps its identity, which their dependency lists rely on.
  const logs = useSiteLogs({ sitePath });
  const { appendNpm, appendRuntime, appendWatch, ensureStick, selectTab: selectLogTab, startDebugTail, stopDebugTail } = logs;
  // The watch decision a saved-work restore made in begin, for its complete.
  const switchImpactRef = useRef(null);
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
  const [hasNodeModules, setHasNodeModules] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
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
  const [skipInit, setSkipInit] = useState(false);
  const [statusLoading, setStatusLoading] = useState(true);
  // Trac ticket association (#109)
  const [tracTicket, setTracTicket] = useState(null);
  const [ticketBehindTrunk, setTicketBehindTrunk] = useState(false);
  // A site the old engine made (#385): read, never written.
  const [legacy, setLegacy] = useState(false);
  // A merge started outside the app and not finished (#352): read, and
  // every checkout write refused until a terminal ends it.
  const [mergeInProgress, setMergeInProgress] = useState(null);
  const [ticketInput, setTicketInput] = useState('');
  const [ticketError, setTicketError] = useState('');
  const [ticketSaving, setTicketSaving] = useState(false);
  // The site's ticket branches (#108): what branches:list reported, so the
  // panel can offer the tickets that already have work here.
  const [ticketBranches, setTicketBranches] = useState({ current: null, branches: [] });
  const [deletingBranch, setDeletingBranch] = useState(null);
  // The ticket a switch was refused for because trunk had loose edits, and
  // where those edits were saved if the contributor chose to keep them.
  const [blockedByTrunkWork, setBlockedByTrunkWork] = useState(null);
  // Where the edits went when "save them as a patch, then start clean" ran
  // to completion (#234) — the panel that showed the path is gone by then.
  const [patchSavedNotice, setPatchSavedNotice] = useState('');
  // How many loose files rode along into a ticket that had no branch yet, so
  // the panel can say where they went instead of moving them in silence.
  const [patchSavedTo, setPatchSavedTo] = useState('');
  // Patches on the linked ticket (#11): { status, items, cachedAt } or null.
  const [ticketPatches, setTicketPatches] = useState(null);
  const [ticketPatchesLoading, setTicketPatchesLoading] = useState(false);
  const [fetchingPr, setFetchingPr] = useState(null);
  // Trac attachments (#11): loaded on demand, since opening a real Trac window
  // can surface the proof-of-work challenge. null until the user asks.
  const [tracAttachments, setTracAttachments] = useState(null);
  const [tracAttachmentsLoading, setTracAttachmentsLoading] = useState(false);
  const [fetchingAttachment, setFetchingAttachment] = useState(null);
  // What the site's status says about its trunk (#94): the date of the commit
  // it is on, and whether an update was left incomplete. The update itself is
  // useTrunkUpdate, below.
  const [trunkDate, setTrunkDate] = useState(null);
  const [updateIncomplete, setUpdateIncomplete] = useState(false);
  // Initial setup chain (#246): install then build, started by the clone
  // finishing rather than by a click. Same shape as the two chains below.
  const [setupChainState, setSetupChainState] = useState('idle'); // idle | installing | building
  // How the last chain ended, or null while one is running or none has run.
  const [setupChainEnd, setSetupChainEnd] = useState(null);
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
  // Where "try another patch" goes. The list is already on screen when a patch
  // fails — three rows above, in the case that prompted this — so the way out
  // is a scroll, not a fetch.
  const ticketPatchesRef = useRef(null);
  // A dirty-trunk question is rendered before the PR switch function is
  // declared below. Its continuation uses this current-render ref so clearing
  // the trunk can retry the PR operation instead of routing `pr/N` through the
  // ticket parser (#458).
  const retryPrSwitchRef = useRef(null);
  const ticketSwitchLifecycleRef = useRef(null);
  // Not every unhappy ending is a failure: a revert can find that the patch is
  // already gone, which resolves the situation rather than blocking it. Red
  // would read as "you broke something" when nothing is left to do.
  const [applyNotice, setApplyNotice] = useState('');
  const [appliedPatch, setAppliedPatch] = useState(null);
  const [pullRequest, setPullRequest] = useState(null);
  const [prUrlInput, setPrUrlInput] = useState('');
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
      // eslint-disable-next-line no-alert -- see the note above onRename.
      alert('Unable to copy path: ' + (err?.message ?? String(err)));
    }
  }, [sitePath]);

  // --- opening the directory ------------------------------------------------
  //
  // One menu, one intention: open this folder, in that. The application is the
  // argument to the action rather than a setting configured first, so there is
  // nothing remembered, nothing to change later, and no first-run picker.
  //
  // What the menu offers is what detection found (see editor-launch.js — a
  // convenience, not a claim about what is installed) plus the file manager and
  // "Other application…", which is what covers everything the table misses. No
  // entry is ever drawn disabled: an application this app cannot find is not one
  // it refuses to use, and the copy button above is the floor under all of it.
  const { detected: detectedEditors, loading: detectingEditors, loadDetected } = editor;
  // `{ message, offerPicker }` from open-failure.cjs, or null for nothing to
  // say. Both what it reads and whether "Choose application…" is a way out of
  // it are decided there, per reason — the two callers below deciding that
  // separately is what #180 was.
  const [editorNotice, setEditorNotice] = useState(null);

  const fileManagerLabel = FILE_MANAGER_LABELS[window.api?.platform] || 'Show in file manager';
  const fileManagerName = FILE_MANAGER_NAMES[window.api?.platform] || 'File manager';

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

  const loadStatus = useCallback(async ()=>{
    try {
      setStatusLoading(true);
      const s = await window.api.getSiteStatus(sitePath);
      setHasNodeModules(Boolean(s?.hasNodeModules));
      setInstallFailed(Boolean(s?.installFailed));
      setHasBuilt(Boolean(s?.hasBuilt));
      setSkipInit(Boolean(s?.skipInitWizard));
      setTrunkDate(s?.trunkDate || null);
      setUpdateIncomplete(Boolean(s?.updateIncomplete));
      setTracTicket(s?.tracTicket || null);
      setTicketBehindTrunk(Boolean(s?.ticketBehindTrunk));
      setLegacy(Boolean(s?.legacy));
      setMergeInProgress(s?.mergeInProgress || null);
      setAppliedPatch(s?.appliedPatch || null);
      setPullRequest(s?.pullRequest || null);
      if (metaPatchRef.current) {
        // A null trunkDate here means the git read failed (e.g. clone still
        // running) — keep whatever the sidebar already shows in that case.
        const patch = { updateIncomplete: Boolean(s?.updateIncomplete), tracTicket: s?.tracTicket || null };
        if (s?.trunkDate) patch.trunkDate = s.trunkDate;
        metaPatchRef.current(sitePath, patch);
      }
      // Returned as well as stored: the setup chain (#246) re-probes when the
      // clone finishes and has to decide from that read, not from state React
      // has not committed yet.
      return s;
    } catch {}
    finally { setStatusLoading(false); }
    return null;
  }, [sitePath]);
  useEffect(()=>{ loadStatus(); }, [loadStatus]);

  // Deliberately not part of loadStatus: that one is called after every long
  // operation, and the branch list only changes when a ticket is linked,
  // resumed or deleted — the three paths that call this themselves.
  const loadBranches = useCallback(async () => {
    try {
      const res = await window.api.listBranches(sitePath);
      if (res?.ok) setTicketBranches({ current: res.current, branches: res.branches || [] });
    } catch {}
  }, [sitePath]);
  useEffect(()=>{ loadBranches(); }, [loadBranches]);

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
  const applyDiscardToNote = (outcome) => {
    dirtyProbeRef.current.generation++;
    setWorktreeDirty(noteAfterDiscard(outcome));
  };
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

  // Linking and unlinking are the same write (#109): an empty ref clears the
  // association, so Unlink needs no second channel. Resuming a ticket that
  // already has a branch is also this write (#108) — main switches to the
  // existing branch instead of creating one, with the same parking rules.
  const saveTicket = useCallback(async (ref, options = undefined) => {
    setTicketSaving(true);
    setTicketError('');
    setBlockedByTrunkWork(null);
    setPatchSavedNotice('');
    // The previous switch's last sentence must not be this one's first frame.
    if (onClearSwitchNotices) onClearSwitchNotices(sitePath);
    let rebuilding = false;
    let ownsTerminal = false;
    try {
      ownsTerminal = await ticketSwitchLifecycleRef.current.begin(ref);
      if (!ownsTerminal) return;
      const res = await window.api.setSiteTicket(sitePath, ref, options);
      if (!res?.ok) {
        // `dirty-trunk` is a question, not a failure (#234): main refuses it
        // on both paths — a new ticket that would carry the edits, a known
        // one that cannot — and the panel asks what happens to them. A red
        // error line over a set of choices would read as a fault, so the
        // message is kept for real failures only. `canCarry` is main's word
        // on whether the edits can ride into this ticket, and the count
        // arrives only on the path that scanned before refusing. Only that
        // path names the ticket too, so the other one reads it back off the
        // ref the switch was asked for, rather than saying "the ticket" to
        // someone who typed a number (#409).
        if (res?.code === 'dirty-trunk') {
          const parsedRef = workItem.parseRef(String(ref));
          setBlockedByTrunkWork({
            ref: String(ref),
            canCarry: Boolean(res.canCarry),
            files: typeof res.files === 'number' ? res.files : null,
            ticket: res.ticket || (parsedRef.ok ? parsedRef.id : null)
          });
        } else {
          setTicketError(res?.error || 'Could not save the ticket.');
        }
        return;
      }
      // The status belongs to the branch we just left. Clear it in the same
      // render that names the new ticket; loadStatus will restore the new
      // branch's answer below (#305).
      setTicketBehindTrunk(false);
      setTracTicket(res.ticket);
      if (res.ticket) autoReadTicketRef.current = res.ticket;
      setTicketInput('');
      setPatchSavedTo('');
      if (metaPatchRef.current) metaPatchRef.current(sitePath, { tracTicket: res.ticket });
      // Both, and awaited: the branch list decides which rows show, and
      // appliedPatch/updateIncomplete are per-branch (#108) — without the
      // status reload, switching tickets would keep showing the other
      // ticket's "patch applied · Revert" banner over this branch's tree.
      await Promise.all([loadBranches(), loadStatus()]);
      // The tree under the note is a different branch's now (#239).
      reprobeAfterBranchChange();
      rebuilding = await ticketSwitchLifecycleRef.current.complete(res);
    } catch (e) {
      setTicketError(String(e));
    } finally {
      if (ownsTerminal && !rebuilding) ticketSwitchLifecycleRef.current.finish();
      setTicketSaving(false);
    }
  }, [sitePath, workItem, loadBranches, loadStatus, onClearSwitchNotices, reprobeAfterBranchChange]);
  const linkTicket = useCallback(() => saveTicket(ticketInput), [saveTicket, ticketInput]);
  const unlinkTicket = useCallback(() => saveTicket(''), [saveTicket]);

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

  // The notice's own button (#385): the ticket's work replayed onto the
  // current trunk in main. Same busy flag and progress line as a switch,
  // because it parks and checks out the same way; a refusal is worded by the
  // notice module and lands where the ticket's other refusals do.
  const rebaseTicket = useCallback(async () => {
    setTicketSaving(true);
    setTicketError('');
    if (onClearSwitchNotices) onClearSwitchNotices(sitePath);
    try {
      const res = await window.api.rebaseBranch(sitePath);
      if (!res?.ok) {
        setTicketError(rebaseRefusal({ ...res, ticketId: tracTicket, noun: workItem.noun }));
        return;
      }
      setTicketBehindTrunk(false);
      await Promise.all([loadBranches(), loadStatus()]);
      reprobeAfterBranchChange();
    } catch (e) {
      setTicketError(String(e));
    } finally {
      setTicketSaving(false);
    }
  }, [sitePath, tracTicket, workItem, loadBranches, loadStatus, onClearSwitchNotices, reprobeAfterBranchChange]);

  const discardTrunkWorkAndSwitch = useCallback(async (target) => {
    setTicketSaving(true);
    setTicketError('');
    // The refused attempt left its last frame behind — without this, the
    // discard runs under a spinner describing a switch that never happened.
    if (onClearSwitchNotices) onClearSwitchNotices(sitePath);
    try {
      const res = await window.api.discardChanges(sitePath);
      if (!res?.ok) {
        setTicketError(res?.error || 'Could not discard the changes.');
        return;
      }
      setPatchSavedTo('');
      setBlockedByTrunkWork(null);
      // The switch below re-walks the tree, so on the happy path this is
      // redundant — but a switch that fails returns without reprobing, and
      // the note would go on offering to discard trunk work that is already
      // gone (#239).
      applyDiscardToNote(discardOutcome(res));
    } catch (e) {
      setTicketError(String(e));
      return;
    } finally {
      setTicketSaving(false);
    }
    // Outside the guard above: the destination operation owns its own busy
    // state, and the discard has already succeeded — a failure here is about
    // that checkout. PR refs never go through the ticket parser.
    if (target.kind === 'pr') await retryPrSwitchRef.current?.();
    else await saveTicket(target.ref);
  }, [sitePath, saveTicket, onClearSwitchNotices]);

  // "Save them as a patch, then start clean" — one chosen outcome, not two
  // steps the contributor has to sequence themselves (#234). The discard only
  // runs once the save dialog has really produced a file: cancelling the
  // dialog cancels the whole option, and a failed save leaves the edits in
  // the working tree with the question still open. The busy flag is held
  // while the dialog is up because it is not window-modal — without it the
  // panel underneath keeps taking clicks, and a discard chosen there would
  // run again when the dialog finally answers.
  const saveTrunkWorkThenStartClean = useCallback(async (target) => {
    setTicketError('');
    let savedTo = '';
    setTicketSaving(true);
    try {
      const res = await window.api.savePatch(sitePath);
      if (res?.canceled) return;
      if (!res?.ok) {
        setTicketError(res?.error || 'Could not save the patch.');
        return;
      }
      savedTo = res.filePath || '';
      setPatchSavedTo(savedTo);
    } catch (e) {
      setTicketError(String(e));
      return;
    } finally {
      setTicketSaving(false);
    }
    await discardTrunkWorkAndSwitch(target);
    // After the panel is gone, the only on-screen record of where the work
    // went. The switch clears `patchSavedTo` with the rest of the panel
    // state, so the sentence that survives is its own notice — same shape as
    // carriedNotice, and true even if the switch itself failed: by now the
    // patch is written and the tree is clean.
    setPatchSavedNotice(savedTo);
  }, [sitePath, discardTrunkWorkAndSwitch]);

  // "Delete this ticket's work" (#108) — destroys the branch, which is why it
  // sits behind a confirm while switching does not.
  const deleteTicketWork = useCallback(async (ref) => {
    setDeletingBranch(ref);
    setTicketError('');
    try {
      const res = await window.api.deleteBranch(sitePath, ref);
      if (!res?.ok) {
        setTicketError(res?.error || 'Could not delete the branch.');
        return;
      }
      await loadBranches();
      // 'trunk' is the literal main returns (TRUNK in ticket-branches.js,
      // which the renderer cannot import — it pulls in fs). It means the site
      // now sits on trunk: usually because the delete was made from there,
      // but also when the deleted branch was somehow the active one — main
      // then cleared the ticket, and the status reload re-syncs the panel and
      // the sidebar to that.
      if (res.current === 'trunk') await loadStatus();
      // Only a delete that took the checkout with it changed what the note is
      // measuring against (#239): deleting a ticket you are not on — including
      // from trunk, where `current` says trunk either way — leaves the tree
      // alone, and re-walking it would blank the sentence and rebuild the
      // identical one. After loadStatus, so a fast walk cannot render trunk's
      // count under the ticket number the delete just cleared.
      if (res.movedToTrunk) reprobeAfterBranchChange();
    } catch (e) {
      setTicketError(String(e));
    } finally {
      setDeletingBranch(null);
    }
  }, [sitePath, loadBranches, loadStatus, reprobeAfterBranchChange]);

  // The npm runs this view starts (#554): the install and the scripts, and the
  // flags the rest of the view reads about them. Called here because it needs
  // `loadStatus` above; the terminal and the build watch below run through it.
  const { installing, building, buildFailed, buildInterrupted, buildInterruptedRef, markBuildInterrupted, currentRunIdRef, runInstall, runScript, killCurrent } = useSiteScripts({ sitePath, appendNpm, ensureStick, loadStatus, onInitialized });

  // The site's terminal (#554): the xterm instance, what is typed in it and
  // the commands it runs through the three runners above. The lock, the kill
  // handler and the writer are taken out by name because every chain below
  // holds the lock and writes its progress there, as it always has.
  const { terminalContainerRef, terminalStateRef, terminalKillRef, terminalRunning, markTerminalRunning, writeToTerminal, prefillTerminalCommand } = useSiteTerminal({ allowedScripts: projectBuild.allowedScripts, runInstall, runScript, killCurrent });
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
  const { watchState, watchExitCode, watchCompiling, watchStateRef, watchWaitersRef, applyHandOffRef, handOffToWatch, startBuildWatch, pauseWatcher, resumeWatcher, toggleWatch } = useBuildWatch({ sitePath, projectBuild, hasBuilt, runScript, killCurrent, markBuildInterrupted, appendWatch, selectLogTab, terminalStateRef, terminalKillRef, markTerminalRunning });
  // The count is on the tab rather than beside it because the tab is what the
  // contributor is not looking at: a notice landing while they read the server
  // output is the case this panel exists for.
  const logTabs = useMemo(() => ([
    { name: 'runtime', title: 'Server' },
    { name: 'watch', title: watchTabLabel(watchState, watchExitCode, watchCompiling) },
    { name: 'debug', title: logs.debugUnread ? `debug.log (${logs.debugUnread})` : 'debug.log' }
  ]), [logs.debugUnread, watchState, watchExitCode, watchCompiling]);

  // The dev server (#554): its state, its guards and its one button. It is
  // called here because starting it needs everything above: the build watch,
  // the logs, the mail, the terminal's lock and the script runner.
  const { serverUrl, starting, running, isServerStarting, isDevProcessActive, devServerButtonLabel, startElapsed, toggleDevServer } = useDevServer({ sitePath, projectBuild, hasBuilt, setHasBuilt, skipInit, appendRuntime, ensureStick, startDebugTail, stopDebugTail, listenForMail, stopListeningForMail, loadMail, startBuildWatch, watchStateRef, buildInterruptedRef, currentRunIdRef, terminalKillRef, markTerminalRunning });
  // The build watch has its own control and status dot beside the server's — it
  // runs independently of the server (#247). Green watching, amber building or
  // paused, red an unexpected exit, grey stopped.
  const watchActive = watchState === 'watching' || watchState === 'building';
  const watchDotColor = WATCH_DOT_COLORS[watchState] || '#8c8f94';
  const watchButtonLabel = watchActive ? 'Stop build watch' : 'Start build watch';
  const markSkipWizard = useCallback(async () => {
    await window.api.setSkipInitWizard(sitePath, true);
    setSkipInit(true);
  }, [sitePath]);
  // eslint-disable-next-line no-alert -- see the note above onRename.
  const confirmAnd = async (m,a)=>{ if(window.confirm(m)) await a(); };

  // Updating to the latest trunk (#94, #554): the chain, the question it asks
  // about edits in the tree, and the retry. Called here because it runs
  // through everything above, and because what follows reads whether an
  // update is under way.
  const { updateState, isUpdating, updateWaitingOnWatch, updateSteps, updateStepStates, lastUpdateSummary, setLastUpdateSummary, dirtyModalOpen, setDirtyModalOpen, dirtySaving, dirtyFiles, dirtyError, startTrunkUpdate, dirtySaveAndUpdate, dirtyDiscardAndUpdate, retryInstallAndBuild } = useTrunkUpdate({ sitePath, confirm, confirmAnd, installing, building, runInstall, runScript, killCurrent, terminalStateRef, terminalKillRef, markTerminalRunning, writeToTerminal, watchStateRef, watchWaitersRef, pauseWatcher, resumeWatcher, watchRebuildsOnStart, loadStatus, refreshDirty, applyDiscardToNote });

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
  const ticketsCard = ticketListCard({ rowCount: branchRows.length, linked: Boolean(tracTicket), noun: workItem.noun });
  // What the switch is doing, while it does it (#173). Gated on the busy flag
  // rather than merely cleared by it: the last sends can land after the invoke
  // has already answered, which would flash a sentence under an idle panel.
  // Where loose work went, said once and plainly (#108). Carrying uncommitted
  // edits into a new ticket is now something the contributor chooses in the
  // panel below (#234), so this confirms an answered question rather than
  // announcing a move the app made on its own.
  const carriedNotice = carriedWork ? (
    <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0f6fc', border: '1px solid #c5d9ed', borderRadius: 6, color: '#1d2327', fontSize: 12 }}>
      Your {carriedWork.files} uncommitted {carriedWork.files === 1 ? 'change' : 'changes'} came along into #{carriedWork.ticket}, and will go into its patch.
    </div>
  ) : null;

  // The counterpart for the other answer to the same question: the edits were
  // saved and the ticket started clean. Rendered wherever the panel that
  // asked could have been, because that panel — and the path it showed — is
  // gone once the switch completes.
  const savedCleanNotice = patchSavedNotice ? (
    <div style={{ marginTop: 8, padding: '8px 12px', background: '#f0f6fc', border: '1px solid #c5d9ed', borderRadius: 6, color: '#1d2327', fontSize: 12 }}>
      Your edits were saved to {patchSavedNotice} and are no longer in the working tree.
    </div>
  ) : null;

  const switchProgressLine = ticketSaving && switchProgress ? (
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, color: '#3c434a', fontSize: 12 }}>
      <Spinner />
      <span>{describeSwitchProgress(switchProgress)}</span>
    </div>
  ) : null;
  // One gate for every ticket action, and the sentence that goes with it
  // (#409): a control this disables says why, through ReasonedButton.
  const ticketActionsReason = ticketActionDisabledReason({ ticketSaving, deletingBranch, updateState, installing, building, applyState, noun: workItem.noun });
  const ticketActionsBlocked = Boolean(ticketActionsReason);

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
    <div style={{ marginTop: 8, padding: '10px 12px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 6, color: '#6e5406', fontSize: 12 }}>
      <div>{dirtyQuestion.question}</div>
      {patchSavedTo ? (
        <div style={{ marginTop: 6, fontWeight: 600 }}>
          Saved to {patchSavedTo}. The edits are still in the working tree.
        </div>
      ) : null}
      <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {dirtyQuestion.carry ? (
          <ReasonedButton
            variant="link"
            isBusy={ticketSaving}
            reason={ticketActionsReason}
            onClick={() => saveTicket(blockedByTrunkWork.ref, { carryTrunkWork: true })}
            style={{ fontSize: 12 }}
          >{dirtyQuestion.carry}</ReasonedButton>
        ) : null}
        <ReasonedButton variant="link" reason={ticketActionsReason} onClick={() => saveTrunkWorkThenStartClean(blockedByTrunkWork)} style={{ fontSize: 12 }}>
          {dirtyQuestion.save}
        </ReasonedButton>
        <ReasonedButton
          variant="link"
          isDestructive
          reason={ticketActionsReason}
          onClick={() => confirmAnd('Discard the uncommitted edits on trunk? This cannot be undone.', () => discardTrunkWorkAndSwitch(blockedByTrunkWork))}
          style={{ fontSize: 12 }}
        >{dirtyQuestion.discard}</ReasonedButton>
        {/* The way out that touches nothing — three consequential actions
            with no fourth door is its own trap (#234). */}
        <ReasonedButton variant="link" reason={ticketActionsReason} onClick={() => { setBlockedByTrunkWork(null); setPatchSavedTo(''); }} style={{ fontSize: 12 }}>
          {dirtyQuestion.cancel}
        </ReasonedButton>
      </div>
    </div>
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
        <div role="alert" style={{ marginTop: 8, color: '#d63638', fontSize: 12 }}>{ticketError}</div>
      ) : null}
      {switchProgressLine}
      {carriedNotice}
      {savedCleanNotice}
      {blockedPanel}
    </>
  );
  const renderBranchRows = (linked) => (
    <div style={{ marginTop: 8, border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
      {branchRows.map((row, i) => (
        <div key={row.ref} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: i < branchRows.length - 1 ? '1px solid #f0f0f1' : 'none' }}>
          <div style={{ flex: '1 1 auto', minWidth: 0 }}>
            <span style={{ fontSize: 13, color: '#1d2327' }}>
              {linked ? <>You also have work on #{row.ticketId}{' — '}</> : null}
              <ReasonedButton variant="link" onClick={() => saveTicket(String(row.ticketId))} reason={ticketActionsReason} style={{ fontSize: 13 }}>
                {linked ? 'switch' : `Continue working on #${row.ticketId}`}
              </ReasonedButton>
            </span>
            {row.timeLabel ? (
              <div style={{ marginTop: 2, fontSize: 11, color: '#6c6f72' }}>{row.timeLabel}</div>
            ) : null}
          </div>
          <ReasonedButton
            variant="link"
            isDestructive
            isBusy={deletingBranch === row.ref}
            reason={ticketActionsReason}
            onClick={() => confirmAnd(`Delete all work on #${row.ticketId} on this site? This cannot be undone.`, () => deleteTicketWork(row.ref))}
            style={{ fontSize: 12, flex: '0 0 auto' }}
          >Delete this {workItem.noun}&apos;s work</ReasonedButton>
        </div>
      ))}
    </div>
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

  // --- Applying someone else's patch (#11) ---
  // Same three-stage shape as the update chain, and the same npm wrappers, so
  // exit codes and terminal streaming behave identically.
  const isApplying = applyState !== 'idle';
  const showTerminalHints = Boolean(hasBuilt);
  const terminalBusy = computeTerminalBusy({
    terminalRunning, installing, building, starting, running, isUpdating, isApplying
  });
  const applySteps = planApplySteps({ needsInstall: applyNeedsInstall, buildByWatcher: applyBuildByWatcher, kind: applyKind });
  const applyStepStates = updateStepStatuses(applySteps, applyState, APPLY_STATE_TO_STEP);

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
  const prBannerColors = prBanner ? (APPLIED_BANNER_COLORS[prBanner.tone] || APPLIED_BANNER_COLORS.ready) : null;
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
    if (outcome === 'done') confirm('This site is ready to work on');
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
  // The panel lists only what can be applied — screenshots and other non-patch
  // attachments are noise here. The parser still returns them (pickLatest and
  // tests rely on the full list); the filtering is purely what's shown.
  const patchAttachments = (tracAttachments?.items || []).filter((a) => a.applyable);
  // The ticket's own facts (#292), riding the same scrape as the attachments:
  // one Trac visit, one challenge, both answers.
  const tracInfo = showTracCards ? (tracAttachments?.ticket || null) : null;
  const tracInfoBadge = statusBadge(tracInfo);
  const tracAttachmentsRead = tracAttachments
    && (tracAttachments.status === 'ok' || tracAttachments.status === 'no-attachments');
  // One pill shape, two uses: the "Latest" marker on a patch row and a linked
  // pull request's state. Only the words and the colours differ.
  const pillStyle = { display: 'inline-flex', alignItems: 'center', flex: '0 0 auto', padding: '1px 7px', borderRadius: 999, fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' };
  const latestPill = (isLatest) => (isLatest ? (
    <span style={{ ...pillStyle, background: '#e7f1ff', color: '#0b5d95', marginLeft: 8 }}>
      Latest
    </span>
  ) : null);
  const prStatePill = (state) => {
    const badge = prStateBadge(state);
    return (
      <span style={{ ...pillStyle, background: badge.background, color: badge.color }}>
        {badge.label}
      </span>
    );
  };

  const finishApply = (message) => {
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
    if (message) writeToTerminal(applyFinishMessage(message, watchStateRef.current));
    loadStatus().catch(() => {});
    refreshDirty();
  };

  const runApplyInstallAndBuild = (needsInstall, verb, { buildBy = null, noun = 'patch' } = {}) => {
    const runBuildStep = () => {
      setApplyState('building');
      writeToTerminal('\nRunning npm run build…\n');
      runScript('build', {
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          // Only now is the apply genuinely done — the patch is on disk and the
          // site is rebuilt around it, so "open the site to try it out" is true
          // (#253). A failed build leaves stale assets and its own banner, so it
          // gets no success confirmation.
          if (code === 0) confirm(`${verb} the ${noun}`);
          finishApply(code === 0
            ? `\n${verb} — open the site to try it out.\n`
            : `\nThe ${noun} is ${verb.toLowerCase()} but the build failed, so the site still runs the old assets.\n`);
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
          confirm(`${verb} the ${noun}`);
          writeToTerminal(handOff.ready);
        },
        () => {
          if (!applyHandOffRef.current.isCurrent(token)) return;
          writeToTerminal(handOff.failed);
        }
      );
      finishApply(`\n${verb} — open the site to try it out.\n`);
    };
    const afterInstall = buildBy === 'resumed-watch' ? handOffToResumedWatch : runBuildStep;
    if (buildBy === 'live-watch') {
      // A running build watch recompiles the src/ change on its own, so there is
      // no install and no build of our own to run — just hand off to it (#262).
      confirm(`${verb} the ${noun}`);
      handOffToWatch();
      finishApply(`\n${verb} — ${compilingMessage()}\n`);
      return;
    }
    if (needsInstall) {
      setApplyState('installing');
      writeToTerminal(`\nThe ${noun} changes package-lock.json — running npm install…\n`);
      runInstall({
        onLog: (chunk) => writeToTerminal(chunk),
        onDone: ({ code }) => {
          if (code !== 0) {
            finishApply(`\nnpm install failed, so the build was skipped. The ${noun} is ${verb.toLowerCase()} but dependencies are stale.\n`);
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
  // Set only by saveTicket, on a link the contributor just performed. The
  // per-ticket effect below consumes it to auto-read the ticket's details:
  // there, after the generation bump, so the scrape's result is not dropped as
  // stale. A ref and not state — it must not survive a remount, or selecting
  // an already-linked site would open a Trac window nobody asked for (#292).
  const autoReadTicketRef = useRef(null);
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
      // metaPatchRef above.
      if (tracScrapeRef.current) tracScrapeRef.current();
    }
  }, [tracTicket, isActive, loadTicketPatches, showTracCards]);

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

  // Downloads an attachment through the challenge-passing session and hands it
  // to the same preview the PR and file paths use.
  useEffect(() => { tracScrapeRef.current = loadTracAttachments; });

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
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
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
      writeToTerminal('A command is already running. Press Ctrl+C to stop it.\n');
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
      setApplyError(String(e));
      finishApply();
    });
  };

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
      confirm('All changes discarded.');
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
      {discardError ? <div style={{ color: '#d63638', fontSize: 12, marginTop: 4 }}>{discardError}</div> : null}
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
        confirm(`Patch saved to ${pathBasename(res.filePath)}`);
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

  const statusStyles = initialized
    ? { background: '#e7f6e7', color: '#0f5132' }
    : { background: '#fff4ce', color: '#8a6d1c' };

  // Colours and indicator per step status. The status *word* is not here — it
  // lives in `setupStepLabel`, the one place that distinguishes a step that is
  // merely next from one that is running (#257).
  const checklistVisuals = {
    complete: {
      color: '#0f5132',
      background: '#f4fbf4',
      border: '#94d3ae',
      indicatorBg: '#0f5132',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '✓'
    },
    current: {
      color: '#0b5d95',
      background: '#e8f3ff',
      border: '#66afe9',
      indicatorBg: '#007cba',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '•'
    },
    failed: {
      color: '#8a1f21',
      background: '#fcf0f1',
      border: '#d63638',
      indicatorBg: '#d63638',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '✕'
    },
    pending: {
      color: '#6c6f72',
      background: '#f8f9f9',
      border: '#dcdcde',
      indicatorBg: '#6c6f72',
      indicatorColor: '#fff',
      indicatorBorder: 'none',
      indicatorContent: '•'
    },
    locked: {
      color: '#6c6f72',
      background: '#f5f5f7',
      border: '#dcdcde',
      indicatorBg: 'transparent',
      indicatorColor: '#6c6f72',
      indicatorBorder: '2px solid #c3c4c7',
      indicatorContent: '–'
    }
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
        <Button
          isBusy={installing}
          variant={stepState.install.done ? 'secondary' : 'primary'}
          onClick={runInstallWithTerminal}
          disabled={stepState.install.disabled}
        >{installLabel}</Button>
      )
    },
    {
      key: 'build',
      label: 'Run full build',
      description: buildDescription,
      ...stepState.build,
      running: building,
      action: (
        <Button
          isBusy={building}
          variant={stepState.build.done ? 'secondary' : 'primary'}
          onClick={runBuildWithTerminal}
          disabled={stepState.build.disabled}
        >{buildLabel}</Button>
      )
    },
    {
      key: 'dev',
      label: 'Start dev server & finish wizard',
      description: project.setup.serverDescription,
      ...stepState.dev,
      running: starting,
      action: (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Button
            isBusy={starting}
            variant={running ? 'secondary' : 'primary'}
            onClick={async () => {
              await markSkipWizard();
              await toggleDevServer();
            }}
            disabled={stepState.dev.disabled}
          >{running ? 'Stop dev server' : 'Start dev server and finish the wizard'}</Button>
          {starting || serverUrl ? (
            <span style={{ fontSize: 12 }}>
              {starting ? `Starting… (${formatElapsed(startElapsed)})` : null}
              {!starting && serverUrl ? (
                <>
                  <a href={serverUrl} onClick={(e) => { e.preventDefault(); window.api.openExternal(serverUrl); }}>{serverUrl}</a>
                  <span aria-hidden="true"> · </span>
                  <a href={adminUrl(serverUrl)} onClick={(e) => { e.preventDefault(); window.api.openExternal(adminUrl(serverUrl)); }}>wp-admin</a>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
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

  return (
    <section ref={nextActionSectionRef} style={{ display: 'flex', flexDirection: 'column', gap: 24, paddingBottom: 48 }}>
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
      <Flex align="flex-start" justify="space-between" style={{ gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 440px', minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h1 style={{ margin: 0, fontSize: 28, lineHeight: 1.2 }}>{displayName}</h1>
            <Button
              icon={pencil}
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
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', padding: '2px 8px', borderRadius: 999, background: '#f0f0f1', color: '#1d2327' }}>{project.tag}</span>
            {createdLabel ? <span>Created {createdLabel}</span> : null}
            {age.known ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                {createdLabel ? <span aria-hidden="true">·</span> : null}
                {age.stale ? (
                  <span
                    aria-hidden="true"
                    title={`Trunk snapshot is ${age.ageDays} days old`}
                    style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#dba617' }}
                  />
                ) : null}
                <span>{age.label}</span>
              </span>
            ) : null}
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
          {/* One control for one intention, directly under the path it acts on.
              Detection runs when the menu is opened rather than on load: it is a
              filesystem sweep, and the answer is only needed once someone asks.
              It is re-read on every open, so an application installed while this
              app is running shows up the next time the menu is used. */}
          <div style={{ marginTop: 4 }}>
            <Dropdown
              popoverProps={{ placement: 'bottom-start', offset: 4 }}
              renderToggle={({ isOpen, onToggle }) => (
                <Button
                  variant="link"
                  aria-expanded={isOpen}
                  aria-haspopup="menu"
                  onClick={() => {
                    if (!isOpen) void loadDetected();
                    onToggle();
                  }}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 12 }}
                >
                  Open directory in
                  <Icon icon={chevronDown} size={18} />
                </Button>
              )}
              renderContent={({ onClose }) => (
                <MenuGroup>
                  <MenuItem onClick={() => { onClose(); void showInFileManager(); }}>
                    {fileManagerName}
                  </MenuItem>
                  {detectedEditors.map((candidate) => (
                    <MenuItem key={candidate.path} onClick={() => { onClose(); void openIn(candidate.path); }}>
                      {candidate.name}
                    </MenuItem>
                  ))}
                  {/* A menu that is still counting is not an empty menu, and the
                      difference has to be visible: without this, a slow sweep
                      looks exactly like a machine with no editors on it. */}
                  {detectingEditors ? (
                    <MenuItem disabled>Looking for applications…</MenuItem>
                  ) : null}
                  {/* Always offered, never only as a fallback: detection is a
                      shortcut, and an application it misses is not one this app
                      refuses to use. */}
                  <MenuItem onClick={() => { onClose(); void openIn(null); }}>
                    Other application…
                  </MenuItem>
                </MenuGroup>
              )}
            />
          </div>
          {/* With no modal in the way, this is the only place a failed open can
              speak — and it carries the way out with it, rather than leaving the
              contributor to find the menu again. */}
          {editorNotice ? (
            <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8, padding: '8px 12px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 6, fontSize: 12, color: '#6e5406' }}>
              <span style={{ flex: '1 1 240px' }}>{editorNotice.message}</span>
              {editorNotice.offerPicker ? (
                <Button variant="tertiary" isSmall onClick={() => void openIn(null)}>Choose application…</Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <DropdownMenu
            label="More"
            text=""
            controls={[
              { title: 'Copy path', onClick: copyPath },
              // Opening the folder lives in the header's "Open directory in"
              // menu, next to the path it acts on. Repeating it here would be two
              // menus answering the same question a few pixels apart.
              { title: fileManagerLabel, onClick: showInFileManager },
              // Also reachable when the site is not yet stale (the staleness
              // notice is the primary entry point) — a fresh site just gets
              // "Already up to date." in the terminal.
              { title: 'Update to latest trunk', onClick: startTrunkUpdate },
              // Not while the clone is running: deleting the site would be
              // removing a directory the app is still writing into. The main
              // process refuses it either way (see site-registry.js) — that is
              // the backstop, and not offering a control that cannot work is
              // the actual answer.
              ...(isPending ? [] : [
                isDeleting
                  ? { title: 'Deleting…', isDisabled: true }
                  : { title:'Delete this site', onClick:()=>confirmAnd('Delete this site from disk? This cannot be undone.', ()=>onDelete(sitePath)) }
              ])
            ]}
          />
        </div>
      </Flex>
      {legacyNotice && !isPending ? (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', background: '#fcf0f1', border: '1px solid #d63638', borderRadius: 8, fontSize: 13, color: '#8a1f21' }}>
          <span style={{ flex: '1 1 320px' }}>
            <strong>{legacyNotice.title}</strong> {legacyNotice.body}
          </span>
          <Button variant="primary" onClick={onCreateSite}>Create site</Button>
        </div>
      ) : null}
      {mergeNotice && !isPending ? (
        <div role="alert" style={{ padding: '12px 16px', background: '#fcf0f1', border: '1px solid #d63638', borderRadius: 8, fontSize: 13, color: '#8a1f21' }}>
          <strong>{mergeNotice.title}</strong> {mergeNotice.body}
        </div>
      ) : null}
      {updateIncomplete && !isUpdating ? (
        <div {...cueProps('retry-install-build')} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '12px 16px', background: '#fcf0f1', border: '1px solid #d63638', borderRadius: 8, fontSize: 13, color: '#8a1f21' }}>
          <span style={{ flex: '1 1 320px' }}>
            <strong>Update incomplete</strong> — the code is new but the built assets are old. The site may not run correctly until install and build succeed.
          </span>
          <Button
            variant="secondary"
            isDestructive
            onClick={retryInstallAndBuild}
            disabled={installing || building}
          >Retry install &amp; build</Button>
        </div>
      ) : null}
      {age.stale && !updateIncomplete && !isUpdating ? (
        <div {...cueProps('update-trunk')} style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', padding: '14px 16px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 8, fontSize: 13, color: '#6e5406' }}>
          <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong style={{ color: '#5c4400' }}>This site&apos;s WordPress code is {age.ageDays} days old</strong>
            <span>Patches you create now may not apply on Trac. Updating takes a few minutes.</span>
          </div>
          <Button
            variant="secondary"
            onClick={startTrunkUpdate}
            disabled={installing || building}
          >Update to latest trunk</Button>
        </div>
      ) : null}
      {isUpdating ? (
        <div {...cueProps('updating')} style={{ padding: '14px 16px', background: '#fff', border: '1px solid #dcdcde', borderRadius: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, fontSize: 14, color: '#1d2327' }}>Updating to latest trunk</span>
            <span style={{ fontSize: 12, color: '#6c6f72' }}>
              step {Math.max(1, updateStepStates.filter((s) => s.status === 'complete' || s.status === 'skipped').length + 1)} of {updateSteps.length}
            </span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
            {updateStepStates.map((s) => {
              const text = updateStepText(updateSteps, s);
              const { symbol = '', color = '#6c6f72' } = UPDATE_STEP_MARKS[s.status] || {};
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'baseline', gap: 8, color, opacity: s.status === 'pending' || s.status === 'skipped' ? 0.75 : 1 }}>
                  <span aria-hidden="true" style={{ width: 12, display: 'inline-block', textAlign: 'center' }}>{symbol}</span>
                  <span style={{ fontWeight: s.status === 'current' ? 600 : 400 }}>{text}</span>
                </div>
              );
            })}
          </div>
          {updateState === 'installing' ? (
            <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid #f0f0f1', fontSize: 12, color: '#6c6f72' }}>
              Most packages are already cached, so this is a download of the difference — not the whole tree.
            </div>
          ) : null}
        </div>
      ) : null}
      {lastUpdateSummary && !isUpdating && !updateIncomplete ? (
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 16px', background: '#f4fbf4', border: '1px solid #94d3ae', borderRadius: 8, fontSize: 13, color: '#0f5132' }}>
          <span aria-hidden="true" style={{ fontWeight: 700 }}>✓</span>
          <div style={{ flex: '1 1 auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <strong>Up to date with trunk as of today.</strong>
            <span>
              {lastUpdateSummary.lockfileChanged ? 'Dependencies updated' : 'Dependencies unchanged'}
              {typeof lastUpdateSummary.elapsedSeconds === 'number' ? `, rebuilt in ${formatElapsed(lastUpdateSummary.elapsedSeconds)}.` : ', rebuilt.'}
              {lastUpdateSummary.savedPatchPath ? ` Your changes were saved to ${lastUpdateSummary.savedPatchPath} before the reset.` : ''}
            </span>
          </div>
          <Button
            variant="tertiary"
            isSmall
            aria-label="Dismiss"
            onClick={() => setLastUpdateSummary(null)}
            style={{ color: '#0f5132' }}
          >✕</Button>
        </div>
      ) : null}
      {!skipInit ? (
        <div style={{ padding: 20, border: '1px solid #dcdcde', borderRadius: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: '#1d2327' }}>Initial setup checklist</div>
          {/*
            Nobody pressed a button to start this, so the banner has to say what
            is happening, how far along it is and how to stop it — that is the
            whole licence for running unattended. The step counter comes from
            the same `updateStepStatuses` the update panel uses.
          */}
          {isSettingUp ? (
            <div role="status" style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', padding: '12px 16px', background: '#e8f3ff', border: '1px solid #66afe9', borderRadius: 8, fontSize: 13, color: '#0b5d95' }}>
              <div style={{ flex: '1 1 320px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <strong style={{ color: '#0b5d95' }}>
                  Setting this site up for you — step {setupStepStates.filter((s) => s.status === 'complete').length + 1} of {setupSteps.length}
                </strong>
                <span>
                  {setupChainState === 'installing'
                    ? 'Installing dependencies. You can leave this running — the build follows on its own.'
                    : 'Running the full build. This can take up to half an hour on Windows; the Terminal below shows what it is doing.'}
                </span>
              </div>
              <Button variant="secondary" onClick={stopSetupChain}>Stop setup</Button>
            </div>
          ) : null}
          {!isSettingUp && setupChainEnd === 'stopped' ? (
            <div style={{ marginTop: 12, padding: '12px 16px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 8, fontSize: 13, color: '#6e5406' }}>
              <strong style={{ color: '#5c4400' }}>Setup stopped.</strong>{' '}
              Nothing was lost — pick it back up with the buttons below whenever you want.
            </div>
          ) : null}
          <div style={{ marginTop: 4, fontSize: 13, color: '#3c434a' }}>Complete each step to prepare this site for development.</div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {stepItems.map((step) => {
              const visuals = checklistVisuals[step.status] || checklistVisuals.locked;
              const cueId = `setup-${step.key}`;
              return (
                <div
                  key={step.key}
                  data-next-action={cueId}
                  className={nextActionId === cueId ? 'next-action-cue' : undefined}
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
                    <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: visuals.color, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{setupStepLabel(step.status, step.running)}</div>
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
            <span {...cueProps('start-dev')} style={{ display: 'inline-flex' }}>
            <Button
              isBusy={isServerStarting}
              variant={isDevProcessActive ? 'secondary' : 'primary'}
              onClick={toggleDevServer}
              disabled={isUpdating}
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
              <span style={{ fontWeight: 600 }}>{devServerButtonLabel}</span>
            </Button>
            </span>
            <Button
              variant="secondary"
              onClick={toggleWatch}
              // The one control that can end an update waiting on the resumed
              // watch (#507): a stop settles the waiters and leaves the update
              // incomplete, with the retry banner. Everything else stays gated.
              disabled={isUpdating && !updateWaitingOnWatch}
              title={watchActive ? `The build watch compiles ${project.cards.sourceDir} edits automatically` : `Compile ${project.cards.sourceDir} edits on save (runs independently of the dev server)`}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, justifyContent: 'center', padding: '12px 16px', fontSize: 15, borderRadius: 12 }}
            >
              <span
                aria-hidden="true"
                style={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', background: watchDotColor, flexShrink: 0 }}
              />
              <span style={{ fontWeight: 600 }}>{watchButtonLabel}</span>
            </Button>
            <span {...cueProps('review-changes')} style={{ display: 'inline-flex' }}>
            <Button
              variant="secondary"
              onClick={openPatchModal}
              disabled={isUpdating}
              style={{ padding: '10px 16px', borderRadius: 10 }}
            >Review & submit changes</Button>
            </span>
          </div>
          {changesNote && changesNote.placement === 'buttons' ? (
            <div style={{ fontSize: 13, color: '#1d2327', paddingLeft: 2 }}>
              {changesNoteBody}
            </div>
          ) : null}
          {(isServerStarting || serverUrl) ? (
            <div style={{ fontSize: 13, color: '#1d2327', paddingLeft: 2, display: 'flex', flexDirection: 'column', gap: 4 }}>
              {serverUrl ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <a href={serverUrl} onClick={(e) => { e.preventDefault(); window.api.openExternal(serverUrl); }}>{serverUrl}</a>
                    <span aria-hidden="true" style={{ color: '#8c8f94' }}>·</span>
                    <a href={adminUrl(serverUrl)} onClick={(e) => { e.preventDefault(); window.api.openExternal(adminUrl(serverUrl)); }}>wp-admin</a>
                    {running ? (
                      <>
                        <span aria-hidden="true" style={{ color: '#8c8f94' }}>·</span>
                        <a href={adminerUrl(serverUrl)} onClick={(e) => { e.preventDefault(); window.api.openExternal(adminerUrl(serverUrl)); }}>DB inspect (Adminer)</a>
                      </>
                    ) : null}
                  </div>
                  <span style={{ fontSize: 12, color: '#3c434a' }}>Log in with <code>admin</code> / <code>password</code>.</span>
                </>
              ) : (
                `Dev server is starting… (${formatElapsed(startElapsed)})`
              )}
            </div>
          ) : null}
        </div>
      ) : null}
      {/* Above the ticket panel rather than inside it, and outside the wizard
          gate: a link can arrive whether or not this site already has a ticket,
          and a site still in the setup wizard shows no ticket panel at all —
          which is exactly when a ticket that vanished silently would be worst. */}
      {deepLinkNote ? (
        <div role="status" style={{ padding: '14px 16px', border: '1px solid #dba617', background: '#fcf9e8', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 15, color: '#1d2327' }}>{deepLinkNote.title}</div>
          <div style={{ marginTop: 4, fontSize: 13, color: '#3c434a' }}>{deepLinkNote.body}</div>
          <div style={{ marginTop: 10 }}><Button variant="link" onClick={() => setDeepLinkNoteHidden(true)}>Hide</Button></div>
        </div>
      ) : null}
      {deepLinkPrompt ? (
        <div role="status" style={{ padding: '12px 14px', background: '#f0f6fc', border: '1px solid #72aee6', borderRadius: 8, color: '#1d2327' }}>
          <div style={{ fontWeight: 600 }}>{deepLinkPrompt.title}</div>
          <div style={{ marginTop: 4, fontSize: 13 }}>{deepLinkPrompt.body}</div>
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {/* No `isBusy`: answering clears the App's deep-link value, so this
                button is gone in the same tick it is pressed. What the link
                started is then reported where every other ticket link reports
                it — the panel's own progress line and `ticketError`. */}
            <ReasonedButton
              variant="primary"
              onClick={acceptDeepLink}
              reason={skipInit ? ticketActionsReason : 'Finish setting this site up first.'}
            >{deepLinkPrompt.confirmLabel}</ReasonedButton>
            <Button variant="link" onClick={dismissDeepLink}>Not now</Button>
          </div>
        </div>
      ) : null}
      {skipInit ? (
      <div {...cueProps('link-ticket')} style={{ padding: 20, border: '1px solid #dcdcde', borderRadius: 12, background: '#fff' }}>
        <div style={{ fontWeight: 600, fontSize: 16, color: '#1d2327' }}>{tracTicket ? `Working on ${workItem.noun} #${tracTicket}` : project.workItem.label}</div>
        {prCheckout && !isApplying ? (
          <div {...cueProps('pr-checkout')} style={{ marginTop: 12, padding: '14px 16px', border: `1px solid ${prBannerColors.border}`, background: prBannerColors.background, borderRadius: 8 }}>
            <div style={{ fontSize: 15, color: prBannerColors.text }}><strong>{prBanner.title}</strong></div>
            {prBanner.body ? (
              <div style={{ marginTop: 6, fontSize: 13, color: prBannerColors.text }}>{prBanner.body}</div>
            ) : null}
            <div style={{ marginTop: 6, fontSize: 13, color: '#3c434a' }}>{prCheckout.body} {prCheckout.edits}</div>
            <div style={{ marginTop: 6, fontSize: 12 }}>Revert this PR before applying another PR or patch file.</div>
            <ReasonedButton variant="secondary" onClick={() => runPrSwitch({ leaving: true })} reason={prBanner.revertReason} style={{ marginTop: 10 }}>
              {prCheckout.backLabel}
            </ReasonedButton>
          </div>
        ) : null}
        {tracTicket ? (
          <>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              {/* The ticket number is what the site is *for* once one is linked
                  — and under #108 it also names the branch you are on, so it
                  answers "which of my tickets am I looking at" at a glance.
                  Sized to read as the panel's subject rather than as a tag. */}
              <span style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 12px', borderRadius: 999, fontSize: 18, fontWeight: 600, letterSpacing: '0.01em', background: '#f0f0f1', color: '#1d2327' }}>
                #{tracTicket}
              </span>
              <Button variant="link" onClick={() => window.api.openExternal(workItem.urlFor(tracTicket))}>{workItem.openLabel}</Button>
              {showTracCards && !tracInfo ? (
                <Button variant="link" onClick={loadTracAttachments} disabled={tracAttachmentsLoading}>
                  {tracAttachmentsLoading ? 'Reading ticket…' : 'Read details from Trac'}
                </Button>
              ) : null}
              <ReasonedButton variant="link" isDestructive onClick={unlinkTicket} reason={ticketActionsReason}>Unlink</ReasonedButton>
            </div>

            {staleTicketNotice ? (
              <div role="status" style={{ marginTop: 10, padding: '10px 12px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 6, color: '#6e5406', fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{staleTicketNotice.title}</div>
                <div style={{ marginTop: 4 }}>{staleTicketNotice.body}</div>
                <div style={{ marginTop: 8 }}>
                  {/* Rewrites the tree when the ticket is checked out, so the
                      same gate as a discard: nothing running over the files.
                      Every branch of that gate has a sentence (#409). */}
                  <ReasonedButton
                    variant="secondary"
                    isBusy={ticketSaving}
                    reason={rebaseDisabledReason({ ticketSaving, deletingBranch, updateState, installing, building, devServerActive: isDevProcessActive, discarding, noun: workItem.noun })}
                    onClick={rebaseTicket}
                  >{staleTicketNotice.action}</ReasonedButton>
                </div>
              </div>
            ) : null}
            {ticketFeedback}

            {tracInfo ? (
              <div style={{ marginTop: 10 }}>
                {tracInfo.summary ? (
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#1d2327' }}>{tracInfo.summary}</div>
                ) : null}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap', fontSize: 12, color: '#3c434a' }}>
                  {tracInfoBadge ? (
                    <span style={{ padding: '1px 8px', borderRadius: 999, fontWeight: 600, fontSize: 11,
                      background: tracInfoBadge.tone === 'closed' ? '#fcf0f1' : '#edfaef',
                      color: tracInfoBadge.tone === 'closed' ? '#8a1f21' : '#005c12' }}>
                      {tracInfoBadge.label}
                    </span>
                  ) : null}
                  {tracInfo.type ? (
                    <span style={{ padding: '1px 8px', borderRadius: 999, fontSize: 11, background: '#f0f0f1', color: '#3c434a' }}>{tracInfo.type}</span>
                  ) : null}
                  {tracInfo.opened ? (
                    <span title={tracInfo.opened.absolute}>opened {tracInfo.opened.relative}</span>
                  ) : null}
                  {tracInfo.milestone ? <span>milestone: {tracInfo.milestone}</span> : null}
                </div>
                {tracInfo.component || tracInfo.keywords.length ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, flexWrap: 'wrap', fontSize: 12, color: '#6c6f72' }}>
                    {tracInfo.component ? (
                      <span>
                        component:{' '}
                        {tracInfo.component.url ? (
                          <Button variant="link" style={{ fontSize: 12 }} onClick={() => window.api.openExternal(tracInfo.component.url)}>
                            {tracInfo.component.label}
                          </Button>
                        ) : tracInfo.component.label}
                      </span>
                    ) : null}
                    {tracInfo.keywords.length ? (
                      <span>
                        keywords:{' '}
                        {tracInfo.keywords.map((kw, i) => (
                          <span key={kw.label}>
                            {i ? ' ' : ''}
                            {kw.url ? (
                              <Button variant="link" style={{ fontSize: 12 }} onClick={() => window.api.openExternal(kw.url)}>{kw.label}</Button>
                            ) : kw.label}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {changesNote && changesNote.placement === 'ticket' ? (
              <div style={{ marginTop: 8, fontSize: 13, color: '#1d2327' }}>
                {changesNoteBody}
                <div style={{ marginTop: 4, fontSize: 12, color: '#6c6f72' }}>{changesNote.unlinkNote}</div>
              </div>
            ) : null}

            <div ref={ticketPatchesRef} style={{ marginTop: 16, borderTop: '1px solid #f0f0f1', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1d2327' }}>Linked pull requests</div>
                <Button variant="link" onClick={loadTicketPatches} disabled={ticketPatchesLoading} style={{ fontSize: 12 }}>
                  {ticketPatchesLoading ? 'Checking…' : 'Refresh'}
                </Button>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#6c6f72' }}>
                See the work that already exists on this {workItem.noun} before adding your own.
              </div>

              {ticketPatchesLoading && !ticketPatches ? (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, color: '#3c434a', fontSize: 13 }}><Spinner /> Checking GitHub…</div>
              ) : null}

              {ticketPatches && ticketPatches.status === 'ok' && ticketPatches.items.length === 0 ? (
                <div style={{ marginTop: 10, fontSize: 13, color: '#6c6f72' }}>No pull requests cite this {workItem.noun} yet.</div>
              ) : null}

              {ticketPatches && ticketPatches.status !== 'ok' && ticketPatches.status !== 'no-ticket' ? (
                <div style={{ marginTop: 10, padding: '8px 10px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 6, fontSize: 12, color: '#6e5406' }}>
                  {TICKET_PATCH_STATUS_MESSAGE[ticketPatches.status] || TICKET_PATCH_STATUS_MESSAGE.error}
                  {ticketPatches.items && ticketPatches.items.length && ticketPatches.cachedAt
                    ? ` Showing what was last seen ${new Date(ticketPatches.cachedAt).toLocaleString()}.`
                    : ' No cached list to fall back on.'}
                </div>
              ) : null}

              {ticketPatches && ticketPatches.items && ticketPatches.items.length ? (
                <div style={{ marginTop: 10, border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
                  {ticketPatches.items.map((pr) => (
                    <div key={pr.number} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid #f0f0f1' }}>
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                          <span style={{ flex: '0 1 auto', minWidth: 0, fontSize: 13, color: '#1d2327', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Button variant="link" onClick={() => window.api.openExternal(pr.url)} style={{ fontSize: 13 }}>#{pr.number}</Button>
                            {' '}{pr.title}
                          </span>
                          {latestPill(latestPatch?.kind === 'pr' && latestPatch.key === pr.number)}
                          {pullRequest?.number === pr.number ? <span style={{ ...pillStyle, background: '#f4fbf4', color: '#0f5132', marginLeft: 8 }}>Applied</span> : null}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, fontSize: 11, color: '#6c6f72' }}>
                          {prStatePill(pr.state)}
                          {(() => {
                            const dated = prDateLabel(pr);
                            return dated ? <span>{dated.prefix} {new Date(dated.when).toLocaleDateString()}</span> : null;
                          })()}
                        </div>
                      </div>
                      {pullRequest ? null : (
                        <Button
                          variant="secondary"
                          isBusy={fetchingPr === pr.number}
                          disabled={isApplying || isUpdating || installing || building || Boolean(applyPreview) || fetchingPr !== null}
                          onClick={() => previewPr(pr)}
                          style={{ flex: '0 0 auto' }}
                        >Apply…</Button>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>

            {latestIsAttachment ? (
              <div style={{ marginTop: 12, padding: '8px 10px', background: '#e7f1ff', border: '1px solid #9ec5f0', borderRadius: 6, fontSize: 12, color: '#0b5d95' }}>
                The most recent patch on this ticket is a file attachment, not a pull request — see Trac attachments below.
              </div>
            ) : null}

            {/* Trac's alone: a GitHub issue carries no attachments, its work
                arrives as the pull requests listed above. */}
            {showTracCards ? (
            <div style={{ marginTop: 16, borderTop: '1px solid #f0f0f1', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, color: '#1d2327' }}>Trac attachments</div>
                {tracAttachments ? (
                  <Button variant="link" onClick={loadTracAttachments} disabled={tracAttachmentsLoading} style={{ fontSize: 12 }}>
                    {tracAttachmentsLoading ? 'Checking…' : 'Refresh'}
                  </Button>
                ) : null}
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#6c6f72' }}>
                Patch files are sometimes attached on Trac instead of a PR. Reading them opens the ticket so you can pass its human-check once.
              </div>

              {!tracAttachments && !tracAttachmentsLoading ? (
                <div style={{ marginTop: 10 }}>
                  <Button variant="secondary" onClick={loadTracAttachments} disabled={isApplying || isUpdating || installing || building} style={{ padding: '8px 14px', borderRadius: 10 }}>
                    Show Trac attachments
                  </Button>
                </div>
              ) : null}

              {tracAttachmentsLoading ? (
                <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, color: '#3c434a', fontSize: 13 }}><Spinner /> Opening the ticket on Trac…</div>
              ) : null}

              {tracAttachmentsRead && patchAttachments.length === 0 ? (
                <div style={{ marginTop: 10, fontSize: 13, color: '#6c6f72' }}>No patch files attached to this ticket.</div>
              ) : null}

              {tracAttachments && (tracAttachments.status === 'challenge-timeout' || tracAttachments.status === 'error' || tracAttachments.status === 'closed') ? (
                <div style={{ marginTop: 10, padding: '8px 10px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 6, fontSize: 12, color: '#6e5406' }}>
                  {(() => {
                    if (tracAttachments.status === 'challenge-timeout') return 'Trac’s human-check did not complete in time. Try again, and click “I am human” if it appears.';
                    if (tracAttachments.status === 'closed') return 'The Trac window was closed before the attachments finished loading. Click “Show Trac attachments” to try again.';
                    return `Could not read the attachments from Trac.${tracAttachments.error ? ` (${tracAttachments.error})` : ''}`;
                  })()}
                </div>
              ) : null}

              {patchAttachments.length ? (
                <div style={{ marginTop: 10, border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
                  {patchAttachments.map((att) => (
                    <div key={att.url} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderBottom: '1px solid #f0f0f1' }}>
                      <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
                          <span style={{ flex: '0 1 auto', minWidth: 0, fontSize: 13, color: '#1d2327', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <Button variant="link" onClick={() => window.api.openExternal(att.url)} style={{ fontSize: 13 }}>{att.filename}</Button>
                          </span>
                          {latestPill(latestPatch?.kind === 'attachment' && latestPatch.key === att.url)}
                        </div>
                        <div style={{ fontSize: 11, color: '#6c6f72' }}>
                          {[att.author && `by ${att.author}`, att.dateText, att.sizeText].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      {!pullRequest ? (
                      <Button
                        variant="secondary"
                        isBusy={fetchingAttachment === att.url}
                        disabled={isApplying || isUpdating || installing || building || Boolean(applyPreview) || fetchingAttachment !== null}
                        onClick={() => previewAttachment(att)}
                        style={{ flex: '0 0 auto' }}
                      >Apply…</Button>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            ) : null}
          </>
        ) : (
          <>
            <div style={{ marginTop: 4, fontSize: 13, color: '#3c434a' }}>
              Tell the app which {workItem.noun} you are working on. It is stored with the site, so it survives restarts, and you can change or remove it at any time.
            </div>
            <div style={{ marginTop: 12, display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ minWidth: 260 }}>
                <TextControl
                  value={ticketInput}
                  onChange={(value) => { setTicketInput(value); setTicketError(''); }}
                  onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); linkTicket(); } }}
                  disabled={ticketActionsBlocked}
                  placeholder={workItem.refPlaceholder}
                  aria-label={workItem.refLabel}
                />
              </div>
              <ReasonedButton
                variant="secondary"
                onClick={linkTicket}
                isBusy={ticketSaving}
                reason={ticketActionsReason}
                disabled={!ticketInput.trim()}
                style={{ padding: '10px 16px', borderRadius: 10 }}
              >Link {workItem.noun}</ReasonedButton>
            </div>
            {/* Expectation-setting, not the warning itself: since #234 the
                app asks before moving or discarding anything, so this only
                has to be true, not load-bearing. Said without asking the
                worktree, so it costs nothing. */}
            <div style={{ marginTop: 6, fontSize: 12, color: '#6c6f72' }}>
              If you have edited anything already, you will be asked what should happen to those edits.
            </div>
          </>
        )}
        {tracTicket ? null : ticketFeedback}
        {tracTicket ? null : (
          <div style={{ marginTop: 8 }}>
            <Button variant="link" onClick={() => window.api.openExternal(project.workItem.browseUrl)} style={{ fontSize: 12 }}>
              Not sure yet? {project.workItem.browseLabel}
            </Button>
          </div>
        )}
      </div>
      ) : null}
      {skipInit && (!pullRequest || isApplying || Boolean(applyError)) ? (
        <div style={{ padding: 20, border: '1px solid #dcdcde', borderRadius: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: '#1d2327' }}>{project.cards.applyHeading}</div>
          {!pullRequest && !applyPreview && !isApplying ? (
            <div style={{ marginTop: 4, fontSize: 13, color: '#3c434a' }}>{project.cards.applyDescription}</div>
          ) : null}

          {appliedLayer && !isApplying ? (
            <div style={{ marginTop: 12, padding: '14px 16px', border: `1px solid ${appliedLayer.canRevert ? '#94d3ae' : '#dba617'}`, background: appliedLayer.canRevert ? '#f4fbf4' : '#fcf9e8', borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: appliedLayer.canRevert ? '#0f5132' : '#6e5406' }}>
                <strong>{appliedLayer.label}</strong> {appliedLayer.summary}
              </div>
              <div style={{ marginTop: 8, fontSize: 12 }}>This patch is applied to your current work. Removing it may require undoing overlapping edits.</div>
              {watchBusyMessage(watchState, watchCompiling) ? (
                <div style={{ marginTop: 8, fontSize: 13, color: '#6e5406' }}>{watchBusyMessage(watchState, watchCompiling)}</div>
              ) : null}
              {appliedLayer.explanation ? (
                <div style={{ marginTop: 8, fontSize: 12, color: '#6e5406' }}>{appliedLayer.explanation}</div>
              ) : null}
              {appliedLayer.detail.map((line) => (
                <div key={line} style={{ marginTop: 4, fontSize: 12, color: '#6e5406', wordBreak: 'break-all' }}>{line}</div>
              ))}
              {appliedLayer.note ? (
                <div style={{ marginTop: 8, fontSize: 12, color: '#6c6f72' }}>{appliedLayer.note}</div>
              ) : null}
              <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {appliedLayer.canRevert ? (
                  <Button variant="secondary" onClick={() => runApply({ reverse: true })} disabled={isUpdating || installing || building}>Revert this patch</Button>
                ) : null}
                {appliedLayer.offerCopy ? (
                  <>
                    <Button variant="secondary" onClick={savePatch} disabled={layerExitBlocked}>Save a copy of your work</Button>
                    <Button variant="tertiary" onClick={discardAllChanges} disabled={layerExitBlocked}>Discard this ticket to its base</Button>
                  </>
                ) : null}
              </div>
              {/* Both exits report failure through state the changes note and the
                  patch modal own, and neither is on screen here — so a save that
                  could not write, or a discard that refused, would be a button
                  that did nothing on the one way out this banner recommends. */}
              {layerExit.message ? (
                <div role="alert" style={{ marginTop: 8, fontSize: 12, color: '#d63638' }}>{layerExit.message}</div>
              ) : null}
            </div>
          ) : null}

          {applyPreview && !isApplying ? (
            <div {...cueProps('apply-preview')} style={{ marginTop: 12, padding: '14px 16px', border: '1px solid #dcdcde', borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: '#1d2327' }}>
                {prPreview ? <strong>{prPreview.headline}</strong> : <><strong>{applyPreview.label}</strong> changes {applyPreview.paths.length} file{applyPreview.paths.length === 1 ? '' : 's'}:</>}
              </div>
              {applyPreview.kind === 'pr' && applyPreview.prState ? <div style={{ marginTop: 6 }}>{prStatePill(applyPreview.prState)}</div> : null}
              {prPreview?.closedNote ? <div style={{ marginTop: 8, fontSize: 12, color: '#6e5406' }}>{prPreview.closedNote}</div> : null}
              <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12, color: '#3c434a', lineHeight: 1.7, overflowWrap: 'anywhere', maxHeight: 140, overflowY: 'auto' }}>
                {applyPreview.paths.map((p) => <div key={p}>{p}</div>)}
              </div>
              {/* Who the colliding work belongs to (#306) is the sentence. */}
              {applyPreview.kind !== 'pr' && previewAttribution.sentences.length ? (
                <div role="alert" style={{ marginTop: 10, padding: '8px 10px', background: '#fcf9e8', border: '1px solid #dba617', borderRadius: 6, fontSize: 12, color: '#6e5406' }}>
                  {previewAttribution.sentences.map((sentence) => <div key={sentence} style={{ marginTop: 2 }}>{sentence}</div>)}
                </div>
              ) : null}
              {applyPreview.kind !== 'pr' && applyPreview.unsupported.length ? (
                <div style={{ marginTop: 10, fontSize: 12, color: '#6e5406' }}>
                  {applyPreview.unsupported.join(', ')} {applyPreview.unsupported.length === 1 ? 'is a binary file and will be skipped' : 'are binary files and will be skipped'}.
                </div>
              ) : null}
              {prPreview?.installNote ? <div style={{ marginTop: 10, fontSize: 12, color: '#3c434a' }}>{prPreview.installNote}</div> : null}
              {applyPreview.kind !== 'pr' && applyPreview.needsInstall ? <div style={{ marginTop: 10, fontSize: 12, color: '#3c434a' }}>It changes <code>package-lock.json</code>, so dependencies will be installed before the rebuild.</div> : null}
              <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                <Button variant="primary" onClick={() => runApply()} disabled={isUpdating || installing || building}>
                  {prPreview ? prPreview.actionLabel : 'Apply and rebuild'}
                </Button>
                <Button variant="tertiary" onClick={() => { setApplyPreview(null); clearApplyError(); setApplyNotice(''); }}>Cancel</Button>
              </div>
            </div>
          ) : null}

          {isApplying ? (
            <div {...cueProps('applying-patch')} style={{ marginTop: 12, padding: '14px 16px', border: '1px solid #dcdcde', borderRadius: 8 }}>
              {applyStepStates.map((state, i) => {
                const step = applySteps[i];
                const mark = UPDATE_STEP_MARKS[state.status];
                const stepLabel = state.status === 'skipped' ? step.skipMessage : step.label;
                return (
                  <div key={step.key} style={{ display: 'flex', gap: 8, fontSize: 13, padding: '2px 0', color: mark ? mark.color : '#6c6f72', fontWeight: state.status === 'current' ? 600 : 400, opacity: state.status === 'pending' || state.status === 'skipped' ? 0.75 : 1 }}>
                    <span aria-hidden="true" style={{ width: 12 }}>{mark ? mark.symbol : ''}</span>
                    <span>{stepLabel}</span>
                  </div>
                );
              })}
            </div>
          ) : null}

          {applyError ? (
            <div role="alert" style={{ marginTop: 12, padding: '8px 10px', background: '#fcf0f1', border: '1px solid #d63638', borderRadius: 6, fontSize: 12, color: '#8a1f21' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                {/* The headline replaces the sentence when there is one: it says
                    the same thing in counts, which is the part that decides
                    whether the patch is worth rescuing. Without a breakdown the
                    original sentence is still the whole story. */}
                <span style={{ flex: '1 1 auto' }}>
                  {applyConflict?.headline || (/[.!?]$/.test(applyError.trim()) ? applyError : `${applyError.trim()}.`)}{applyKind === 'patch' ? ' The checkout was not changed.' : ''}
                </span>
                <Button
                  variant="tertiary"
                  isSmall
                  aria-label="Dismiss"
                  onClick={() => clearApplyError()}
                  style={{ color: '#8a1f21' }}
                >✕</Button>
              </div>

              {applyConflict ? (
                <div style={{ marginTop: 8 }}>
                  {applyConflict.items.map((item, i) => (
                    <div key={i} style={{ marginTop: i ? 8 : 0 }}>
                      {item.kind === 'note' ? (
                        <div>{item.text}</div>
                      ) : (
                        <>
                          <div style={{ fontWeight: 600, wordBreak: 'break-all' }}>
                            {item.path} — {item.failed} of {item.total} {item.total === 1 ? 'change' : 'changes'}
                          </div>
                          {item.regions.map((region) => (
                            // index, not line: a concatenated patch can carry
                            // two hunks whose oldStart coincides.
                            <div key={region.index} style={{ marginTop: 4, paddingLeft: 10, borderLeft: '2px solid #d63638' }}>
                              {/* A searchable line, not a line number: the patch's
                                  numbers are coordinates in the file as its author
                                  had it, and on an old patch they miss by dozens.
                                  Text survives the drift — copy it into the
                                  editor's search and land on the region. */}
                              <div>
                                {region.anchor
                                  ? <>near <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{region.anchor}</code></>
                                  : `line ${region.line} of the patch`} · {region.reason}
                              </div>
                              {/* The lines themselves, because a location alone
                                  cannot answer the question that decides the
                                  next ten minutes: is this the change that
                                  matters, or reformatting that came with it. */}
                              {region.lines.length ? (
                                <pre style={{ margin: '2px 0 0', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                                  {region.lines.join('\n')}{region.more ? `\n… ${region.more} more ${region.more === 1 ? 'line' : 'lines'}` : ''}
                                </pre>
                              ) : null}
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  ))}

                  {applyConflict.advice ? (
                    <div style={{ marginTop: 8 }}>{applyConflict.advice}</div>
                  ) : null}

                  {applyConflict.offerOtherPatches || applyConflict.prUrl || applyConflict.offerDiscardToBase ? (
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {applyConflict.offerDiscardToBase ? (
                        <>
                          <Button variant="secondary" isSmall onClick={savePatch} disabled={layerExitBlocked}>Save a copy of your work</Button>
                          <Button variant="secondary" isSmall onClick={discardAllChanges} disabled={layerExitBlocked}>Discard this ticket to its base</Button>
                        </>
                      ) : null}
                      {applyConflict.offerOtherPatches ? (
                        <Button
                          variant="secondary"
                          isSmall
                          onClick={() => {
                            // Choosing another patch is walking away from this
                            // one, so everything about it goes: the preview
                            // (whose presence keeps the lists' Apply buttons
                            // disabled) and the failure banner itself — an
                            // error describing an abandoned attempt would sit
                            // above the new one as noise.
                            setApplyPreview(null);
                            clearApplyError();
                            ticketPatchesRef.current?.scrollIntoView({
                              block: 'center',
                              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
                            });
                          }}
                        >Try another patch on this ticket</Button>
                      ) : null}
                      {applyConflict.prUrl && applyConflict.prButton ? (
                        <Button variant="secondary" isSmall onClick={() => window.api.openExternal(applyConflict.prUrl)}>
                          {applyConflict.prButton}
                        </Button>
                      ) : null}
                    </div>
                  ) : null}

                  {applyConflict.offerDiscardToBase && layerExit.message ? (
                    <div style={{ marginTop: 8 }}>{layerExit.message}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {applyNotice ? (
            // Dismissible, like the update summary above: the notice reports
            // something already resolved, so it outlives its usefulness the
            // moment it has been read, and nothing else in this panel takes it
            // down until the next patch.
            <div role="status" style={{ marginTop: 12, padding: '8px 10px', background: '#f0f6fc', border: '1px solid #3582c4', borderRadius: 6, fontSize: 12, color: '#1d3a5f', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <span style={{ flex: '1 1 auto' }}>{applyNotice}</span>
              <Button
                variant="tertiary"
                isSmall
                aria-label="Dismiss"
                onClick={() => setApplyNotice('')}
                style={{ color: '#1d3a5f' }}
              >✕</Button>
            </div>
          ) : null}

          {!pullRequest && !applyPreview && !isApplying ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 280, flex: '1 1 280px' }}>
                  <TextControl
                    value={prUrlInput}
                    onChange={(value) => { setPrUrlInput(value); clearApplyError(); setApplyNotice(''); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); previewPrFromInput(); } }}
                    disabled={isUpdating || installing || building}
                    placeholder="Paste a pull request URL or number"
                    aria-label="Pull request URL or number"
                  />
                </div>
                <Button
                  variant="secondary"
                  onClick={previewPrFromInput}
                  disabled={isUpdating || installing || building || !prUrlInput.trim()}
                  style={{ padding: '10px 16px', borderRadius: 10 }}
                >Apply PR</Button>
              </div>
              {project.cards.patchFiles ? (
                <div style={{ marginTop: 10 }}>
                  <Button variant="link" onClick={choosePatchFile} disabled={isUpdating || installing || building} style={{ fontSize: 13 }}>
                    or choose a .diff / .patch file…
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {skipInit && ticketsCard ? (
        <div style={{ padding: 20, border: '1px solid #dcdcde', borderRadius: 12, background: '#fff' }}>
          <div style={{ fontWeight: 600, fontSize: 16, color: '#1d2327' }}>{ticketsCard.heading}</div>
          {renderBranchRows(Boolean(tracTicket))}
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
            {showTerminalHints ? (
              <>
                <div>Edited files in <code>{project.cards.sourceDir}</code>? Run <TerminalCommandLink command="npm run build" onPrefill={prefillTerminalCommand} disabled={terminalBusy} /> so the site picks them up.</div>
                <div style={{ marginTop: 2, marginBottom: 6 }}>Added a dependency to <code>package.json</code>? Run <TerminalCommandLink command="npm install" onPrefill={prefillTerminalCommand} disabled={terminalBusy} />.</div>
              </>
            ) : null}
            <div>
              Type <code>help</code> to list supported commands. Press <code>Ctrl+C</code> to stop the current command.
            </div>
          </div>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Logs</div>
          <TabPanel className="log-tabs" activeClass="is-active" onSelect={selectLogTab} tabs={logTabs}>
            {(tab) => {
              if (tab.name === 'runtime') {
                return <div ref={logs.runtimeRef} onScroll={logs.makeOnScroll('runtime')} style={LOG_PANE_STYLE}><LogText text={logs.runtimeLogs} /></div>;
              }
              if (tab.name === 'watch') {
                return (
                  <div ref={logs.watchRef} onScroll={logs.makeOnScroll('watch')} style={LOG_PANE_STYLE}>
                    {logs.watchLogs ? <LogText text={logs.watchLogs} /> : (
                      <span style={{ color:'#888', fontFamily:'-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>The build watch compiles <code>src/</code> edits into <code>build/</code>. It runs independently of the dev server — its output, and whether it is watching, paused, or stopped, appears here.</span>
                    )}
                  </div>
                );
              }
              return (
                <>
                <div ref={logs.debugRef} onScroll={logs.makeOnScroll('debug')} style={LOG_PANE_STYLE}>
                  {logs.debugLogs ? <LogText text={logs.debugLogs} /> : (
                    // An empty pane reads as broken, which is what this one was
                    // for as long as WP_DEBUG_LOG was never set. Say what fills
                    // it instead. In the app's own font, not the terminal's:
                    // this is interface copy rather than log output, and it is
                    // what keeps the `<code>` bits in it distinguishable.
                    <span style={{ color:'#888', fontFamily:'-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif' }}>No PHP notices or errors yet. Anything WordPress or your code writes — <code>error_log()</code>, notices, deprecations, fatals — appears here while the dev server runs.</span>
                  )}
                </div>
                <div style={{ display:'flex', gap:8, marginTop:8, alignItems:'center', justifyContent:'space-between', flexWrap:'wrap' }}>
                  {/* The file is under build/, while the file being edited when
                      it filled up is under src/ — so it cannot be guessed, and
                      it is what someone needs to tail it in a terminal or attach
                      it to a ticket. Selectable rather than truncated with an
                      ellipsis: a path you cannot copy is decoration. */}
                  <code style={{ fontSize:11, color:'#666', userSelect:'text', wordBreak:'break-all', flex:'1 1 240px' }}>{logs.debugLogPath || 'The log file appears once the dev server has run.'}</code>
                  <div style={{ display:'flex', gap:8 }}>
                    <Button size="small" variant="secondary" onClick={logs.revealDebugLog} disabled={!logs.debugLogPath}>Show in folder</Button>
                    <Button size="small" variant="secondary" onClick={logs.copyDebugLog} disabled={!logs.debugLogs}>{COPY_BUTTON_LABELS[logs.debugCopied] || COPY_BUTTON_LABELS.idle}</Button>
                    <Button size="small" variant="secondary" onClick={logs.clearDebugLog} disabled={!logs.debugLogs}>Clear</Button>
                  </div>
                </div>
                </>
              );
            }}
          </TabPanel>
        </div>
        <div>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Mail</div>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
            <div style={{ fontSize:12, color:'#666' }}>{mail.smtpPort ? `SMTP listening on 127.0.0.1:${mail.smtpPort}` : 'SMTP will start with the dev server.'}</div>
            <div><Button size="small" variant="secondary" onClick={mail.clear}>Clear emails</Button></div>
          </div>
          <div style={{ border:'1px solid #ddd', borderRadius:6, maxHeight:220, overflow:'auto' }}>
            {mail.emails && mail.emails.length ? mail.emails.map((m)=>{
              const when = m.sentAt || m.date; const whenStr = when ? new Date(when).toLocaleString() : '';
              return (
                <div key={m.id}
                  role="button"
                  tabIndex={0}
                  onClick={()=>mail.open(m)}
                  onKeyDown={(e)=>{ if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); mail.open(m); } }}
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
      {renameModalOpen ? (
        <RenameSiteModal sitePath={sitePath} displayName={displayName} onRename={onRename} onClose={closeRenameModal} />
      ) : null}
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
