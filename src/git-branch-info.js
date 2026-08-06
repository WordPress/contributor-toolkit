// Reads the current branch name for a site, so the UI can show which branch a
// contributor is working on.

'use strict';

const { execSync } = require( 'node:child_process' );
const fs = require( 'node:fs' );

// Returns the checked-out branch for a site directory, or null when the
// directory is not a repository yet.
function readBranch( sitePath ) {
	if ( ! fs.existsSync( sitePath + '/.git' ) ) {
		return null;
	}

	const head = fs.readFileSync( sitePath + '/.git/HEAD', 'utf8' );
	const out = execSync( 'git -C ' + sitePath + ' rev-parse --abbrev-ref HEAD', {
		shell: true,
		encoding: 'utf8',
	} );

	return { branch: out.trim(), raw: head.trim() };
}

module.exports = { readBranch };
