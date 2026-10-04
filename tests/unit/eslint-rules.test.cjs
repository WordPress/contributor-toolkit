'use strict';

// This repository's own lint rules (eslint-rules/), each run over code that
// must pass and code that must not.
//
// They are the check on how a component in the renderer may be written: no
// test reads a component's source, so a rule that stopped reporting would
// let the hand-written colours and inline styles back without anything going
// red. This is where that would show.

const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const { RuleTester } = require( 'eslint' );
const { rules } = require( '../../eslint-rules/index.cjs' );
const { hardcodedColor } = require( '../../eslint-rules/no-hardcoded-colors.cjs' );

// RuleTester builds its own suites; these are node:test's.
RuleTester.describe = test.describe;
RuleTester.it = test.it;
RuleTester.itOnly = test.it.only;

const tester = new RuleTester( {
	languageOptions: {
		ecmaVersion: 'latest',
		sourceType: 'module',
		parserOptions: { ecmaFeatures: { jsx: true } },
	},
} );

tester.run( 'no-hardcoded-colors', rules[ 'no-hardcoded-colors' ], {
	valid: [
		// A token is how a colour is written.
		"const surface = 'var(--wpds-color-background-surface-neutral-weak)';",
		// What a mix is made of is given to it.
		"const ring = 'color-mix(in srgb, var(--wpds-color-stroke-surface-warning) 60%, transparent)';",
		// A ticket and a pull request are referred to by number.
		"const title = 'Ticket #62281';",
		"const name = `Opened pull request #${ number }`;",
		"const format = '#%d';",
		// A fragment and an entity are not colours, whatever their letters.
		"const link = 'https://example.org/page#fade';",
		"const entity = '&#128;';",
		// A word that only starts like a function.
		"const label = 'Calibrated(tm)';",
		// A number is not a string, and a comment is not code.
		'const count = 0xfff; // #fff',
	],
	invalid: [
		{ code: "const text = '#1d2327';", errors: [ { messageId: 'hardcoded', data: { color: '#1d2327' } } ] },
		{ code: "const border = '1px solid #ddd';", errors: [ { messageId: 'hardcoded', data: { color: '#ddd' } } ] },
		{ code: "const faint = '#0000';", errors: [ { messageId: 'hardcoded', data: { color: '#0000' } } ] },
		{ code: "const veil = '#11111180';", errors: [ { messageId: 'hardcoded', data: { color: '#11111180' } } ] },
		{ code: "const wash = 'rgba(46,160,67,0.18)';", errors: [ { messageId: 'hardcoded', data: { color: 'rgba(…)' } } ] },
		{ code: "const tint = 'HSL(210 50% 40%)';", errors: [ { messageId: 'hardcoded', data: { color: 'HSL(…)' } } ] },
		{ code: 'const edge = `2px solid #3858e9`;', errors: [ { messageId: 'hardcoded' } ] },
		{ code: 'const edge = `${ width }px solid oklch(60% 0.2 250)`;', errors: [ { messageId: 'hardcoded' } ] },
		{ code: 'const node = <p className="x" title="#fff">text</p>;', errors: [ { messageId: 'hardcoded' } ] },
		// A token with a colour beside it still has the colour.
		{ code: "const text = 'var(--wpds-color-foreground-content-neutral, #1e1e1e)';", errors: [ { messageId: 'hardcoded', data: { color: '#1e1e1e' } } ] },
	],
} );

tester.run( 'no-inline-styles', rules[ 'no-inline-styles' ], {
	valid: [
		'const node = <div className="patch-diff" />;',
		'const node = <Stack direction="column" gap="md" />;',
		// A prop that is not the element's own `style`.
		'const node = <Terminal styleName="light" />;',
		// A stylesheet is a `style` element, not a `style` on one.
		'const node = <style>{ css }</style>;',
	],
	invalid: [
		{ code: 'const node = <div style={ { display: "flex", gap: 8 } } />;', errors: [ { messageId: 'inline' } ] },
		{ code: 'const node = <Button style={ look }>Save</Button>;', errors: [ { messageId: 'inline' } ] },
		{ code: 'const node = <Text variant="body-sm" style={ {} }>x</Text>;', errors: [ { messageId: 'inline' } ] },
	],
} );

test( 'a hex colour is told from a number that only looks like one by its length', () => {
	// CSS's own lengths: three, four, six and eight digits.
	assert.equal( hardcodedColor( '#abc' ), '#abc' );
	assert.equal( hardcodedColor( '#abcd' ), '#abcd' );
	assert.equal( hardcodedColor( '#abcdef' ), '#abcdef' );
	assert.equal( hardcodedColor( '#abcdef12' ), '#abcdef12' );
	// Five and seven are not colours; a ticket is five today.
	assert.equal( hardcodedColor( '#62281' ), null );
	assert.equal( hardcodedColor( '#abcdef1' ), null );
	// The first colour in a string is the one named.
	assert.equal( hardcodedColor( 'linear-gradient(#fff, rgb(0 0 0))' ), '#fff' );
} );
