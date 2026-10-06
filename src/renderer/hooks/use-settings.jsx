import { useCallback, useEffect, useState } from 'react';

// The app's settings (#559), held once for the window for the reason the
// contributor's details are: they are about the person and the machine,
// not about a checkout. `settings` is null until main has answered, so a
// dialog opened before then can say it is still reading them.
export function useSettings() {
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    let cancelled = false;
    window.api.getSettings()
      .then((res) => {
        if (cancelled || !res?.ok) return;
        setSettings(res.settings);
      })
      // eslint-disable-next-line no-console -- reaches the log file, see the note in useDetectedEditors.
      .catch((err) => console.error('Could not read the settings:', err));
    return () => { cancelled = true; };
  }, []);

  // One setting written, and the whole replaced by what main then holds. A
  // refusal comes back as one rather than being raised, with the words for
  // the contributor: the dialog shows them beside the setting.
  const change = useCallback(async (key, value) => {
    let result;
    try {
      result = await window.api.setSetting(key, value);
    } catch (err) {
      // eslint-disable-next-line no-console -- see the note above.
      console.error(`Could not change the setting ${key}:`, err);
      return { ok: false, error: String(err?.message ?? err) };
    }
    if (result?.ok) setSettings(result.settings);
    return result;
  }, []);

  return { settings, change };
}
