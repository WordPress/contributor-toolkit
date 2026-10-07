import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from '@wordpress/theme';
import { resolveTheme } from '../../theme.cjs';

// What Chromium says of the window's colour scheme. It says it from the theme
// main gave Electron (#560), or from the operating system under 'system', so
// the scheme is read here and not decided again from the setting: for the
// three named themes it is the answer, and for a custom one the setting's
// colours are what is painted, in the scheme main decided from them.
const DARK_SCHEME = '(prefers-color-scheme: dark)';

// The theme as painted, for whatever paints with values rather than with a
// stylesheet (the terminal) and so has to be told when it changes: a name
// that changes with it, and what the design system said of the colours.
const ThemeContext = createContext({ key: 'light', warnings: [] });

function usePrefersDark() {
  const [dark, setDark] = useState(() => window.matchMedia(DARK_SCHEME).matches);
  useEffect(() => {
    const media = window.matchMedia(DARK_SCHEME);
    const onChange = (event) => setDark(event.matches);
    media.addEventListener('change', onChange);
    // A change between the first read and the listener is not missed.
    setDark(media.matches);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return dark;
}

// The design system's provider, at the root of the window. `isRoot` puts what
// it overrides on the document rather than on its own wrapper, which is what
// reaches a modal or a popover: those are portalled to `body`, outside this
// tree. In the light scheme it is given no colour, so the tokens stylesheet's
// values stand as they ship; in the dark scheme it is given the dark seed, and
// under a custom theme the two colours chosen, and builds every colour token
// from them, for its own components, for the older ones through the variables
// they read, and for the app's own styles.
//
// `settings` is what main holds, or null until it has answered: until then
// the window is painted for the scheme alone, which for a custom theme is
// the standard theme of its scheme for the moment before the colours arrive.
export function AppTheme({ settings, children }) {
  const prefersDark = usePrefersDark();
  const [warnings, setWarnings] = useState([]);
  let theme = prefersDark ? 'dark' : 'light';
  if (settings) theme = settings.theme;
  const customBackground = settings ? settings.customBackground : undefined;
  const customPrimary = settings ? settings.customPrimary : undefined;
  const resolved = useMemo(
    () => resolveTheme({ theme, customBackground, customPrimary, systemDark: prefersDark }),
    [theme, customBackground, customPrimary, prefersDark]
  );
  const value = useMemo(() => ({ key: resolved.key, warnings }), [resolved.key, warnings]);
  return (
    <ThemeContext.Provider value={value}>
      <ThemeProvider isRoot color={resolved.seeds} onColorWarnings={setWarnings}>{children}</ThemeProvider>
    </ThemeContext.Provider>
  );
}

// A name for the theme as painted, which changes whenever what is painted
// does.
export function useThemeKey() {
  return useContext(ThemeContext).key;
}

// What the design system said of the colours it was given: a contrast it
// could not reach is one, so that a custom theme can say when its text may
// be hard to read.
export function useThemeWarnings() {
  return useContext(ThemeContext).warnings;
}
