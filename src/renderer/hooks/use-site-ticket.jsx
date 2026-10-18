import { useCallback, useEffect, useRef, useState } from 'react';
import { __ } from '@wordpress/i18n';
import { discardOutcome } from '../changes-note.cjs';
import { rebaseRefusal } from '../ticket-trunk-notice.cjs';

// The ticket or issue a site is working on (#109, #108, #554): linking one,
// leaving it, switching between the ones that already have work here, moving
// one onto the current trunk, and deleting one's work. With it, the question a
// switch asks when trunk has loose edits, and what the panel says back.
//
// Every one of these is a write the main process makes; what is here is the
// asking, the busy flags, and what happens on the screen afterwards. A switch
// changes which branch the site is on, so each ends by re-reading the branch
// list and the site's status (`loadStatus`) and by measuring the
// unsubmitted-changes note again against the new branch
// (`reprobeAfterBranchChange`); `applyDiscardToNote` tells that note when
// edits were thrown away. `tracTicket`, `setTracTicket` and
// `setTicketBehindTrunk` are the status's own values for the linked ticket,
// which a switch sets ahead of the status being read again. `metaPatchRef`
// tells the window's site list, `onClearSwitchNotices` clears the last
// switch's progress line, and `workItem` is what this project calls a ticket
// and how it reads one.
//
// A switch can put a parked pull request back, which is the apply chain's
// work (useApplyPatch), and that hook is called further down the site's view
// than this one, because it needs the terminal and the build watch. So the
// two meet through three refs made here and handed out: the apply chain
// leaves in `ticketSwitchLifecycleRef` what a switch calls before, after and
// at its end, and in `retryPrSwitchRef` how to try a pull request's checkout
// again once trunk's loose edits are out of the way; `autoReadTicketRef` is
// where a link made by hand leaves the ticket whose details the apply chain
// should read. For the same reason `setTicketError` and
// `setBlockedByTrunkWork` are handed out: the apply chain refuses a switch
// and raises the loose-edits question in this hook's words.
export function useSiteTicket({ sitePath, workItem, tracTicket, setTracTicket, setTicketBehindTrunk, metaPatchRef, loadStatus, onClearSwitchNotices, reprobeAfterBranchChange, applyDiscardToNote }) {
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
  // The dirty-trunk question is answered here, and the PR switch function is
  // declared in useApplyPatch, which is called after this hook and fills this
  // ref on every render. The question's continuation uses it so clearing the
  // trunk can retry the PR operation instead of routing `pr/N` through the
  // ticket parser (#458).
  const retryPrSwitchRef = useRef(null);
  const ticketSwitchLifecycleRef = useRef(null);
  // Set only by saveTicket, on a link the contributor just performed. The
  // per-ticket effect in useApplyPatch consumes it to auto-read the ticket's
  // details: there, after the generation bump, so the scrape's result is not
  // dropped as stale. A ref and not state — it must not survive a remount, or
  // selecting an already-linked site would open a Trac window nobody asked
  // for (#292).
  const autoReadTicketRef = useRef(null);

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
          setTicketError(res?.error || __('Could not save the ticket.'));
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
  }, [sitePath, workItem, loadBranches, loadStatus, metaPatchRef, onClearSwitchNotices, reprobeAfterBranchChange, setTicketBehindTrunk, setTracTicket]);
  const linkTicket = useCallback(() => saveTicket(ticketInput), [saveTicket, ticketInput]);
  const unlinkTicket = useCallback(() => saveTicket(''), [saveTicket]);

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
  }, [sitePath, tracTicket, workItem, loadBranches, loadStatus, onClearSwitchNotices, reprobeAfterBranchChange, setTicketBehindTrunk]);

  const discardTrunkWorkAndSwitch = useCallback(async (target) => {
    setTicketSaving(true);
    setTicketError('');
    // The refused attempt left its last frame behind — without this, the
    // discard runs under a spinner describing a switch that never happened.
    if (onClearSwitchNotices) onClearSwitchNotices(sitePath);
    try {
      const res = await window.api.discardChanges(sitePath);
      if (!res?.ok) {
        setTicketError(res?.error || __('Could not discard the changes.'));
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
  }, [sitePath, saveTicket, onClearSwitchNotices, applyDiscardToNote]);

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
        setTicketError(res?.error || __('Could not save the patch.'));
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
        setTicketError(res?.error || __('Could not delete the branch.'));
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

  return {
    ticketInput,
    setTicketInput,
    ticketError,
    setTicketError,
    ticketSaving,
    ticketBranches,
    deletingBranch,
    blockedByTrunkWork,
    setBlockedByTrunkWork,
    patchSavedNotice,
    patchSavedTo,
    setPatchSavedTo,
    saveTicket,
    linkTicket,
    unlinkTicket,
    rebaseTicket,
    discardTrunkWorkAndSwitch,
    saveTrunkWorkThenStartClean,
    deleteTicketWork,
    retryPrSwitchRef,
    ticketSwitchLifecycleRef,
    autoReadTicketRef
  };
}
