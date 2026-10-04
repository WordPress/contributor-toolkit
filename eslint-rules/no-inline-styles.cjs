'use strict';

// A `style` written on an element in the renderer (#557).
//
// How the window looks is in src/renderer/shell.css, as classes painted with
// the design system's tokens, and in the design system's own components. A
// `style` on an element is a second place for it that nothing else can see:
// it outranks every class, a media query cannot change it, and a colour or a
// size written in one is where the hand-written values came back from last
// time. `Stack` has the gaps and the alignment, `Text` has the type, and what
// is left is a class.
//
// It reads the attribute as written on a JSX element, and nothing else: not a
// `style` handed over in a spread, and not one set on an element from an
// effect. A selector given to `no-restricted-syntax` could find the same
// attribute; this is a rule of its own so that it is tested beside the other
// one, and says why in its own words. A value that can only
// be known while the app runs, a width measured from something, has no class
// to be; that one is disabled where it stands, with the reason beside it.

module.exports = /** @type {import('eslint').Rule.RuleModule} */ ( {
	meta: {
		type: 'problem',
		docs: {
			description: 'Disallow an inline style on an element in the renderer',
		},
		schema: [],
		messages: {
			inline:
				'An inline `style` outranks every class and no media query can change it. Use a design-system component (`Stack`, `Text`) or a class in src/renderer/shell.css painted with tokens.',
		},
	},
	create( context ) {
		return {
			JSXAttribute( node ) {
				if ( node.name.type === 'JSXIdentifier' && node.name.name === 'style' ) {
					context.report( { node, messageId: 'inline' } );
				}
			},
		};
	},
} );
