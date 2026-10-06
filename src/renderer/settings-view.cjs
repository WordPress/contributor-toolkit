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

// What the language control's entry for no choice is called.
const SYSTEM_LANGUAGE = 'system';

/**
 * The entries of the language control: the system's language first, then
 * the languages the app has, and the one the window started in where it is
 * none of them (a catalog that is gone since, or a locale typed into the
 * store), so that the control shows what is set rather than nothing.
 *
 * @param {?Array<{tag: string, label: string}>} languages What main offers, or null while it has not answered.
 * @param {?string}                              locale    The language the window started in, or null for the system's.
 * @return {Array<{value: string, label: string}>}
 */
function languageItems(languages, locale) {
	const items = [{ value: SYSTEM_LANGUAGE, label: __('Your system’s language') }];
	for (const language of languages || []) items.push({ value: language.tag, label: language.label });
	if (locale && !items.some((item) => item.value === locale)) items.push({ value: locale, label: locale });
	return items;
}

/**
 * What a choice in the language control is kept as: the system's entry is
 * kept as no choice.
 *
 * @param {string} choice The value of the entry chosen.
 * @return {?string}
 */
function languageValue(choice) {
	return choice === SYSTEM_LANGUAGE ? null : choice;
}

/**
 * Whether the language the window is in is no longer the one set, so that
 * the dialog offers the relaunch that applies it.
 *
 * @param {?Object} settings What main holds now.
 * @param {?Object} loaded   What main held when the window read the settings.
 * @return {boolean}
 */
function languageChanged(settings, loaded) {
	if (!settings || !loaded) return false;
	return (settings.locale || null) !== (loaded.locale || null);
}

/**
 * Which PHP version the control shows as chosen, and what it says of one
 * that is set but not among the versions the build has: a release can bump
 * the bundled Playground past a version a contributor chose. The server
 * then starts on the fallback, and the control shows that and says why,
 * rather than showing a choice that is not what runs.
 *
 * @param {Object}  root0
 * @param {?Array}  root0.versions What the build has, or null while it has not answered.
 * @param {?string} root0.fallback What a server starts on when nothing is chosen, or null likewise.
 * @param {?string} root0.stored   What is set, or null for the fallback.
 * @return {{value: ?string, note: string}} The version to show as chosen, and a note or ''.
 */
function phpVersionChoice({ versions, fallback, stored }) {
	if (!versions || !fallback) return { value: null, note: '' };
	if (!stored || versions.includes(stored)) return { value: stored || fallback, note: '' };
	return {
		value: fallback,
		// translators: %1$s: a PHP version that was chosen; %2$s: the PHP version used instead.
		note: sprintf(__('PHP %1$s was chosen, but this version of the app does not have it; servers start on PHP %2$s.'), stored, fallback)
	};
}

/**
 * The entries of the control for what happens on quit (#559). Two and not
 * the prototype's three: its "keep sites running" would leave children past
 * the quit, which the quit sweep exists to end.
 *
 * @return {Array<{value: string, label: string}>}
 */
function quitItems() {
	return [
		{ value: 'stop', label: __('Stop them') },
		{ value: 'restart', label: __('Stop them, and start them again next time') }
	];
}

/**
 * The entries of the theme control (#560): light, dark, or the operating
 * system's. The prototype's fourth, a custom pair of colours, is not offered.
 *
 * @return {Array<{value: string, label: string}>}
 */
function themeItems() {
	return [
		{ value: 'light', label: __('Light') },
		{ value: 'dark', label: __('Dark') },
		{ value: 'system', label: __('System') }
	];
}

/**
 * What the next launch starts for a site, from the list the last quit left:
 * its server, its watch, both, or nothing.
 *
 * @param {?{servers: string[], watches: string[]}} resume   The list, or null while it has not been read.
 * @param {string}                                  sitePath
 * @return {?{server: boolean, watch: boolean}} What to start, or null for nothing.
 */
function resumeFor(resume, sitePath) {
	if (!resume) return null;
	const server = (resume.servers || []).includes(sitePath);
	const watch = (resume.watches || []).includes(sitePath);
	return server || watch ? { server, watch } : null;
}

module.exports = { githubAccountLine, newSiteLocationNote, languageItems, languageValue, languageChanged, phpVersionChoice, quitItems, themeItems, resumeFor, SYSTEM_LANGUAGE };
