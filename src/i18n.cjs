'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Which translation catalog a locale loads.
 *
 * Free of Electron, so `node --test` covers it directly. Main asks it for the
 * catalog and hands the result to the renderer, which gives it to
 * `@wordpress/i18n`'s `setLocaleData`. The pseudo-locale lives beside the
 * renderer, in renderer/pseudo-locale.cjs, since it needs no file.
 */

// The shape of a Chromium locale (`de`, `pt-BR`, `zh-Hant-TW`). Anything else is
// refused before it reaches a file path, so a locale can never name a file
// outside the catalog directory.
const LOCALE_PATTERN = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

// Catalogs are named by translate.wordpress.org's locale slug, which is
// lowercase (`pt-br`, `zh-tw`) and differs from Chromium's name in one case.
// Checked against every locale Electron ships: the rest match once lowercased,
// or through the bare-language fallback (`pt-PT` to `pt`, `es-419` to `es`).
const GLOTPRESS_SLUGS = { fil: 'tl' };

// Every locale `app.getLocale()` can return: the ones Electron ships resources
// for. Chromium falls back to one of these for any other OS language, so a
// catalog no locale here leads to is never loaded. Kept in step with Electron
// by tests/unit/i18n.test.cjs, which reads the list from the installed build.
const ELECTRON_LOCALES = [
	'af', 'am', 'ar', 'bg', 'bn', 'ca', 'cs', 'da', 'de', 'el', 'en-GB', 'en-US', 'es', 'es-419',
	'et', 'fa', 'fi', 'fil', 'fr', 'gu', 'he', 'hi', 'hr', 'hu', 'id', 'it', 'ja', 'kn', 'ko',
	'lt', 'lv', 'ml', 'mr', 'ms', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'ro', 'ru', 'sk', 'sl',
	'sr', 'sv', 'sw', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'zh-CN', 'zh-TW'
];

/**
 * The catalog files a locale tries, in order: its own slug, then its bare
 * language's (`pt-BR` tries `pt-br`, then `pt`).
 *
 * @param {string} locale A Chromium locale, as `app.getLocale()` returns it.
 * @return {string[]} translate.wordpress.org slugs, without `.json`; empty for anything that is not a locale.
 */
function catalogCandidates(locale) {
	if (typeof locale !== 'string' || !LOCALE_PATTERN.test(locale)) return [];
	const slug = locale.toLowerCase();
	const language = slug.split('-')[0];
	const candidates = [GLOTPRESS_SLUGS[slug] || slug, GLOTPRESS_SLUGS[language] || language];
	return [...new Set(candidates)];
}

/**
 * Every translate.wordpress.org slug the app can load a catalog from.
 *
 * @return {Set<string>}
 */
function reachableSlugs() {
	return new Set(ELECTRON_LOCALES.flatMap(catalogCandidates));
}

/**
 * The catalog for a locale, or null when there is none.
 *
 * Tries each of `catalogCandidates(locale)`. A file is the JSON that
 * translate.wordpress.org's `jed1x` export writes, and what comes back is its
 * `locale_data.messages`, which is what `setLocaleData` takes.
 *
 * A catalog that cannot be read as one is logged and skipped, so a broken
 * `de-at.json` still falls back to `de.json`, and the log says why.
 *
 * @param {string}   locale A Chromium locale, as `app.getLocale()` returns it.
 * @param {string}   dir    The directory holding `<slug>.json` files.
 * @param {Function} [log]  Called with a sentence for each catalog skipped as unreadable.
 * @return {Promise<Object|null>} Jed locale data, or null to keep the English source strings.
 */
async function resolveCatalog(locale, dir, log = () => {}) {
	for (const candidate of catalogCandidates(locale)) {
		let raw;
		try {
			raw = await fs.promises.readFile(path.join(dir, `${candidate}.json`), 'utf8');
		} catch (e) {
			// No file for this locale is the normal case; anything else is a catalog we shipped and cannot read.
			if (e.code !== 'ENOENT') log(`skipped ${candidate}.json: ${e.message}`);
			continue;
		}
		let messages;
		try {
			messages = JSON.parse(raw)?.locale_data?.messages;
		} catch (e) {
			log(`skipped ${candidate}.json: ${e.message}`);
			continue;
		}
		if (messages && typeof messages === 'object' && !Array.isArray(messages)) return messages;
		log(`skipped ${candidate}.json: no locale_data.messages`);
	}
	return null;
}

module.exports = { resolveCatalog, catalogCandidates, reachableSlugs, ELECTRON_LOCALES };
