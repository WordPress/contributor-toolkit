'use strict';

/**
 * The intentionally limited 1.0 answer when a ticket predates current trunk.
 * Detection is useful; rewriting a contributor's checkout is not required.
 * The main process performs the recorded-base comparison. Unknown stays silent.
 *
 * @param {Object}             root0
 * @param {string|number|null} root0.ticketId Ticket currently linked.
 * @param {boolean}            root0.behind   Whether its base differs from trunk.
 * @return {{title: string, body: string}|null}
 */
function ticketTrunkNotice({ ticketId = null, behind = false } = {}) {
	if (!ticketId || !behind) return null;
	return {
		title: 'Trunk has moved since this ticket started.',
		body: `Newer patches may not apply cleanly. Save a copy of your work, unlink the ticket, delete its work from the site, then link #${ticketId} again to start from the current trunk.`
	};
}

module.exports = { ticketTrunkNotice };
