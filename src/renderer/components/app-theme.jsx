import { createContext, useContext, useEffect, useState } from 'react';
import { ThemeProvider } from '@wordpress/theme';
import { themeColorSeeds } from '../../theme.cjs';

// What Chromium says of the window's colour scheme. It says it from the theme
// main gave Electron (#560), or from the operating system under 'system', so
// this is the one thing the window reads: not the setting, which would be a
// second answer to the same question.
const DARK_SCHEME = '(prefers-color-scheme: dark)';

// Whether the window is in the dark scheme, for whatever paints with values
// rather than with a stylesheet (the terminal) and so has to be told when it
// changes.
const DarkSchemeContext = createContext(false);

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
// values stand as they ship; in the dark scheme it is given the dark seed and
// builds every colour token from it, for its own components, for the older
// ones through the variables they read, and for the app's own styles.
export function AppTheme({ children }) {
  const dark = usePrefersDark();
  return (
    <DarkSchemeContext.Provider value={dark}>
      <ThemeProvider isRoot color={themeColorSeeds(dark)}>{children}</ThemeProvider>
    </DarkSchemeContext.Provider>
  );
}

export function useDarkScheme() {
  return useContext(DarkSchemeContext);
}
