'use strict';

/**
 * What the settings dialog says where it has a decision to make (#559).
 *
 * Kept as a pure module so it can be unit tested without a DOM, as the other
 * `src/renderer/*.cjs` modules are; the dialog's component renders what this
 * returns.
 */

const { __, sprintf } = require('@wordpress/i18n');

/**
 * The line under "GitHub": whose account the app holds, or why none.
 *
 * `account` is what `github:account` answers, or null while it has not: the
 * dialog asks when it opens, and says so until the answer is there rather
 * than saying "not signed in" of an account it has not read yet.
 *
 * @param {?{login: ?string, configured: boolean}} account
 * @return {{text: string, canSignOut: boolean}} The sentence, and whether there is an account to sign out of.
 */
function githubAccountLine(account) {
	if (!account) return { text: __('Reading…'), canSignOut: false };
	if (!account.configured) return { text: __('Sign-in is not set up in this build.'), canSignOut: false };
	if (account.login) {
		// translators: %s: a GitHub username.
		return { text: sprintf(__('Signed in as %s.'), account.login), canSignOut: true };
	}
	return { text: __('Not signed in. The app asks you to sign in when you open a pull request.'), canSignOut: false };
}

/**
 * What stands in place of the folder new sites go in, when there is none to
 * show: that the settings have not been read yet, or that none is set.
 *
 * @param {?Object} settings What main answered, or null while it has not.
 * @return {string}
 */
function newSiteLocationNote(settings) {
	if (!settings) return __('Reading…');
	return __('Not set: the create-site dialog asks each time.');
}

module.exports = { githubAccountLine, newSiteLocationNote };
