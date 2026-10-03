// What the site's terminal is painted with (#557). The terminal draws itself
// and is told its colours and its font as values, not as CSS, so they are
// read off the design system's tokens when it is made: which token each of
// its colours is, is decided here. They are read once: a terminal made under
// one theme keeps it.
//
// It is a light surface with dark text, like the log panes beside it. The
// colours a command can ask for by number are the design system's nearest:
// red is what an error is said in, green a success, yellow a warning. A
// command's "black" and its bright "white" are the text's own colour, and
// its "white" and bright "black" the quieter text's, since on this surface
// white could not be read.
//
// The eight bright colours are the eight plain ones. The design system's
// stronger colours are for text on a tinted notice, and on this surface are
// all but black: an error asked for in bright red would lose its red.
'use strict';

const NEUTRAL = 'var(--wpds-color-foreground-content-neutral)';
const NEUTRAL_WEAK = 'var(--wpds-color-foreground-content-neutral-weak)';
const SURFACE = 'var(--wpds-color-background-surface-neutral-weak)';

// The eight colours a command asks for by number.
const NUMBERED = {
	black: NEUTRAL,
	red: 'var(--wpds-color-foreground-content-error-weak)',
	green: 'var(--wpds-color-foreground-content-success-weak)',
	yellow: 'var(--wpds-color-foreground-content-warning-weak)',
	blue: 'var(--wpds-color-foreground-content-info-weak)',
	magenta: 'var(--wpds-color-foreground-interactive-brand)',
	cyan: 'var(--wpds-color-foreground-content-info-weak)',
	white: NEUTRAL_WEAK
};

// The terminal's name for a colour, and the token it is. Each is written as
// CSS would use it, `var(--…)`, which is how the build finds a token.
const TERMINAL_COLOR_TOKENS = {
	background: SURFACE,
	foreground: NEUTRAL,
	cursor: NEUTRAL,
	cursorAccent: SURFACE,
	// A selection is the design system's strong brand surface, with the
	// colour it has for text on that surface: a pale one could not be told
	// from the terminal's own, and the text's own colour could not be read
	// on a strong one.
	selectionBackground: 'var(--wpds-color-background-interactive-brand-strong)',
	selectionForeground: 'var(--wpds-color-foreground-interactive-brand-strong)',
	...NUMBERED,
	brightBlack: NEUTRAL_WEAK,
	brightRed: NUMBERED.red,
	brightGreen: NUMBERED.green,
	brightYellow: NUMBERED.yellow,
	brightBlue: NUMBERED.blue,
	brightMagenta: NUMBERED.magenta,
	brightCyan: NUMBERED.cyan,
	brightWhite: NEUTRAL
};

// How the terminal keeps what it prints readable on this surface: a colour
// a command asks for that would not be told from what is behind it, text on
// a coloured background above all, is moved until it is. (Bold text, which
// the terminal draws in the bright colour, needs nothing: the bright colours
// are the plain ones.)
const TERMINAL_READABILITY = {
	minimumContrastRatio: 4.5
};

// The font it is set in, and what it is set in where the token cannot be
// read.
const TERMINAL_FONT_TOKENS = {
	family: 'var(--wpds-typography-font-family-mono)',
	size: 'var(--wpds-typography-font-size-md)'
};
const TERMINAL_FONT_FALLBACK = { fontFamily: 'Menlo, Consolas, monaco, monospace', fontSize: 13 };

/**
 * The terminal's theme, from whatever reads the tokens.
 *
 * A token that is not there, or whose colour could not be read, is left out,
 * and the terminal keeps its own for it: a wrong colour would be worse than
 * a default one.
 *
 * @param {Object}   read
 * @param {Function} read.value Given a token as `var(--…)`, returns its value as written, or '' where there is none.
 * @param {Function} read.color Given a token as `var(--…)`, returns its colour as the terminal takes one (`#rrggbb`), or ''.
 * @return {Object} The theme, by the terminal's names.
 */
function terminalTheme({ value, color }) {
	const theme = {};
	for (const [name, token] of Object.entries(TERMINAL_COLOR_TOKENS)) {
		if (!String(value(token) || '').trim()) continue;
		const read = color(token);
		if (read) theme[name] = read;
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

module.exports = { terminalTheme, terminalFont, tokenName, TERMINAL_COLOR_TOKENS, TERMINAL_FONT_TOKENS, TERMINAL_FONT_FALLBACK, TERMINAL_READABILITY };
