'use strict';

/**
 * Whether a window that has just opened offers the create-site dialog (#730).
 *
 * An empty window with a "Create site" button nobody knew the meaning of was
 * where newcomers stopped, so a window that opens with no site in it opens
 * the dialog. The offer is an edge, consumed once per window: closing the
 * dialog, or deleting the last site later, leaves the empty state. It is
 * decided only once both reads have answered: the site list, which is empty
 * for everyone until then, and the settings, since the dialog takes its
 * folder from them as it opens (#559). Kept as a pure module so `node --test`
 * covers the decision; the window keeps the flag and the call.
 *
 * @param {Object}  root0
 * @param {boolean} root0.offered     The offer has been consumed in this window.
 * @param {boolean} root0.sitesLoaded The first read of the site list has answered.
 * @param {?Object} root0.settings    The settings, or null until read.
 * @param {number}  root0.siteCount   How many sites the list has.
 * @return {{consume: boolean, open: boolean}} Whether to consume the offer, and whether to open the dialog.
 */
function launchCreateOffer({ offered, sitesLoaded, settings, siteCount }) {
	if (offered || !sitesLoaded || !settings) return { consume: false, open: false };
	return { consume: true, open: siteCount === 0 };
}

module.exports = { launchCreateOffer };
