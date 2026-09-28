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

/**
 * The catalog for a locale, or null when there is none.
 *
 * Tries the exact locale, then its bare language (`de-DE`, then `de`). A file is
 * the JSON `wp i18n make-json` writes, and what comes back is its
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
	const candidates = [locale];
	const language = locale.split('-')[0];
	if (language !== locale) candidates.push(language);
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
