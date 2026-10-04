// The window's stylesheet, src/renderer/shell.css.
//
// The window is painted with the design system's tokens (#557), from classes
// in that file: it is where the renderer's styling is, and so where a colour
// written by hand would go. These rules are what keeps one out. What keeps
// one out of the components is ESLint's business (eslint.config.mjs).
//
// Only what is about tokens and colours is switched on. There is no shared
// preset here on purpose: one would bring a few hundred opinions about
// formatting and ordering to a file written before any of them, and bury the
// findings this exists for. The same reasoning as for Prettier in
// eslint.config.mjs.

// The functions that take a colour's channels, in whatever case: CSS reads
// `RGB()` as it reads `rgb()`. `color-mix()` is not one of them: what it mixes
// is given to it, and is tokens.
const COLOR_FUNCTIONS = '/^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)$/i';

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
		// given its channels. `transparent`, `currentColor` and `inherit` are
		// none of these and pass, as they should. So do the system's own
		// colours, `Canvas` and the like, which follow the operating system
		// and not the theme: nothing here uses one, and nothing looks for one.
		'color-no-hex': true,
		'color-named': 'never',
		'function-disallowed-list': [ COLOR_FUNCTIONS ],
	},
};
