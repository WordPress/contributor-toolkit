import { useCallback, useEffect, useState } from 'react';

// Who this contributor is and where they are contributing from (#166), held
// once for the same reason the detected editors are: both are facts about the
// person or their machine, not about a checkout, so answering them in one site's
// patch modal must not leave every other site still asking.
export function useContributorProvenance() {
  const [handle, setHandle] = useState(null);
  const [event, setEvent] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getProvenance()
      .then((res) => {
        if (cancelled) return;
        setHandle(res?.handle || null);
        setEvent(res?.event || null);
      })
      // "nothing answered yet" is an ordinary state; "the store could not be
      // read" is not, and the two must not look the same in the log. Same
      // argument as in useDetectedEditors.
      // eslint-disable-next-line no-console -- reaches the log file, see the note in useDetectedEditors.
      .catch((err) => console.error('Could not read the remembered contributor details:', err));
    return () => { cancelled = true; };
  }, []);

  // An empty ref forgets the field. A rejected invoke comes back as a refusal
  // rather than being raised: the caller shows the message next to the input.
  const rememberHandle = useCallback(async (ref) => {
    let result;
    try {
      result = await window.api.setWporgHandle(ref);
    } catch (err) {
      // eslint-disable-next-line no-console -- see the note above.
      console.error('Could not remember that WordPress.org handle:', err);
      return { ok: false, error: String(err?.message ?? err) };
    }
    if (result?.ok) setHandle(result.handle || null);
    return result;
  }, []);

  const rememberEvent = useCallback(async (ref) => {
    let result;
    try {
      result = await window.api.setContributionEvent(ref);
    } catch (err) {
      // eslint-disable-next-line no-console -- see the note above.
      console.error('Could not remember that event:', err);
      return { ok: false, error: String(err?.message ?? err) };
    }
    if (result?.ok) setEvent(result.event || null);
    return result;
  }, []);

  return { handle, event, rememberHandle, rememberEvent };
}
