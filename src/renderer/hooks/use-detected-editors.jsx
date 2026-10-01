import { useCallback, useState } from 'react';

// Which applications this machine has is a fact about the machine, not about a
// site, so it is held once for the window rather than once per site. Every site
// is mounted at all times (the inactive ones are hidden), so per-row state here
// would mean N copies of the same answer and N filesystem sweeps.
//
// Detection is deliberately not part of the load: the probe behind `editor:list`
// waits until a menu is actually opened. It is re-run on every open rather than
// cached for the session, because an editor installed while this app is running
// is one the next menu should offer. The previous answer is kept on screen in the
// meantime, so reopening the menu does not blink through an empty list.
export function useDetectedEditors() {
  const [detected, setDetected] = useState([]);
  const [loading, setLoading] = useState(false);

  const loadDetected = useCallback(async () => {
    setLoading(true);
    try {
      const result = await window.api.listEditors();
      setDetected(result?.detected || []);
    } catch (err) {
      // The menu still offers the file manager and "Other application…", which
      // is enough to finish the job — but "detection failed" and "nothing is
      // installed" must not be the same event to whoever reads the log.
      // eslint-disable-next-line no-console -- reaches the log file: logging.js initializes electron-log with spyRendererConsole, so this is how the renderer records a diagnostic.
      console.error('Could not list the editors on this machine:', err);
      setDetected([]);
    } finally {
      setLoading(false);
    }
  }, []);

  return { detected, loading, loadDetected };
}
