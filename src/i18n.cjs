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

/**
 * The catalog for a locale, or null when there is none.
 *
 * Tries the exact locale, then its bare language (`de-DE`, then `de`), as the
 * lowercase slug translate.wordpress.org names it. A file is the JSON that
 * translate.wordpress.org's `jed1x` export writes, and what comes back is its
 * `locale_data.messages`, which is what `setLocaleData` takes.
 *
 * A catalog that cannot be read as one is logged and skipped, so a broken
 * `de-AT.json` still falls back to `de.json`, and the log says why.
 *
 * @param {string}   locale A Chromium locale, as `app.getLocale()` returns it.
 * @param {string}   dir    The directory holding `<locale>.json` files.
 * @param {Function} [log]  Called with a sentence for each catalog skipped as unreadable.
 * @return {Object|null} Jed locale data, or null to keep the English source strings.
 */
function resolveCatalog(locale, dir, log = () => {}) {
	if (typeof locale !== 'string' || !LOCALE_PATTERN.test(locale)) return null;
	const slug = locale.toLowerCase();
	const candidates = [GLOTPRESS_SLUGS[slug] || slug];
	const language = slug.split('-')[0];
	if (language !== candidates[0]) candidates.push(GLOTPRESS_SLUGS[language] || language);
	for (const candidate of candidates) {
		let raw;
		try {
			raw = fs.readFileSync(path.join(dir, `${candidate}.json`), 'utf8');
		} catch {
			continue;
		}
		let messages;
		try {
			messages = JSON.parse(raw)?.locale_data?.messages;
		} catch (e) {
			log(`skipped ${candidate}.json: ${e.message}`);
			continue;
		}
		if (messages) return messages;
		log(`skipped ${candidate}.json: no locale_data.messages`);
	}
	return null;
}

module.exports = { resolveCatalog };
