const path = require( 'node:path' );
const { defineConfig } = require( '@playwright/test' );
const defaults = require( '../../playwright.config.js' );

// Separate from both default projects: a full network install is opt-in only.
module.exports = defineConfig( defaults, {
	// One budget for the whole setup: clone, install and build, the server, and on
	// Gutenberg a watch that redoes the build before it watches. Leaves the job's
	// 60-minute limit room for npm ci, the renderer build and the upload.
	timeout: 50 * 60_000,
	retries: 0,
	outputDir: path.join( __dirname, '../../test-results/real-setup' ),
	reporter: [ [ 'list' ], [ 'html', {
		open: 'never',
		outputFolder: path.join( __dirname, '../../playwright-report/real-setup' ),
	} ] ],
	projects: [ { name: 'real-setup', testDir: path.join( __dirname, 'real-setup' ) } ],
} );
