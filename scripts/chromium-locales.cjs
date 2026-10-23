// Which of Chromium's locales the packaged app keeps: `build.electronLanguages` in package.json.
//
// Electron ships Chromium's own strings (form validation bubbles, the file input, the date picker)
// in about 55 languages. The app shows English for any language it has no catalog for, so the
// build keeps English and the Chromium locale of each catalog in src/languages, and nothing else.
// `npm run i18n:download` writes the list from the catalogs it leaves, and
// tests/unit/electron-languages.test.cjs fails when the list and the catalogs disagree.

const fs = require('node:fs');
const path = require('node:path');

const { slugTag } = require('../src/i18n.cjs');

// Chromium's fallback, and the locale every other one is measured against.
const ENGLISH = 'en-US';

// The locale names of the installed Electron, as on disk: `en_GB` for a macOS `.lproj` folder,
// `en-GB` for a `.pak` file on Windows and Linux. The electron package downloads its binary on the
// first `require`, so this asks for it before reading the folder it unpacks to.
function electronLocaleNames(platform = process.platform) {
	require('electron');
	const dist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
	if (platform === 'darwin') {
		const resources = path.join(dist, 'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources');
		return fs.readdirSync(resources).filter((name) => name.endsWith('.lproj')).map((name) => path.basename(name, '.lproj'));
	}
	return fs.readdirSync(path.join(dist, 'locales')).filter((name) => name.endsWith('.pak')).map((name) => path.basename(name, '.pak'));
}

// Locale names in one spelling, lowercase with hyphens, without macOS's grammatical-gender
// overlays (`cs_FEMININE`), which electron-builder keeps or drops with nothing of their own to say.
// macOS calls American English plain `en`.
function normalise(names) {
	const locales = new Set();
	for (const name of names) {
		if (/_(FEMININE|MASCULINE|NEUTER)$/.test(name)) continue;
		const locale = name.toLowerCase().replace(/_/g, '-');
		locales.add(locale === 'en' ? 'en-us' : locale);
	}
	return locales;
}

/**
 * The Chromium locale a catalog's language is shown in, or null when Chromium has none.
 *
 * The exact locale where Chromium has it, then the regional folding Chromium applies itself
 * (CheckAndResolveLocale in ui/base/l10n/l10n_util.cc): Spanish outside Spain is `es-419`,
 * Portuguese outside Brazil is `pt-PT` (a bare `pt` slug is Portugal's on translate.wordpress.org),
 * Traditional Chinese and Hong Kong's and Macau's are `zh-TW` and other Chinese `zh-CN`, and English
 * is `en-GB` in Australia, Canada, India, New Zealand and South Africa and `en-US` elsewhere. Then
 * the bare language.
 *
 * @param {string}      slug      A catalog's file name without `.json`, as translate.wordpress.org names it.
 * @param {Set<string>} available Chromium's locales, from `normalise`.
 * @return {string|null} Lowercase, hyphenated.
 */
function chromiumLocale(slug, available) {
	const tag = slugTag(slug);
	if (!tag) return null;
	const [lang, ...rest] = tag.split('-');
	const script = rest.find((part) => part.length === 4) || null;
	const region = rest.find((part) => part.length === 2 || /^\d{3}$/.test(part)) || null;
	const resolved = (() => {
		if (region && available.has(`${lang}-${region}`)) return `${lang}-${region}`;
		if (lang === 'es') return region && region !== 'es' ? 'es-419' : 'es';
		if (lang === 'pt') return region === 'br' ? 'pt-br' : 'pt-pt';
		if (lang === 'zh') return script === 'hant' || ['tw', 'hk', 'mo'].includes(region) ? 'zh-tw' : 'zh-cn';
		if (lang === 'en') return ['gb', 'au', 'ca', 'in', 'nz', 'za'].includes(region) ? 'en-gb' : 'en-us';
		if (lang === 'no') return 'nb';
		return lang;
	})();
	return available.has(resolved) ? resolved : null;
}

// Both spellings of a regional locale, since electron-builder compares file names: `pt_BR` keeps
// the macOS folder and `pt-BR` the Windows and Linux file.
function spellings(locale) {
	const [lang, region] = locale.split('-');
	if (!region) return [lang];
	const upper = region.toUpperCase();
	return [`${lang}-${upper}`, `${lang}_${upper}`];
}

/**
 * `build.electronLanguages` for a set of catalogs: English first, then each catalog's Chromium
 * locale in both spellings, in order.
 *
 * @param {string[]} slugs The catalogs in src/languages, without `.json`.
 * @param {string[]} names Electron's locale names, from `electronLocaleNames`.
 * @return {string[]}
 */
function electronLanguages(slugs, names) {
	const available = normalise(names);
	const locales = new Set();
	for (const slug of slugs) {
		const locale = chromiumLocale(slug, available);
		if (locale && locale !== 'en-us') locales.add(locale);
	}
	return [ENGLISH, ...[...locales].sort().flatMap(spellings)];
}

module.exports = { electronLocaleNames, normalise, chromiumLocale, electronLanguages };
