// Guards the Chromium locales the packaged app keeps.
//
// build.electronLanguages in package.json keeps English and the Chromium locale of each catalog in
// src/languages; scripts/chromium-locales.cjs says which, and `npm run i18n:download` writes the
// list whenever it adds or removes a catalog. These tests fail when the two disagree (a catalog
// added or removed by hand, a list edited by hand), and when a kept locale is one electron-builder
// would still delete, which would show the app in a language and Chromium's strings in English.
// Chromium follows the operating system's language, not the one chosen in the settings, so where
// the two differ its strings can still differ from the app's, as before.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { electronLocaleNames, normalise, chromiumLocale, electronLanguages } = require('../../scripts/chromium-locales.cjs');
const { build } = require('../../package.json');

const LANGUAGES_DIR = path.join(__dirname, '..', '..', 'src', 'languages');

function catalogs() {
	return fs.readdirSync(LANGUAGES_DIR).filter((name) => name.endsWith('.json')).map((name) => path.basename(name, '.json'));
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

test('build.electronLanguages is the list the catalogs in src/languages call for', () => {
	assert.deepEqual(
		build.electronLanguages,
		electronLanguages(catalogs(), electronLocaleNames()),
		'build.electronLanguages in package.json does not match src/languages. `npm run i18n:download` '
			+ 'writes it; after adding or removing a catalog by hand, copy the expected list above into it.'
	);
});

test('electron-builder keeps the Chromium locale file of English and of every catalog', () => {
	const names = electronLocaleNames();
	const available = normalise(names);
	const fileFor = (locale) => names.find((name) => normalise([name]).has(locale));

	const wanted = ['en-us', ...catalogs().map((slug) => chromiumLocale(slug, available)).filter(Boolean)];
	const dropped = wanted.map(fileFor).filter((file) => !kept(file, build.electronLanguages));
	assert.deepEqual(dropped, [], 'electron-builder would delete these locale files');
});
