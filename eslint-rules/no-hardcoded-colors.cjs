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
// sees the two ways CSS spells a colour that no English sentence does by
// accident, a hex value and a colour function. A colour's name, `red` or
// `white`, is a word like any other in a string and is not looked for.

// `#` and then 3, 4, 6 or 8 hex digits, and no more of a word on either side.
// The lengths are CSS's own, so a ticket reference of five digits is not one.
// A `#` that follows a word or an `&` is a fragment or an entity.
const HEX_COLOR = /(?<![\w&])#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;

// The functions that take a colour's channels. `color-mix()` is not among
// them: what it mixes is given to it, and can be tokens.
const COLOR_FUNCTION = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;

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
			description: 'Disallow a colour written as a value where the design system has a token',
		},
		schema: [],
		messages: {
			hardcoded:
				'{{ color }} is a colour written by hand. Paint with one of the design system\'s colour tokens, from a class in src/renderer/shell.css.',
		},
	},
	create( context ) {
		const check = ( node, text ) => {
			if ( typeof text !== 'string' ) return;
			const color = hardcodedColor( text );
			if ( color ) context.report( { node, messageId: 'hardcoded', data: { color } } );
		};
		return {
			Literal: ( node ) => check( node, node.value ),
			TemplateElement: ( node ) => check( node, node.value.cooked ),
		};
	},
} );

module.exports.hardcodedColor = hardcodedColor;
