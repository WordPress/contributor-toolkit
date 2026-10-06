'use strict';

/**
 * The window's theme (#560): light, dark, or whatever the operating system
 * is set to, and what each side of the app does with the answer.
 *
 * Main gives the choice to Electron's `nativeTheme`, which is the one place
 * the choice has to be made: Chromium then answers `prefers-color-scheme` in
 * the window from it, and paints the window's own chrome and the native form
 * controls to match. The window only reads that answer, and seeds the design
 * system's colours from it. So there is one source of truth, and a change
 * reaches the window as the operating system's would.
 *
 * Pure, and shared by main and the window: the dark seed is both the colour
 * the design system builds its dark ramp from and the colour a window is
 * made with, so that nothing white shows before the page has painted.
 */

// What the theme setting can be. 'system' follows the operating system.
const THEMES = ['light', 'dark', 'system'];

// The design system's own seeds, as the prototype has them: the colour the
// dark theme's surfaces are built from, and the colour the light theme's
// are. In the light theme the window passes no seed at all, since the tokens
// stylesheet already holds the light values and generating them again would
// move them by a hair; the light seed is the window's background only.
const DARK_BACKGROUND = '#1e1e1e';
const LIGHT_BACKGROUND = '#fcfcfc';

/**
 * What the design system's provider is given for the scheme the window is
 * in: a seed to build the dark ramp from, or nothing, which is the light
 * theme as the tokens stylesheet ships it.
 *
 * @param {boolean} dark Whether the window is in the dark scheme.
 * @return {Object} The provider's `color` prop.
 */
function themeColorSeeds(dark) {
	return dark ? { background: DARK_BACKGROUND } : {};
}

/**
 * The colour a window is made with, so that the frame is not white for the
 * moment before the page paints a dark one.
 *
 * @param {boolean} dark Whether the window is in the dark scheme.
 * @return {string} `#rrggbb`.
 */
function windowBackground(dark) {
	return dark ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

module.exports = { THEMES, themeColorSeeds, windowBackground, DARK_BACKGROUND, LIGHT_BACKGROUND };
