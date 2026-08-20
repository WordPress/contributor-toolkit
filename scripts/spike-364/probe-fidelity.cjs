/* eslint-disable -- Spike #364 scaffolding. Thrown away with the branch; not held to the repo's style. */
/**
 * Spike #364 / #351 — do the conflicts a real Git reports agree with the ones
 * the app reports, and with the ones GitHub reports?
 *
 * For each pull request it records three verdicts on the same change:
 *
 *   app    today's two-way apply (src/patch-apply.js) against today's trunk
 *   git    a three-way merge from the real merge base, by the bundled binary
 *   hub    what GitHub says about merging the pull request
 *
 * Throwaway. Needs a checkout of wordpress-develop with full commit history:
 *   git clone --filter=blob:none https://github.com/WordPress/wordpress-develop.git <dir>
 *
 * Run with:  node scripts/spike-364/probe-fidelity.cjs <dir> <pr> [<pr> ...]
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { spawnSync } = require( 'node:child_process' );

const { resolveGitRoot, gitBinary, gitEnv } = require( './git-env.cjs' );
const { applyPatchToDir } = require( '../../src/patch-apply.js' );

const ROOT = resolveGitRoot();
const BIN = gitBinary();
const ENV = gitEnv();

const REPO = 'WordPress/wordpress-develop';

function git( args, cwd ) {
	const r = spawnSync( BIN, args, { cwd, env: ENV, shell: false, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 } );
	return { status: r.status, stdout: ( r.stdout || '' ).trim(), stderr: ( r.stderr || '' ).trim() };
}

function gh( args ) {
	const r = spawnSync( 'gh', args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 } );
	if ( r.status !== 0 ) throw new Error( `gh ${ args.join( ' ' ) }: ${ r.stderr }` );
	return r.stdout;
}

/**
 * `git merge-tree --write-tree` merges in memory, so nothing touches the
 * working tree. Exit 0 is a clean merge, 1 is conflicts; the conflicted paths
 * come back in the informational block after the tree oid.
 */
function gitVerdict( dir, headRef ) {
	const r = git( [ 'merge-tree', '--write-tree', '--name-only', '--merge-base=' + mergeBase( dir, headRef ), 'trunk', headRef ], dir );
	if ( r.status === 0 ) return { clean: true, files: [] };
	if ( r.status !== 1 ) return { error: r.stderr || r.stdout };

	// <oid>\n<conflicted file>\n...\n\n<messages>
	const [ block ] = r.stdout.split( '\n\n' );
	const files = block.split( '\n' ).slice( 1 ).filter( Boolean );
	return { clean: false, files: [ ...new Set( files ) ].sort() };
}

function mergeBase( dir, headRef ) {
	return git( [ 'merge-base', 'trunk', headRef ], dir ).stdout;
}

async function appVerdict( dir, patchText ) {
	const before = git( [ 'status', '--porcelain' ], dir ).stdout;
	if ( before !== '' ) throw new Error( `checkout is dirty before the apply:\n${ before }` );

	const result = await applyPatchToDir( { dir, patchText } );

	const after = git( [ 'status', '--porcelain' ], dir ).stdout;
	if ( result.ok ) {
		// An apply that succeeded has to be undone before the next pull request.
		git( [ 'checkout', '--', '.' ], dir );
		git( [ 'clean', '-fd' ], dir );
	}

	return {
		ok: !! result.ok,
		// `conflicts` carries the paths; `failures` is prose, one sentence per file.
		files: [ ...new Set( ( result.conflicts || [] ).map( ( c ) => c.path ) ) ].sort(),
		failures: ( result.failures || [] ).length,
		error: result.error || null,
		wroteOnFailure: ! result.ok && after !== '',
	};
}

/**
 * The app rewrites Trac-style paths into `src/`; a GitHub diff already has them.
 */
function normalise( files ) {
	return files.map( ( f ) => String( f ).replace( /^[ab]\//, '' ) ).sort();
}

async function main() {
	const [ dir, ...prs ] = process.argv.slice( 2 );
	if ( ! dir || ! prs.length ) {
		throw new Error( 'usage: probe-fidelity.cjs <wordpress-develop dir> <pr> [<pr> ...]' );
	}

	git( [ 'fetch', '--quiet', 'origin', 'trunk' ], dir );
	git( [ 'checkout', '--quiet', 'trunk' ], dir );
	git( [ 'reset', '--hard', '--quiet', 'origin/trunk' ], dir );

	const rows = [];

	for ( const pr of prs ) {
		const meta = JSON.parse( gh( [ 'api', `repos/${ REPO }/pulls/${ pr }` ] ) );
		const ref = `refs/pull/${ pr }/head`;
		const fetched = git( [ 'fetch', '--quiet', 'origin', `${ ref }:${ ref }` ], dir );
		if ( fetched.status !== 0 ) {
			rows.push( { pr, skipped: fetched.stderr } );
			continue;
		}

		let patchText;
		try {
			patchText = gh( [ 'api', `repos/${ REPO }/pulls/${ pr }`, '-H', 'Accept: application/vnd.github.v3.diff' ] );
		} catch ( error ) {
			// GitHub refuses a diff over 300 files. The app hits the same wall, so
			// this is a limit of the route rather than of the comparison.
			rows.push( { pr: Number( pr ), skipped: String( error.message ).slice( 0, 120 ) } );
			console.log( `#${ pr } skipped: diff too large for the API\n` );
			continue;
		}

		const app = await appVerdict( dir, patchText );
		const real = gitVerdict( dir, ref );
		const base = mergeBase( dir, ref );

		rows.push( {
			pr: Number( pr ),
			created: meta.created_at.slice( 0, 10 ),
			title: meta.title.slice( 0, 55 ),
			mergeBase: base.slice( 0, 8 ),
			behind: Number( git( [ 'rev-list', '--count', `${ base }..trunk` ], dir ).stdout ),
			hub: `${ meta.mergeable === null ? 'unknown' : meta.mergeable ? 'mergeable' : 'conflicting' } (${ meta.mergeable_state })`,
			app: app.ok ? 'applies' : `refuses ${ app.failures } file(s): ${ normalise( app.files ).join( ', ' ) || app.error }`,
			git: real.error ? `error: ${ real.error }` : real.clean ? 'merges clean' : `conflicts: ${ normalise( real.files ).join( ', ' ) }`,
			agree: app.ok === ( real.clean === true ),
			wroteOnFailure: app.wroteOnFailure,
		} );

		const row = rows[ rows.length - 1 ];
		console.log(
			`#${ row.pr } (${ row.created }, ${ row.behind } commits behind)  ${ row.title }\n` +
			`   hub: ${ row.hub }\n   app: ${ row.app }\n   git: ${ row.git }\n` +
			`   -> ${ row.agree ? 'AGREE' : 'DISAGREE' }${ row.wroteOnFailure ? '  !! left the tree dirty' : '' }\n`
		);
	}

	const compared = rows.filter( ( r ) => ! r.skipped );
	const agreed = compared.filter( ( r ) => r.agree );
	console.log( `\n${ agreed.length }/${ compared.length } agree on applies-vs-refuses` );
	fs.writeFileSync(
		path.join( require( 'node:os' ).tmpdir(), 'spike364-fidelity.json' ),
		JSON.stringify( rows, null, 2 )
	);
}

main().catch( ( error ) => {
	console.error( error );
	process.exit( 1 );
} );
