'use strict';

// The window's stylesheet is linted by Stylelint (stylelint.config.mjs), and
// this runs that configuration over styles that must pass and styles that
// must not.
//
// Nothing else would notice a rule that stopped reporting: the stylesheet
// would go on passing, and so would every journey, until a colour written by
// hand was in it. One of these rules is given a pattern in a form that only
// works written exactly so, and the others come from a package that is
// updated from outside.

const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const path = require( 'node:path' );
const { pathToFileURL } = require( 'node:url' );

const ROOT = path.join( __dirname, '..', '..' );

/**
 * The rules a piece of CSS breaks under the repository's configuration.
 *
 * @param {string} code
 * @return {Promise<string[]>} Rule names, one per report, in order.
 */
async function broken( code ) {
	// Both are ES modules, and this file is not.
	const { default: stylelint } = await import( 'stylelint' );
	const { default: config } = await import( pathToFileURL( path.join( ROOT, 'stylelint.config.mjs' ) ).href );
	const { results } = await stylelint.lint( { code, config, configBasedir: ROOT } );
	const [ result ] = results;
	// A rule given an option it does not understand reports that and nothing
	// else, which would read here as a style that passed.
	assert.deepEqual( result.invalidOptionWarnings, [] );
	assert.deepEqual( result.parseErrors, [] );
	return result.warnings.map( ( warning ) => warning.rule );
}

const PASSES = {
	'a token, written bare': '.a { color: var(--wpds-color-foreground-content-neutral); gap: var(--wpds-dimension-gap-sm); }',
	'tokens mixed, and nothing where a colour would be': '.a { background: color-mix(in srgb, var(--wpds-color-stroke-surface-warning) 60%, transparent); border-color: transparent; }',
	'a colour taken from where the element is': '.a { color: inherit; fill: currentColor; }',
	'a size that is not a token': '.a { gap: 10px; border-radius: 50%; max-height: 140px; }',
	'functions that are not colours': '.a { width: min(360px, calc(100vw - 2 * var(--wpds-dimension-padding-2xl))); transform: translate(0, 1px); }',
	'a colour in a comment': '/* was #fff */ .a { margin: 0; }',
};

const FAILS = {
	'a hex colour': [ '.a { color: #cc1818; }', 'color-no-hex' ],
	'a hex colour in capitals': [ '.a { color: #FFF; }', 'color-no-hex' ],
	'a colour by name': [ '.a { background: white; }', 'color-named' ],
	'a colour function': [ '.a { color: rgb(0 0 0 / 50%); }', 'function-disallowed-list' ],
	'a colour function in capitals': [ '.a { color: RGB(0, 0, 0); }', 'function-disallowed-list' ],
	'a colour function in a shadow': [ '.a { box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16); }', 'function-disallowed-list' ],
	'a colour by its space': [ '.a { color: color(display-p3 1 0 0); }', 'function-disallowed-list' ],
	'a colour written inside a mix': [ '.a { color: color-mix(in srgb, #fff 50%, transparent); }', 'color-no-hex' ],
	// The next and the last are what ESLint's own two rules about tokens look
	// for in a string, and here they are the styles under test.
	// eslint-disable-next-line @wordpress/no-unknown-ds-tokens
	'a token the design system does not have': [ '.a { box-shadow: var(--wpds-elevation-md); }', 'plugin-wpds/no-unknown-ds-tokens' ],
	'a fallback beside a token': [ '.a { gap: var(--wpds-dimension-gap-sm, 8px); }', 'plugin-wpds/no-token-fallback-values' ],
	// eslint-disable-next-line @wordpress/no-setting-ds-tokens
	'a token given a value': [ '.a { --wpds-dimension-gap-sm: 2px; }', 'plugin-wpds/no-setting-wpds-custom-properties' ],
};

for ( const [ name, code ] of Object.entries( PASSES ) ) {
	test( `the stylesheet may hold ${ name }`, async () => {
		assert.deepEqual( await broken( code ), [] );
	} );
}

for ( const [ name, [ code, rule ] ] of Object.entries( FAILS ) ) {
	test( `the stylesheet may not hold ${ name }`, async () => {
		assert.deepEqual( await broken( code ), [ rule ] );
	} );
}
