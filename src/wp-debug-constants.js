// The WordPress debug constants every site this app runs is booted with.
//
// The app already tails each site's build/wp-content/debug.log and streams it to
// the renderer, but nothing ever turned WP_DEBUG_LOG on, so that file did not
// exist and the panel reading it could never show a line. A contributor's
// error_log() went nowhere, notices and deprecation warnings — the output core
// work actually runs on — were invisible, and a fatal was replaced by
// WordPress's recovery screen.
//
// Not configurable, and deliberately so. A wordpress-develop checkout is a
// development environment by definition; nobody sets one up through this app to
// observe production behaviour. A settings panel here would be one more thing to
// find, get wrong, and support at a Contributor Day.
//
// Kept free of Electron and Playground imports so it can be unit-tested: the
// values are the whole of the behaviour, so a test that reads them is a test of
// the feature.

// Booleans, never strings. These are written into the generated wp-config.php as
// PHP literals, and the string "false" is truthy in PHP — the failure mode is a
// constant that reads as disabled everywhere except where it counts.
const WP_DEBUG_CONSTANTS = Object.freeze({
	// Notices, warnings, deprecations and _doing_it_wrong(). Half of what core
	// development is watching for.
	WP_DEBUG: true,

	// Writes them to wp-content/debug.log — the file startWpDebugTail in main.js
	// has been watching all along. Left at WordPress's default path on purpose:
	// the tailer resolves the same one.
	WP_DEBUG_LOG: true,

	// Errors are also printed in the browser. A fatal that shows the file and
	// line on screen is what makes a newcomer understand what happened; the cost
	// is that a notice fired mid-request corrupts REST and AJAX responses that
	// expect clean JSON. Chosen knowingly — the panel alone leaves a blank page
	// and no signal that anywhere is worth looking.
	WP_DEBUG_DISPLAY: true,

	// Serves core's unminified JS and CSS. Without it the scripts in the browser
	// are .min.js and debugging core JavaScript is not possible at all.
	SCRIPT_DEBUG: true,

	// The non-obvious one. WordPress's fatal error handler intercepts a fatal and
	// substitutes "There has been a critical error on this website", which is
	// precisely the screen that hides the error being looked for. Off, a fatal
	// surfaces as itself.
	WP_DISABLE_FATAL_ERROR_HANDLER: true,

	// The one constant here that changes behaviour rather than visibility, and it
	// is here because WP_DEBUG is what made the problem appear: core's automatic
	// updater logs "Automatic updates starting…" / "…complete." only when
	// WP_DEBUG is on, so turning the log on filled the contributor's panel with
	// core's own housekeeping in between their error_log() lines. wp-cron runs it
	// on page loads, so it recurs.
	//
	// Disabled rather than filtered out of the panel, because an automatic
	// updater has nothing to do in a wordpress-develop checkout in the first
	// place: it reaches api.wordpress.org on a conference network, and anything
	// it decided to install would be written over the build/ the contributor is
	// editing and Playground has mounted. Narrower than DISABLE_WP_CRON, which
	// would also stop the scheduled work a contributor may be working on.
	AUTOMATIC_UPDATER_DISABLED: true

	// SAVEQUERIES is left out. It records every query for the whole request and
	// only pays for itself alongside a viewer like Query Monitor, which this app
	// does not install yet.
});

module.exports = { WP_DEBUG_CONSTANTS };
