'use strict';

// The debug constants are the whole of the feature: there is no UI, no setting
// and no branch, so a test that reads the values is a test of the behaviour.
//
// What these guard against is a silent regression. The app has always tailed
// build/wp-content/debug.log and streamed it to the renderer, and for as long as
// WP_DEBUG_LOG went unset that file did not exist and the panel could not show a
// line — a whole feature wired end to end and structurally unable to produce
// output, with nothing failing anywhere. Dropping a constant here puts it back
// in exactly that state.

const test = require('node:test');
const assert = require('node:assert/strict');

const { WP_DEBUG_CONSTANTS } = require('../../src/wp-debug-constants');

test('the debug constants are exactly the six the app boots a site with', () => {
	assert.deepStrictEqual(Object.keys(WP_DEBUG_CONSTANTS).sort(), [
		'AUTOMATIC_UPDATER_DISABLED',
		'SCRIPT_DEBUG',
		'WP_DEBUG',
		'WP_DEBUG_DISPLAY',
		'WP_DEBUG_LOG',
		'WP_DISABLE_FATAL_ERROR_HANDLER'
	]);
});

test('WP_DEBUG_LOG is on, or the debug.log panel has nothing to read', () => {
	assert.strictEqual(WP_DEBUG_CONSTANTS.WP_DEBUG, true);
	assert.strictEqual(WP_DEBUG_CONSTANTS.WP_DEBUG_LOG, true);
});

test('SCRIPT_DEBUG is on, so core JS and CSS are served unminified', () => {
	assert.strictEqual(WP_DEBUG_CONSTANTS.SCRIPT_DEBUG, true);
});

// The non-obvious one, and the easiest to remove as apparent noise. With
// WordPress's fatal error handler in place a fatal is replaced by "There has
// been a critical error on this website" — the screen that hides the error
// being looked for.
test('the fatal error handler is disabled, so a fatal surfaces as itself', () => {
	assert.strictEqual(WP_DEBUG_CONSTANTS.WP_DISABLE_FATAL_ERROR_HANDLER, true);
});

// The only constant here that changes behaviour rather than visibility, and the
// only one whose reason is a consequence of the others: core's updater logs
// "Automatic updates starting…" only under WP_DEBUG, so turning the log on is
// what put core's housekeeping in the contributor's panel. Verified against a
// real site — those lines appeared between the contributor's own error_log()
// output on every page load, because wp-cron runs the updater.
test('the automatic updater is disabled', () => {
	assert.strictEqual(WP_DEBUG_CONSTANTS.AUTOMATIC_UPDATER_DISABLED, true);
});

// The narrower constant on purpose. DISABLE_WP_CRON would also silence it, and
// would stop the scheduled work a contributor may be there to debug.
test('wp-cron itself is left alone', () => {
	assert.strictEqual('DISABLE_WP_CRON' in WP_DEBUG_CONSTANTS, false);
});

// Left out deliberately: it records every query for the whole request and only
// pays for itself alongside a viewer, which this app does not install. Asserted
// so adding it is a decision rather than a drive-by.
test('SAVEQUERIES is not set', () => {
	assert.strictEqual('SAVEQUERIES' in WP_DEBUG_CONSTANTS, false);
});

// These are written into the generated wp-config.php as PHP literals, and the
// string "false" is truthy in PHP — a constant defined as a string reads as
// enabled everywhere except where it matters. The SMTP constants beside them in
// the blueprint already go through Number() and === 'true' for the same reason.
test('every value is a real boolean, not a string', () => {
	for (const [name, value] of Object.entries(WP_DEBUG_CONSTANTS)) {
		assert.strictEqual(typeof value, 'boolean', `${name} must be a boolean`);
	}
});

// Shared, frozen, and spread into a blueprint object that Playground is free to
// do what it likes with. A caller that mutated it would change the constants of
// every server started afterwards in the same process.
test('the exported object cannot be mutated by a caller', () => {
	assert.throws(() => { WP_DEBUG_CONSTANTS.WP_DEBUG = false; }, TypeError);
	assert.strictEqual(WP_DEBUG_CONSTANTS.WP_DEBUG, true);
});
