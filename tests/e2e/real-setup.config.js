const path = require( 'node:path' );
const { defineConfig } = require( '@playwright/test' );
const defaults = require( '../../playwright.config.js' );

// Separate from both default projects: a full network install is opt-in only.
module.exports = defineConfig( defaults, {
	// One budget for the whole setup: clone, install and build, the server, and on
	// Gutenberg a watch that redoes the build before it watches. The hosted runners'
	// speed varies a lot from day to day, and this proves the setup works, not
	// that it is fast. Leaves the job's 120-minute limit room for npm ci, the
	// renderer build and the upload.
	timeout: 110 * 60_000,
	retries: 0,
	outputDir: path.join( __dirname, '../../test-results/real-setup' ),
	reporter: [ [ 'list' ], [ 'html', {
		open: 'never',
		outputFolder: path.join( __dirname, '../../playwright-report/real-setup' ),
	} ] ],
	projects: [ { name: 'real-setup', testDir: path.join( __dirname, 'real-setup' ) } ],
} );
