'use strict';

/**
 * The window's theme (#560): light, dark, whatever the operating system is
 * set to, or a pair of colours of the contributor's own, and what each side
 * of the app does with the answer.
 *
 * Main gives the choice to Electron's `nativeTheme`, which is the one place
 * the scheme has to be decided: Chromium then answers `prefers-color-scheme`
 * in the window from it, and paints the window's own chrome and the native
 * form controls to match. The window reads that answer and the setting, and
 * seeds the design system's colours from them. A custom theme is a scheme
 * too: light or dark by whether its background reads better with black text
 * or with white, so that the native controls match the page.
 *
 * Pure, and shared by main and the window: the colour a theme's surfaces are
 * built from is also the colour a window is made with, so that nothing white
 * shows before the page has painted.
 */

// What the theme setting can be. 'system' follows the operating system;
// 'custom' is the two colours below.
const THEMES = ['light', 'dark', 'system', 'custom'];

// The settings that make the theme: a change to any of them is a change of
// theme.
const THEME_KEYS = ['theme', 'customBackground', 'customPrimary'];

// The design system's own seeds, as the prototype has them: the colour the
// dark theme's surfaces are built from, the colour the light theme's are,
// and the brand colour both are built around, which a custom theme starts
// from. In the light theme the window passes no seed at all, since the
// tokens stylesheet already holds the light values and generating them again
// would move them by a hair; the light seed is the window's background only.
const DARK_BACKGROUND = '#1e1e1e';
const LIGHT_BACKGROUND = '#fcfcfc';
const PRIMARY = '#3858e9';

/**
 * A colour as the settings keep one, `#rrggbb` in lowercase, from what was
 * typed: three or six hex digits, with or without the `#`, in either case.
 *
 * @param {*} text
 * @return {?string} The colour, or null for anything that is not one.
 */
function normalizeHexColor(text) {
	if (typeof text !== 'string') return null;
	const digits = text.trim().replace(/^#/, '').toLowerCase();
	if (/^[0-9a-f]{6}$/.test(digits)) return `#${digits}`;
	if (/^[0-9a-f]{3}$/.test(digits)) return `#${digits.split('').map((d) => d + d).join('')}`;
	return null;
}

/**
 * Whether a value is a colour as the settings keep one.
 *
 * @param {*} value
 * @return {boolean}
 */
function isHexColor(value) {
	return typeof value === 'string' && /^#[0-9a-f]{6}$/.test(value);
}

// The relative luminance of a colour, as WCAG defines it and as the design
// system measures contrast: 0 for black, 1 for white.
function luminance(hex) {
	const channel = (at) => {
		const c = parseInt(hex.slice(at, at + 2), 16) / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Whether a background is a dark one: white text reads better on it than
 * black does. That is the point at which the native controls, which Chromium
 * paints for the scheme, should turn dark with the page.
 *
 * @param {string} hex `#rrggbb`.
 * @return {boolean}
 */
function isDarkColor(hex) {
	const l = luminance(hex);
	return (1.05) / (l + 0.05) > (l + 0.05) / 0.05;
}

/**
 * What the theme setting comes to, for the window and for main.
 *
 * @param {Object}  root0
 * @param {string}  root0.theme              One of THEMES.
 * @param {string}  [root0.customBackground] The custom theme's background, `#rrggbb`.
 * @param {string}  [root0.customPrimary]    The custom theme's primary colour, `#rrggbb`.
 * @param {boolean} [root0.systemDark]       Whether the operating system is in dark mode, for 'system'.
 * @return {{scheme: ('light'|'dark'), seeds: Object, background: string, key: string}}
 *   The scheme the window is in; what the design system's provider is given
 *   as its `color`; the colour a window is made with; and a name for the
 *   theme as painted, which changes when any of that does.
 */
function resolveTheme({ theme, customBackground, customPrimary, systemDark = false }) {
	if (theme === 'custom') {
		const background = isHexColor(customBackground) ? customBackground : LIGHT_BACKGROUND;
		const primary = isHexColor(customPrimary) ? customPrimary : PRIMARY;
		return {
			scheme: isDarkColor(background) ? 'dark' : 'light',
			seeds: { background, primary },
			background,
			key: `custom:${background}:${primary}`
		};
	}
	const dark = theme === 'dark' || (theme === 'system' && systemDark);
	return dark
		? { scheme: 'dark', seeds: { background: DARK_BACKGROUND }, background: DARK_BACKGROUND, key: 'dark' }
		: { scheme: 'light', seeds: {}, background: LIGHT_BACKGROUND, key: 'light' };
}

/**
 * What main gives Electron's `nativeTheme.themeSource` for the setting:
 * the setting itself for the three it knows, and for a custom theme the
 * scheme its background comes to.
 *
 * @param {Object} settings The theme settings, as `readSettings` answers them.
 * @return {('light'|'dark'|'system')}
 */
function nativeThemeSource(settings) {
	return settings.theme === 'custom' ? resolveTheme(settings).scheme : settings.theme;
}

module.exports = { THEMES, THEME_KEYS, resolveTheme, nativeThemeSource, normalizeHexColor, isHexColor, isDarkColor, DARK_BACKGROUND, LIGHT_BACKGROUND, PRIMARY };
