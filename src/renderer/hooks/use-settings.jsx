import { useCallback, useEffect, useState } from 'react';

// The app's settings (#559), held once for the window for the reason the
// contributor's details are: they are about the person and the machine,
// not about a checkout. They are read before the first render, since the
// theme is one of them (#560), and handed in as `initial`; where that read
// failed they are null until main has answered a second ask here, so a
// dialog opened before then can say it is still reading them. `loaded` is
// what main answered first and does not change: a setting that takes a
// relaunch, the language, is one whose value now differs from it.
// `php` is what the bundled Playground can run a site on, `{ versions,
// fallback }`, read once with the settings: the dialog offers the versions
// and the details say which one a server starts on, which is the fallback
// where the one set is not among them. Null until read; `{ error }` when it
// could not be, so the dialog can say so rather than offer nothing.
export function useSettings(initial = null) {
  const [settings, setSettings] = useState(initial);
  const [loaded, setLoaded] = useState(initial);
  const [php, setPhp] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!initial) {
      window.api.getSettings()
        .then((res) => {
          if (cancelled || !res?.ok) return;
          setSettings(res.settings);
          setLoaded(res.settings);
        })
        // eslint-disable-next-line no-console -- reaches the log file, see the note in useDetectedEditors.
        .catch((err) => console.error('Could not read the settings:', err));
    }
    window.api.listPhpVersions()
      .then((res) => {
        if (cancelled) return;
        setPhp(res?.ok ? { versions: res.versions, fallback: res.fallback } : { error: true });
      })
      .catch((err) => {
        // eslint-disable-next-line no-console -- see the note above.
        console.error('Could not read the PHP versions:', err);
        if (!cancelled) setPhp({ error: true });
      });
    return () => { cancelled = true; };
  }, [initial]);

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

  return { settings, loaded, php, change };
}
