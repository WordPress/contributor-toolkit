// What the site's terminal is painted with (#557). The terminal draws itself
// and is told its colours and its font as values, not as CSS, so they are
// read off the design system's tokens when it is made: which token each of
// its colours is, is decided here.
//
// It is a light surface with dark text, like the log panes beside it, and
// follows the theme the tokens follow. The sixteen colours a command can ask
// for by number are the design system's nearest: red is what an error is
// said in, green a success, yellow a warning. A command's "white" is the
// text's own colour and its "black" the same, since on this surface white
// could not be read.
'use strict';

const NEUTRAL = 'var(--wpds-color-foreground-content-neutral)';
const NEUTRAL_WEAK = 'var(--wpds-color-foreground-content-neutral-weak)';

// The terminal's name for a colour, and the token it is. Each is written as
// CSS would use it, `var(--…)`, which is how the build finds a token.
const TERMINAL_COLOR_TOKENS = {
	background: 'var(--wpds-color-background-surface-neutral-weak)',
	foreground: NEUTRAL,
	cursor: NEUTRAL,
	cursorAccent: 'var(--wpds-color-background-surface-neutral-weak)',
	selectionBackground: 'var(--wpds-color-background-interactive-brand-weak-active)',
	black: NEUTRAL,
	red: 'var(--wpds-color-foreground-content-error-weak)',
	green: 'var(--wpds-color-foreground-content-success-weak)',
	yellow: 'var(--wpds-color-foreground-content-warning-weak)',
	blue: 'var(--wpds-color-foreground-content-info-weak)',
	magenta: 'var(--wpds-color-foreground-interactive-brand)',
	cyan: 'var(--wpds-color-foreground-content-info-weak)',
	white: NEUTRAL_WEAK,
	brightBlack: NEUTRAL_WEAK,
	brightRed: 'var(--wpds-color-foreground-content-error)',
	brightGreen: 'var(--wpds-color-foreground-content-success)',
	brightYellow: 'var(--wpds-color-foreground-content-caution-weak)',
	brightBlue: 'var(--wpds-color-foreground-content-info)',
	brightMagenta: 'var(--wpds-color-foreground-interactive-brand-active)',
	brightCyan: 'var(--wpds-color-foreground-content-info)',
	brightWhite: NEUTRAL
};

// The font it is set in, and what it is set in where the token cannot be
// read.
const TERMINAL_FONT_TOKENS = {
	family: 'var(--wpds-typography-font-family-mono)',
	size: 'var(--wpds-typography-font-size-md)'
};
const TERMINAL_FONT_FALLBACK = { fontFamily: 'Menlo, Consolas, monaco, monospace', fontSize: 13 };

/**
 * The terminal's theme, from whatever reads a token's colour.
 *
 * A colour that could not be read is left out, and the terminal keeps its
 * own for it: a wrong colour would be worse than a default one.
 *
 * @param {Function} readColor Given a token as `var(--…)`, returns its colour as the terminal takes one (`#rrggbb`), or ''.
 * @return {Object} The theme, by the terminal's names.
 */
function terminalTheme(readColor) {
	const theme = {};
	for (const [name, token] of Object.entries(TERMINAL_COLOR_TOKENS)) {
		const color = readColor(token);
		if (color) theme[name] = color;
	}
	return theme;
}

/**
 * The terminal's font, from whatever reads a token's value.
 *
 * @param {Function} readValue Given a token as `var(--…)`, returns its value as written (`12px`, a list of font names), or ''.
 * @return {{fontFamily: string, fontSize: number}} What the terminal is set in.
 */
function terminalFont(readValue) {
	// A list of font names is written over several lines in the tokens.
	const family = String(readValue(TERMINAL_FONT_TOKENS.family) || '').replace(/\s+/g, ' ').trim();
	const size = parseFloat(readValue(TERMINAL_FONT_TOKENS.size));
	return {
		fontFamily: family || TERMINAL_FONT_FALLBACK.fontFamily,
		fontSize: Number.isFinite(size) && size > 0 ? size : TERMINAL_FONT_FALLBACK.fontSize
	};
}

/**
 * The name of the token a `var(--…)` is of, for reading its value as it is
 * written.
 *
 * @param {string} expression `var(--wpds-…)`.
 * @return {string} `--wpds-…`, or '' for anything else.
 */
function tokenName(expression) {
	const found = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(String(expression || ''));
	return found ? found[1] : '';
}

module.exports = { terminalTheme, terminalFont, tokenName, TERMINAL_COLOR_TOKENS, TERMINAL_FONT_TOKENS, TERMINAL_FONT_FALLBACK };
