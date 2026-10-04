// The stylesheet's half of what ESLint does for the renderer's components.
//
// The window is painted with the design system's tokens (#557), and since the
// components carry no colour and no style of their own (eslint-rules/), the
// one place a colour can still be written by hand is src/renderer/shell.css.
// These rules are what keeps it out.
//
// Only what is about tokens and colours is switched on. There is no shared
// preset here on purpose: one would bring a few hundred opinions about
// formatting and ordering to a file written before any of them, and bury the
// findings this exists for. The same reasoning as for Prettier in
// eslint.config.mjs.

// The functions that take a colour's channels. `color-mix()` is not one of
// them: what it mixes is given to it, and is tokens.
const COLOR_FUNCTIONS = [ 'rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch', 'color', 'device-cmyk' ];

export default {
	plugins: [
		'@wordpress/theme/stylelint-plugins/no-unknown-ds-tokens',
		'@wordpress/theme/stylelint-plugins/no-setting-wpds-custom-properties',
		'@wordpress/theme/stylelint-plugins/no-token-fallback-values',
	],
	rules: {
		// The design system's own three. A token that does not exist paints
		// nothing and says nothing; a token set here would stop following the
		// theme; and a fallback written beside a token is a second copy of its
		// value, which stays behind when the token moves.
		'plugin-wpds/no-unknown-ds-tokens': true,
		'plugin-wpds/no-setting-wpds-custom-properties': true,
		'plugin-wpds/no-token-fallback-values': true,

		// A colour is a token. Not a hex value, not a name, not a function
		// given its channels.
		'color-no-hex': true,
		'color-named': 'never',
		'function-disallowed-list': COLOR_FUNCTIONS,
	},
};
