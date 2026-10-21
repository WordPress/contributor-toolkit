// Guards the Chromium locales the packaged app keeps.
//
// Electron ships Chromium's strings (form validation bubbles, the file input, the date picker) in
// about 55 languages, about 47 MB on macOS. The app shows English for any language it has no
// catalog for, so build.electronLanguages in package.json keeps only English and the languages in
// src/languages. Chromium follows the operating system's language, not the one chosen in the
// settings, so where the two differ its strings can still differ from the app's, as before.
//
// That list is written by hand, and `npm run i18n:download` adds a catalog whenever a locale
// reaches the coverage cut-off. A catalog whose Chromium locale the list does not keep would show
// the app in that language and Chromium's strings in English. This test fails instead, naming the
// entry to add.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { slugTag } = require('../../src/i18n.cjs');
const { build } = require('../../package.json');

const LANGUAGES_DIR = path.join(__dirname, '..', '..', 'src', 'languages');

// The locale files of the Electron that will be packaged, named as on disk: `en_GB` for a macOS
// `.lproj` folder, `en-GB` for a `.pak` file on Windows and Linux.
function electronLocaleNames() {
	const dist = path.join(path.dirname(require.resolve('electron/package.json')), 'dist');
	if (process.platform === 'darwin') {
		const resources = path.join(dist, 'Electron.app', 'Contents', 'Frameworks', 'Electron Framework.framework', 'Resources');
		return fs.readdirSync(resources).filter((name) => name.endsWith('.lproj')).map((name) => path.basename(name, '.lproj'));
	}
	return fs.readdirSync(path.join(dist, 'locales')).filter((name) => name.endsWith('.pak')).map((name) => path.basename(name, '.pak'));
}

// electron-builder's own rule (app-builder-lib, ElectronFramework.js): a locale file stays when an
// entry is its name, or starts with its name and a separator, so `en-US` keeps macOS's `en`.
function kept(fileName, wanted) {
	const language = fileName.toLowerCase();
	return wanted.some((entry) => {
		const want = entry.trim().toLowerCase();
		return want === language || want.startsWith(`${language}-`) || want.startsWith(`${language}_`);
	});
}

// The Chromium locale a catalog's language falls to: the file named like the tag, or failing
// that like its bare language (`de-at` reads Chromium's `de`). Galician has none, and neither does
// Canadian English on Windows; those catalogs have no Chromium strings to keep.
function chromiumLocaleFor(slug, names) {
	const tag = slugTag(slug) || slug;
	const byTag = new Map(names.map((name) => [name.toLowerCase().replace(/_/g, '-'), name]));
	return byTag.get(tag) || byTag.get(tag.split('-')[0]) || null;
}

test('electron-builder keeps the Chromium locale of English and of every catalog the app ships', () => {
	const names = electronLocaleNames();
	const wanted = build.electronLanguages;
	const catalogs = fs.readdirSync(LANGUAGES_DIR).filter((name) => name.endsWith('.json')).map((name) => path.basename(name, '.json'));

	const english = names.find((name) => ['en', 'en-US'].includes(name));
	assert.ok(english, `no English locale among Electron's: ${names.join(', ')}`);
	assert.ok(kept(english, wanted), `build.electronLanguages drops ${english}, Chromium's fallback`);

	const dropped = catalogs
		.map((slug) => ({ slug, locale: chromiumLocaleFor(slug, names) }))
		.filter(({ locale }) => locale && !kept(locale, wanted));
	assert.deepEqual(
		dropped,
		[],
		'build.electronLanguages in package.json drops the Chromium locale of a catalog in src/languages. '
			+ 'Add both spellings of each, as `pt-BR` and `pt_BR`.'
	);
});
