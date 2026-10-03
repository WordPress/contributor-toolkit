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
 * @return {Array<{id: string, label: string, value: string, note?: string, copyable?: boolean}>}
 */
function siteDetailsRows({ initialized = false, created = '', trunk = null, path, checkout }) {
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
	rows.push({ id: 'checkout', label: __('Checkout'), value: checkout });
	return rows;
}

module.exports = { siteDetailsRows };
