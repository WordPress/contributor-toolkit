'use strict';

/**
 * What the panel knows about the GitHub account it is acting for (#167).
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM (same convention as update-plan.cjs and trac-ticket.cjs).
 */

/**
 * The account the panel should hold after signing in, signing out, or having an
 * authorization revoked under it.
 *
 * Every one of those replaces the account wholesale, and the test mode used to
 * go with it (#197): it is reported alongside the login but it does not belong
 * to it — it comes from an env switch the main process reads once, so it is
 * true for the whole run whoever is signed in. Losing it meant the card stopped
 * saying "dry run" at exactly the point the button could push something, and
 * the button went back to promising a pull request it would not open.
 *
 * An explicit `testMode` on the incoming account still wins; only an absent one
 * is filled in from what was already known.
 *
 * @param {Object} [previous] The account the panel holds now.
 * @param {Object} next       The account it is moving to.
 * @return {Object}
 */
function carryTestMode(previous, next) {
	const account = { ...next };
	if (account.testMode === undefined && previous && previous.testMode !== undefined) {
		account.testMode = previous.testMode;
	}
	return account;
}

module.exports = { carryTestMode };
