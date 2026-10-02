import { useCallback, useEffect, useState } from 'react';

// What the main process says about a site (#554): whether it is installed and
// built, which ticket it is working on, what is applied to it, how old its
// trunk is, and the two states the app only reads and refuses to write over,
// a site the old engine made and a merge left unfinished outside the app.
//
// `loadStatus` reads all of it in one answer. It runs when the site's view
// mounts, which is when the site joins the list and not when it is first
// shown: for the sites already listed, as the app opens. It runs again when
// whoever calls it has changed what it would say: an install or a build
// ending, a ticket linked, left, switched or moved onto trunk, a ticket's
// work deleted when that leaves the checkout on trunk, an apply ending
// however it ends, an update, the setup chain, and the window coming back
// into focus while the site is the one on screen.
//
// `loadStatus` returns the status as well as storing it. The setup chain
// re-probes when a clone finishes and decides from that read, which React has
// not committed yet. It keeps its identity for as long as `sitePath` does, and
// the effect that calls it on mount depends on that: `metaPatchRef` is a ref
// for the same reason, so that a parent handing down a new callback does not
// read the status again.
//
// Not everything here comes from that one answer. Five setters are handed
// out, and what they set can be newer than the rest until the next read:
// linking or leaving a ticket sets `tracTicket` and `ticketBehindTrunk` and
// then reads the status, so until that read answers the screen shows the new
// ticket beside the old branch's applied patch; moving a ticket onto trunk clears
// `ticketBehindTrunk` the same way; the dev server's start asks the main
// process itself whether the site is built and copies that into `hasBuilt`;
// skipping the first-run checklist sets `skipInit`; and discarding every
// change clears `appliedPatch`, with no read after it. The other eight change
// only through `loadStatus`.
export function useSiteStatus({ sitePath, metaPatchRef }) {
  const [hasNodeModules, setHasNodeModules] = useState(false);
  const [installFailed, setInstallFailed] = useState(false);
  const [hasBuilt, setHasBuilt] = useState(false);
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
  // What the site's status says about its trunk (#94): the date of the commit
  // it is on, and whether an update was left incomplete. The update itself is
  // useTrunkUpdate.
  const [trunkDate, setTrunkDate] = useState(null);
  const [updateIncomplete, setUpdateIncomplete] = useState(false);
  const [appliedPatch, setAppliedPatch] = useState(null);
  const [pullRequest, setPullRequest] = useState(null);

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
  }, [sitePath, metaPatchRef]);
  useEffect(()=>{ loadStatus(); }, [loadStatus]);

  return {
    hasNodeModules,
    installFailed,
    hasBuilt,
    setHasBuilt,
    skipInit,
    setSkipInit,
    statusLoading,
    tracTicket,
    setTracTicket,
    ticketBehindTrunk,
    setTicketBehindTrunk,
    legacy,
    mergeInProgress,
    trunkDate,
    updateIncomplete,
    appliedPatch,
    setAppliedPatch,
    pullRequest,
    loadStatus
  };
}
