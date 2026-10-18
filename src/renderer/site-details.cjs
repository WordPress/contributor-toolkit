// What the open site's details say (#556): the facts about the checkout that
// do not change while a contributor works, each a label over a value.
'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');

/**
 * The rows of the details, in order. A row with nothing to say is left out:
 * a site with no recorded creation date has no "Created", and a trunk whose
 * date could not be read has no "Trunk as of".
 *
 * `note` is a second line under the value. The trunk's row has one when the
 * trunk is old, saying how old in words: the banner in the page says what to
 * do about it, and this is where the date is.
 *
 * The path's row is marked `copyable`; the component puts the button that
 * copies it beside it.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.initialized] The first-run setup has finished.
 * @param {string}  [root0.created]     When the site was made, as text, or ''.
 * @param {Object}  [root0.trunk]       From `trunkAgeInfo`.
 * @param {string}  root0.path          Where the checkout is.
 * @param {string}  root0.checkout      The project's name.
 * @param {?string} [root0.phpVersion]  The PHP a server starts on, from the settings (#559), or null while they are not read.
 * @param {?Object} [root0.debug]       `{ wpDebug, scriptDebug }` from the settings, or null likewise.
 * @return {Array<{id: string, label: string, value: string, note?: string, copyable?: boolean}>}
 */
function siteDetailsRows({ initialized = false, created = '', trunk = null, path, checkout, phpVersion = null, debug = null }) {
	const rows = [
		{ id: 'setup', label: __('Setup'), value: initialized ? __('Initialized') : __('Uninitialized') }
	];
	if (created) rows.push({ id: 'created', label: __('Created'), value: created });
	if (trunk && trunk.known) {
		const row = { id: 'trunk', label: __('Trunk as of'), value: trunk.dateLabel };
		if (trunk.stale) {
			// translators: %d: how many days old the site's copy of the WordPress code is.
			row.note = sprintf(_n('%d day old', '%d days old', trunk.ageDays), trunk.ageDays);
		}
		rows.push(row);
	}
	rows.push({ id: 'path', label: __('Local path'), value: path, copyable: true });
	// What the settings hold for every site's server (#559): the PHP it
	// starts on, beside what the checkout is, and the two debug constants
	// that can be off. These are what the next start is given; a server that
	// is running keeps what it started with.
	rows.push({
		id: 'checkout',
		label: __('Checkout'),
		// translators: %1$s: the project a site is a checkout of; %2$s: a PHP version.
		value: phpVersion ? sprintf(__('%1$s · PHP %2$s'), checkout, phpVersion) : checkout
	});
	if (debug) {
		const on = [debug.wpDebug ? 'WP_DEBUG' : null, debug.scriptDebug ? 'SCRIPT_DEBUG' : null].filter(Boolean);
		rows.push({ id: 'debugging', label: __('Debugging'), value: on.length ? on.join(' · ') : __('Off') });
	}
	return rows;
}

module.exports = { siteDetailsRows };
