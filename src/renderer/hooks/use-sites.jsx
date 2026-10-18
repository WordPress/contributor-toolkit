import { useCallback, useEffect, useState } from 'react';

// The two halves are one piece of state because one change moves both: adopting
// the directory the app really created has to retire the guessed row and carry
// its metadata across, and two setters cannot do that without a render in
// between where the site has a path under one key and a label under another.
// `setSiteMeta` keeps its old signature so every other caller is untouched;
// `applySetup` is for the changes that need the pair, which is every change the
// create flow makes.
export function useSites() {
  const [state, setState] = useState({ sites: [], siteMeta: {} });
  const setSiteMeta = useCallback((update) => setState((prev) => ({
    ...prev,
    siteMeta: typeof update === 'function' ? update(prev.siteMeta) : update
  })), []);
  const applySetup = useCallback((fn) => setState(fn), []);
  const refresh = useCallback(async () => {
    const { sites: list, siteMeta: meta } = await window.api.getSitesWithMeta();
    setState({ sites: list, siteMeta: meta || {} });
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { sites: state.sites, siteMeta: state.siteMeta, refresh, setSiteMeta, applySetup };
}
