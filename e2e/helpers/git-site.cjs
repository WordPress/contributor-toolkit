'use strict';

// A site the app will treat as a finished, working checkout — built as a real Git
// repository on disk, because the flows these journeys cover are Git operations
// and a stub would only prove the app can talk to a stub.
//
// The shape mirrors the fixture the integration suite uses
// (test/ticket-branches.integration.test.cjs), one level up: same trunk branch,
// same three tracked files, and the same gitignored `node_modules` standing in for
// the expensive substrate. That substrate is the point of half these assertions —
// reinstalling it costs a contributor minutes, so a ticket switch that quietly
// removes it is a regression the app would never report.
//
// Small enough that every test builds its own from scratch: nothing here is shared
// between tests, so no journey can be affected by the order it runs in.

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const git = require( 'isomorphic-git' );

const TRUNK = 'trunk';
const AUTHOR = { name: 'e2e', email: 'e2e@example.test' };

/**
 * The substrate: gitignored, expensive to rebuild, and must survive everything.
 * A journey asserts on this file's contents, not merely on the directory existing,
 * so a checkout that deletes and recreates it still counts as a loss.
 */
const SUBSTRATE = path.join( 'node_modules', 'react', 'index.js' );
const SUBSTRATE_CONTENT = 'expensive to reinstall\n';

const TRUNK_FILES = {
	'.gitignore': 'node_modules/\nbuild/\n',
	'wp-login.php': '<?php // trunk\n',
	'doomed.php': '<?php // to be deleted\n',
};

/**
 * Creates a repository the app will list, open, and consider ready to work in.
 *
 * @param {Object} session         A Session from ./app.cjs. The directory is
 *                                 registered with it, so it is removed after the
 *                                 app has stopped — doing it earlier fails on
 *                                 Windows, where a directory with open handles
 *                                 cannot be deleted.
 * @param {Object} [options]
 * @param {string} [options.label] The name shown in the sidebar.
 * @return {Promise<{dir: string, baseOid: string, settings: Object}>}
 */
async function makeSite( session, { label = 'e2e-site' } = {} ) {
	const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );

	await git.init( { fs, dir, defaultBranch: TRUNK } );
	for ( const [ file, content ] of Object.entries( TRUNK_FILES ) ) {
		fs.writeFileSync( path.join( dir, file ), content );
	}
	await git.add( { fs, dir, filepath: Object.keys( TRUNK_FILES ) } );
	const baseOid = await git.commit( { fs, dir, message: 'trunk', author: AUTHOR } );

	fs.mkdirSync( path.join( dir, 'node_modules', 'react' ), { recursive: true } );
	fs.writeFileSync( path.join( dir, SUBSTRATE ), SUBSTRATE_CONTENT );

	// What `site:status` reads to decide the site is installed and built, so the
	// app opens the working views instead of the setup wizard. The directory is
	// what is checked, not its contents.
	fs.mkdirSync( path.join( dir, 'build', 'wp-includes', 'js', 'dist' ), { recursive: true } );

	return { dir, baseOid, settings: settingsFor( dir, label ) };
}

/**
 * The store contents that make the app open on this site with nothing in the way.
 *
 * Dates are relative to now rather than fixed: the staleness dot appears once a
 * snapshot is a fortnight old and joins the sidebar entry's accessible name when
 * it does, so a hardcoded date would quietly change what the selectors match,
 * months after anyone last read this file.
 *
 * @param {string} dir
 * @param {string} label
 * @return {Object}
 */
function settingsFor( dir, label ) {
	const yesterday = new Date( Date.now() - 24 * 60 * 60 * 1000 ).toISOString();
	return {
		sites: [ dir ],
		siteMeta: {
			[ dir ]: {
				initialized: true,
				createdAt: yesterday,
				label,
				trunkDate: yesterday,
				skipInitWizard: true,
			},
		},
		preferences: {},
	};
}

/**
 * @param {string} dir
 * @param {string} file
 * @return {string}
 */
const read = ( dir, file ) => fs.readFileSync( path.join( dir, file ), 'utf8' );

/**
 * @param {string} dir
 * @param {string} file
 * @return {boolean}
 */
const exists = ( dir, file ) => fs.existsSync( path.join( dir, file ) );

/**
 * @param {string} dir
 * @param {string} file
 * @param {string} content
 */
const write = ( dir, file, content ) => fs.writeFileSync( path.join( dir, file ), content );

/**
 * The branches that exist in the repository, read from disk rather than from the
 * app — so an assertion about a branch is about Git, not about what the app
 * believes.
 *
 * @param {string} dir
 * @return {Promise<string[]>}
 */
const branches = ( dir ) => git.listBranches( { fs, dir } );

/**
 * @param {string} dir
 * @return {Promise<string>}
 */
const currentBranch = ( dir ) => git.currentBranch( { fs, dir, fullname: false } );

module.exports = {
	makeSite,
	settingsFor,
	read,
	write,
	exists,
	branches,
	currentBranch,
	TRUNK,
	SUBSTRATE,
	SUBSTRATE_CONTENT,
};
