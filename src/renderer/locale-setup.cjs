'use strict';

const { isPseudoLocale, pseudoLocalize } = require('./pseudo-locale.cjs');

const TRANSLATION_FILTERS = ['i18n.gettext', 'i18n.gettext_with_context', 'i18n.ngettext', 'i18n.ngettext_with_context'];

/**
 * Applies the locale main sent, and returns the language the page is in.
 *
 * That is the locale only when something translates the page: a catalog, or
 * the pseudo-locale. A locale with no catalog leaves the page in English, and
 * `<html lang>` has to say so; a screen reader picks its voice from it, and CSS
 * upper-cases by it (Turkish turns "Site location" into "SİTE LOCATİON").
 *
 * Pure apart from the two functions it is handed, so `node --test` covers it
 * without a DOM: the renderer passes `@wordpress/i18n`'s `setLocaleData` and
 * `@wordpress/hooks`' `addFilter`.
 *
 * @param {{locale?: string, data?: Object|null}|undefined} reply              What `api.getLocale()` resolved to.
 * @param {Object}                                          deps
 * @param {Function}                                        deps.setLocaleData
 * @param {Function}                                        deps.addFilter
 * @return {string} The value for `<html lang>`.
 */
function applyLocale(reply, { setLocaleData, addFilter }) {
	const locale = reply && typeof reply.locale === 'string' ? reply.locale : '';
	if (isPseudoLocale(locale)) {
		// The translation filters, not a catalog: the pseudo-locale has to cover
		// every string, including ones no catalog has heard of yet.
		for (const hook of TRANSLATION_FILTERS) {
			addFilter(hook, 'contributor-toolkit/pseudo-locale', (translation) => pseudoLocalize(translation));
		}
		return locale;
	}
	if (locale && reply.data) {
		setLocaleData(reply.data);
		return locale;
	}
	return 'en';
}

/**
 * The page's text direction, `rtl` or `ltr`, as the loaded catalog says.
 *
 * WordPress's own convention: a right-to-left locale translates the string
 * `ltr`, in the context `text direction`, to `rtl`. Calling `_x` with that
 * literal here is also what puts the string in the .pot, so the translators
 * for Arabic, Hebrew or Persian can set it.
 *
 * @param {Function} _x `@wordpress/i18n`'s `_x`, after the locale is applied.
 * @return {string} The value for `<html dir>`.
 */
function textDirection(_x) {
	return _x('ltr', 'text direction') === 'rtl' ? 'rtl' : 'ltr';
}

module.exports = { applyLocale, textDirection };
