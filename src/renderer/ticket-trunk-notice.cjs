'use strict';

/**
 * The intentionally limited 1.0 answer when a ticket predates current trunk.
 * Detection is useful; rewriting a contributor's checkout is not required.
 * Missing metadata stays silent because inequality cannot be inferred safely.
 *
 * @param {Object} root0
 * @param {string|number|null} root0.ticketId
 * @param {?string} root0.baseOid
 * @param {?string} root0.trunkOid
 * @return {{title: string, body: string}|null}
 */
function ticketTrunkNotice({ ticketId = null, baseOid = null, trunkOid = null } = {}) {
	if (!ticketId || !baseOid || !trunkOid || baseOid === trunkOid) return null;
	return {
		title: 'Trunk has moved since this ticket started.',
		body: `Newer patches may not apply cleanly. Save a copy of your work, delete this ticket’s work from the site, then link #${ticketId} again to start from the current trunk.`
	};
}

module.exports = { ticketTrunkNotice };
