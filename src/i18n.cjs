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

// Catalogs are named by translate.wordpress.org's locale slug, which is
// lowercase (`pt-br`, `zh-tw`) and is not always the tag an OS reports: 32
// slugs use a three-letter code for a language that has a two-letter one
// (`bel`, `zul`), and Filipino is `tl` where an OS says `fil`.
// `Intl.getCanonicalLocales` maps all of those. Valencian is the one it cannot:
// `ca-val` is not a language tag at all.
const SLUG_TAGS = { 'ca-val': 'ca-ES-valencia' };

// A language, then optionally a script and a region: the shape of a tag an OS
// language list reports. `pirate` and `art-xemoji` are slugs no OS reports.
const OS_TAG_PATTERN = /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?$/;

function canonicalTag(tag) {
	try {
		return Intl.getCanonicalLocales(tag)[0].toLowerCase();
	} catch {
		return null;
	}
}

/**
 * The lowercase language tag an OS reports for a translate.wordpress.org slug.
 *
 * @param {string} slug A translate.wordpress.org locale slug, such as `es-mx` or `bel`.
 * @return {string|null} The tag (`es-mx`, `be`), or null for a slug the app cannot select.
 */
function slugTag(slug) {
	if (Object.hasOwn(SLUG_TAGS, slug)) return SLUG_TAGS[slug].toLowerCase();
	const tag = canonicalTag(slug);
	return tag && OS_TAG_PATTERN.test(tag) ? tag : null;
}

/**
 * The tags a locale tries, in order: itself, then its language and region,
 * then for a tag with a script its script's usual region, then its bare
 * language. macOS adds the user's region to a language that names none, so
 * Simplified Chinese in the US is `zh-Hans-US`, and translate.wordpress.org has
 * no bare `zh`: `zh-Hans-US` tries `zh-hans-us`, `zh-us`, `zh-cn`, `zh`.
 *
 * @param {string} locale A language tag, from the OS or `--lang`.
 * @return {string[]} Lowercase canonical tags; empty for anything that is not a tag.
 */
function catalogCandidates(locale) {
	const tag = typeof locale === 'string' && canonicalTag(locale);
	if (!tag) return [];
	const { language, script, region } = new Intl.Locale(tag);
	const scriptRegion = script && new Intl.Locale(`${language}-${script}`).maximize().region;
	const candidates = [tag, region && `${language}-${region}`, scriptRegion && `${language}-${scriptRegion}`, language];
	return [...new Set(candidates.filter(Boolean).map((candidate) => candidate.toLowerCase()))];
}

// Each catalog in `dir` by the tag that selects it.
async function catalogsByTag(dir, log) {
	let names;
	try {
		names = await fs.promises.readdir(dir);
	} catch (e) {
		log(`no catalogs read: ${e.message}`);
		return new Map();
	}
	return catalogsFromNames(names);
}

/**
 * Each catalog among `names` by the tag that selects it. A slug that is its
 * own tag wins a tie, whichever order the names come in: `bcc` and `bal` both
 * canonicalize to `bal`.
 *
 * @param {string[]} names File names in the catalog directory.
 * @return {Map<string, string>} Lowercase tag to slug.
 */
function catalogsFromNames(names) {
	const byTag = new Map();
	for (const name of names) {
		if (!name.endsWith('.json')) continue;
		const slug = name.slice(0, -'.json'.length);
		const tag = slugTag(slug);
		if (tag && (!byTag.has(tag) || tag === slug)) byTag.set(tag, slug);
	}
	return byTag;
}

/**
 * The catalog for the first locale that has one, or null when there is none.
 *
 * Walks `locales` in order, trying each of `catalogCandidates(locale)`. An
 * English locale with no catalog of its own ends the walk: English is the
 * source language, so someone who put it before German wants English.
 *
 * A file is the JSON that translate.wordpress.org's `jed1x` export writes, and
 * the messages are its `locale_data.messages`, which is what `setLocaleData`
 * takes. A catalog that cannot be read as one is logged and skipped, so a
 * broken `de-at.json` still falls back to `de.json`, and the log says why.
 *
 * @param {string|string[]} locales Language tags in order of preference.
 * @param {string}          dir     The directory holding `<slug>.json` files.
 * @param {Function}        [log]   Called with a sentence for each catalog skipped as unreadable.
 * @return {Promise<{locale: string, messages: Object}|null>} The locale that matched and its Jed locale data, or null to keep the English source strings.
 */
async function resolveCatalog(locales, dir, log = () => {}) {
	const byTag = await catalogsByTag(dir, log);
	for (const locale of [].concat(locales)) {
		const candidates = catalogCandidates(locale);
		for (const candidate of candidates) {
			const slug = byTag.get(candidate);
			if (!slug) continue;
			let raw;
			try {
				raw = await fs.promises.readFile(path.join(dir, `${slug}.json`), 'utf8');
			} catch (e) {
				log(`skipped ${slug}.json: ${e.message}`);
				continue;
			}
			let messages;
			try {
				messages = JSON.parse(raw)?.locale_data?.messages;
			} catch (e) {
				log(`skipped ${slug}.json: ${e.message}`);
				continue;
			}
			if (messages && typeof messages === 'object' && !Array.isArray(messages)) return { locale, messages };
			log(`skipped ${slug}.json: no locale_data.messages`);
		}
		if (candidates.at(-1) === 'en') return null;
	}
	return null;
}

/**
 * The languages the app can be asked to show (#559): English, which is the
 * source, and one for each catalog among `names`, each named in itself
 * ("Deutsch", "Português do Brasil") so that someone looking for their own
 * finds it whatever the app is showing. Sorted by that name.
 *
 * A tag with no name of its own in the ICU data is shown as the tag. The
 * slugs no operating system reports (`pirate`, `art-xemoji`) are not here,
 * as they are not selectable from the OS list either.
 *
 * @param {string[]} names File names in the catalog directory.
 * @return {Array<{tag: string, label: string}>}
 */
function languageChoices(names) {
	const choices = [{ tag: 'en', label: 'English' }];
	for (const tag of catalogsFromNames(names).keys()) {
		if (tag === 'en') continue;
		let label = tag;
		try {
			// ICU writes some names as they are mid-sentence ("português");
			// a list's entries are written as its first word.
			const named = new Intl.DisplayNames([tag], { type: 'language' }).of(tag) || tag;
			label = named.charAt(0).toLocaleUpperCase(tag) + named.slice(1);
		} catch {}
		choices.push({ tag, label });
	}
	return choices.sort((a, b) => a.label.localeCompare(b.label, 'en'));
}

module.exports = { resolveCatalog, catalogCandidates, catalogsFromNames, slugTag, languageChoices };
