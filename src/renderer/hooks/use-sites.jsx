import { useCallback, useEffect, useState } from 'react';

// The two halves are one piece of state because one change moves both: adopting
// the directory the app really created has to retire the guessed row and carry
// its metadata across, and two setters cannot do that without a render in
// between where the site has a path under one key and a label under another.
// `setSiteMeta` keeps its old signature so every other caller is untouched;
// `applySetup` is for the changes that need the pair, which is every change the
// create flow makes.
// `loaded` is whether the first read has answered: until it has, the empty
// list is not an answer, and a window cannot tell "no sites" from "not read
// yet". It is state of its own because `applySetup` replaces the pair whole.
export function useSites() {
  const [state, setState] = useState({ sites: [], siteMeta: {} });
  const [loaded, setLoaded] = useState(false);
  const setSiteMeta = useCallback((update) => setState((prev) => ({
    ...prev,
    siteMeta: typeof update === 'function' ? update(prev.siteMeta) : update
  })), []);
  const applySetup = useCallback((fn) => setState(fn), []);
  const refresh = useCallback(async () => {
    const { sites: list, siteMeta: meta } = await window.api.getSitesWithMeta();
    setState({ sites: list, siteMeta: meta || {} });
    setLoaded(true);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);
  return { sites: state.sites, siteMeta: state.siteMeta, loaded, refresh, setSiteMeta, applySetup };
}
