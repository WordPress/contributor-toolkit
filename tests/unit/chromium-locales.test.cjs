const test = require('node:test');
const assert = require('node:assert/strict');

const { normalise, chromiumLocale, electronLanguages } = require('../../scripts/chromium-locales.cjs');

// The same Chromium locales as each platform names them on disk: macOS `.lproj` folders, with
// American English as plain `en` and the grammatical-gender overlays beside each language, and
// Windows and Linux `.pak` files.
const MAC_NAMES = ['ca', 'cs', 'cs_FEMININE', 'de', 'en', 'en_FEMININE', 'en_GB', 'es', 'es_419', 'fil', 'fr', 'hu', 'nb', 'nl', 'pl', 'pt_BR', 'pt_PT', 'zh_CN', 'zh_TW'];
const WIN_NAMES = ['ca', 'cs', 'de', 'en-GB', 'en-US', 'es', 'es-419', 'fil', 'fr', 'hu', 'nb', 'nl', 'pl', 'pt-BR', 'pt-PT', 'zh-CN', 'zh-TW'];

test('both platforms name the same Chromium locales once normalised', () => {
	assert.deepEqual([...normalise(MAC_NAMES)].sort(), [...normalise(WIN_NAMES)].sort());
});

test('a catalog resolves to the Chromium locale Chromium itself would load', () => {
	const available = normalise(WIN_NAMES);
	const cases = {
		cs: 'cs',
		de: 'de',
		'de-ch': 'de',
		'fr-ca': 'fr',
		// Chromium's own regional folding.
		es: 'es',
		'es-mx': 'es-419',
		'es-ar': 'es-419',
		pt: 'pt-pt',
		'pt-ao': 'pt-pt',
		'pt-br': 'pt-br',
		'zh-cn': 'zh-cn',
		'zh-sg': 'zh-cn',
		'zh-tw': 'zh-tw',
		'zh-hk': 'zh-tw',
		'en-gb': 'en-gb',
		'en-au': 'en-gb',
		'en-ca': 'en-gb',
		'en-us': 'en-us',
		'en-ie': 'en-us',
		no: 'nb',
		// translate.wordpress.org slugs that are not tags.
		tl: 'fil',
		'ca-val': 'ca',
		// No Chromium locale, or no language an OS reports.
		gl: null,
		pirate: null
	};
	for (const [slug, expected] of Object.entries(cases)) {
		assert.equal(chromiumLocale(slug, available), expected, slug);
	}
});

test('the list keeps English first, then each locale once in both spellings, the same on every platform', () => {
	const slugs = ['pt-br', 'cs', 'gl', 'es-mx', 'es-ar', 'en-ca', 'en-us', 'de'];
	const expected = ['en-US', 'cs', 'de', 'en-GB', 'en_GB', 'es-419', 'es_419', 'pt-BR', 'pt_BR'];
	assert.deepEqual(electronLanguages(slugs, MAC_NAMES), expected);
	assert.deepEqual(electronLanguages(slugs, WIN_NAMES), expected);
});

test('with no catalog the list is English alone', () => {
	assert.deepEqual(electronLanguages([], WIN_NAMES), ['en-US']);
});
