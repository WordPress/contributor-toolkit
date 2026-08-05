const test = require('node:test');
const assert = require('node:assert/strict');

const { formatErrorChain } = require('../src/error-chain.js');

test('reproduces the Playground boot failure: the real error is in the cause', () => {
	// What @wp-playground/cli throws when a boot fails under `verbosity: 'debug'`:
	// the message is the contents of its debug log, which is usually empty, and
	// the failure that matters is attached as `cause`. Logging `err.stack` alone
	// reported a bare "Error" with no message and nothing to act on.
	const real = new Error( 'Cannot connect to the database' );
	const wrapped = new Error( '', { cause: real } );

	const output = formatErrorChain( wrapped );

	assert.match( output, /Cannot connect to the database/ );
	assert.match( output, /Caused by:/ );
} );

test( 'flags an empty message instead of printing a stack that looks fine', () => {
	const output = formatErrorChain( new Error( '' ) );

	assert.match( output, /\(no message\)/ );
} );

test( 'a plain error is still rendered as its stack', () => {
	const error = new Error( 'boom' );

	const output = formatErrorChain( error );

	assert.equal( output, error.stack );
	assert.doesNotMatch( output, /Caused by:/ );
} );

test( 'walks a chain several levels deep, outermost first', () => {
	const root = new Error( 'root' );
	const middle = new Error( 'middle', { cause: root } );
	const outer = new Error( 'outer', { cause: middle } );

	const output = formatErrorChain( outer );

	assert.ok( output.indexOf( 'outer' ) < output.indexOf( 'middle' ) );
	assert.ok( output.indexOf( 'middle' ) < output.indexOf( 'root' ) );
} );

test( 'handles a cause that is not an Error', () => {
	const output = formatErrorChain( new Error( 'outer', { cause: 'a string reason' } ) );

	assert.match( output, /Caused by: a string reason/ );
} );

test( 'handles non-Error input', () => {
	assert.equal( formatErrorChain( 'just a string' ), 'just a string' );
} );

test( 'stops on a circular cause chain instead of looping forever', () => {
	const a = new Error( 'a' );
	const b = new Error( 'b', { cause: a } );
	a.cause = b;

	const output = formatErrorChain( a );

	assert.match( output, /circular reference/ );
} );

test( 'null and undefined do not throw', () => {
	assert.equal( formatErrorChain( null ), '' );
	assert.equal( formatErrorChain( undefined ), '' );
} );
