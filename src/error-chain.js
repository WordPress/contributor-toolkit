// Renders an error together with everything it was caused by.
//
// Node's default `err.stack` shows only the outermost error. That is enough for
// most failures, but not for the Playground CLI: when it boots WordPress with
// `verbosity: 'debug'` and the boot fails, it re-throws as
//
//     new Error(<contents of its debug log>, { cause: originalError })
//
// and that debug log is frequently empty. Printing the stack alone then puts a
// bare `Error` with no message in the app log while the actual failure sits
// unread in `cause`, which is the difference between a report someone can act
// on and one nobody can.

// Bounded so a self-referential or absurdly deep chain can't hang the logger.
const MAX_DEPTH = 10;

function describe( error ) {
	if ( error instanceof Error ) {
		// An Error with an empty message still stacks as "Error\n    at ...",
		// so the stack alone reads as if nothing went wrong. Say so explicitly.
		if ( ! error.message ) {
			return `${ error.name || 'Error' }: (no message)\n${ error.stack || '' }`.trimEnd();
		}
		return error.stack || `${ error.name }: ${ error.message }`;
	}
	return String( error );
}

function formatErrorChain( error ) {
	const parts = [];
	const seen = new Set();
	let current = error;

	while ( current !== undefined && current !== null && parts.length < MAX_DEPTH ) {
		if ( typeof current === 'object' ) {
			if ( seen.has( current ) ) {
				parts.push( 'Caused by: <circular reference>' );
				break;
			}
			seen.add( current );
		}

		const text = describe( current );
		parts.push( parts.length === 0 ? text : `Caused by: ${ text }` );

		current = typeof current === 'object' ? current.cause : undefined;
	}

	return parts.join( '\n' );
}

module.exports = { formatErrorChain };
