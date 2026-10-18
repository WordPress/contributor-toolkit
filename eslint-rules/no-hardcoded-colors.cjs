'use strict';

// A colour written as a value in the renderer's code (#557).
//
// The window is painted with the design system's tokens, from classes in
// src/renderer/shell.css. A colour typed into a component is one the theme
// cannot reach: it stays what it was when the tokens change, and when the
// window goes dark. So a string in the renderer may name a token, wrapped in
// `var()`, and may not spell a colour out.
//
// What it reads is strings: a literal, or the fixed parts of a template. It
// sees the two ways CSS spells a colour out: a hex value and a function that
// takes a colour's channels. It does not see a colour's name, `red` or
// `white`, which is a word like any other in a string; a colour put together
// from pieces; or one in the text between two tags, which paints nothing.
//
// A rule of its own and not a selector given to `no-restricted-syntax`, which
// could find the same nodes: the message names what was found, and the two
// patterns are tested by themselves, through `hardcodedColor`.

// `#` and then 3, 4, 6 or 8 hex digits, and no more of a word on either side.
// The lengths are CSS's own, so a Trac ticket's five digits are not a colour.
// A reference of three or four digits written out in a string is one, as far
// as this can tell: `#607` is a grey. Those are put together from the number
// (`#%d` in a translated string, `#${ n }` in a template), which is how the
// renderer writes them already.
// A `#` that follows a word, an `&` or a `/` is a fragment or an entity.
const HEX_COLOR = /(?<![\w&/])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;

// The functions that take a colour's channels, as part of no longer word.
// `color-mix()` is not among them: what it mixes is given to it, and can be
// tokens.
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|device-cmyk)\(/i;

/**
 * The colour a string spells out, if it spells one.
 *
 * @param {string} text
 * @return {string|null} The hex value or the function's name, or null.
 */
function hardcodedColor( text ) {
	const hex = HEX_COLOR.exec( text );
	if ( hex ) return hex[ 0 ];
	const fn = COLOR_FUNCTION.exec( text );
	if ( fn ) return `${ fn[ 0 ] }…)`;
	return null;
}

module.exports = /** @type {import('eslint').Rule.RuleModule} */ ( {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow a colour written out as a value in a string',
		},
		schema: [],
		messages: {
			hardcoded:
				'{{ color }} reads as a colour written by hand. Use one of the design system\'s colour tokens: from a class in src/renderer/shell.css, or as a `var()` string where a library is handed the value. If it is a number someone reads, build it from the number.',
		},
	},
	create( context ) {
		const check = ( node, text ) => {
			// A number and a pattern are literals too, and are not strings.
			if ( typeof text !== 'string' ) return;
			const color = hardcodedColor( text );
			if ( color ) context.report( { node, messageId: 'hardcoded', data: { color } } );
		};
		return {
			Literal: ( node ) => check( node, node.value ),
			// The text as the program gets it. Where an escape cannot be read
			// there is none, and nothing to look in.
			TemplateElement: ( node ) => check( node, node.value.cooked ),
		};
	},
} );

module.exports.hardcodedColor = hardcodedColor;
