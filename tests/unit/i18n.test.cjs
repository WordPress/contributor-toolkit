'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCatalog, catalogCandidates, catalogsFromNames, slugTag, languageChoices } = require('../../src/i18n.cjs');
const { isPseudoLocale, pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');
const { createI18n } = require('@wordpress/i18n');

const FIXTURES = path.join(__dirname, 'fixtures', 'languages');

// A catalog directory holding `slugs`, each a copy of the xx fixture with its
// one string translated as the slug, so a test can see which file loaded.
function catalogDir(t, slugs) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	const fixture = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'xx.json'), 'utf8'));
	for (const slug of slugs) {
		fixture.locale_data.messages['No sites yet.'] = [slug];
		fs.writeFileSync(path.join(dir, `${slug}.json`), JSON.stringify(fixture));
	}
	return dir;
}

const loaded = async (locales, dir) => (await resolveCatalog(locales, dir))?.messages['No sites yet.'][0];

test('resolveCatalog prefers the exact locale', async () => {
	assert.deepEqual((await resolveCatalog('xx-YY', FIXTURES)).messages['No sites yet.'], ['Yy sites yy.']);
});

test('resolveCatalog falls back to the bare language', async () => {
	const found = await resolveCatalog('xx-ZZ', FIXTURES);
	assert.equal(found.locale, 'xx-ZZ');
	assert.deepEqual(found.messages['No sites yet.'], ['Xx sites xx.']);
});

test('resolveCatalog logs a catalog it cannot parse and falls back to the language', async () => {
	const logged = [];
	const messages = await resolveCatalog('xx-BR', FIXTURES, (message) => logged.push(message));
	assert.deepEqual(messages.messages['No sites yet.'], ['Xx sites xx.']);
	assert.equal(logged.length, 1);
	assert.match(logged[0], /^skipped xx-br\.json: /);
});

test('a locale tries itself, then its language and region, then its language', () => {
	// Asserted on the names rather than on a file found: macOS and Windows match
	// file names without regard to case, so only the name can show the lookup is
	// right for Linux and for the packaged app's asar, where case matters.
	assert.deepEqual(catalogCandidates('pt-BR'), ['pt-br', 'pt']);
	assert.deepEqual(catalogCandidates('es-419'), ['es-419', 'es']);
	assert.deepEqual(catalogCandidates('zh-Hant-TW'), ['zh-hant-tw', 'zh-tw', 'zh']);
	// macOS adds the user's region: Chinese in the US still reaches its catalog.
	assert.deepEqual(catalogCandidates('zh-Hans-US'), ['zh-hans-us', 'zh-us', 'zh-cn', 'zh']);
	assert.deepEqual(catalogCandidates('zh-Hant-US'), ['zh-hant-us', 'zh-us', 'zh-tw', 'zh']);
	assert.deepEqual(catalogCandidates('ca-ES-valencia'), ['ca-es-valencia', 'ca-es', 'ca']);
	assert.deepEqual(catalogCandidates('de'), ['de']);
	assert.deepEqual(catalogCandidates('../etc'), []);
});

test('a translate.wordpress.org slug is selected by the tag an OS reports for it', () => {
	assert.equal(slugTag('es-mx'), 'es-mx');
	assert.equal(slugTag('gl'), 'gl');
	assert.equal(slugTag('bel'), 'be');
	assert.equal(slugTag('zul'), 'zu');
	assert.equal(slugTag('tl'), 'fil');
	assert.equal(slugTag('ca-val'), 'ca-es-valencia');
	// No OS reports these.
	assert.equal(slugTag('pirate'), null);
	assert.equal(slugTag('art-xemoji'), null);
});

test('Filipino is the OS\'s fil and translate.wordpress.org\'s tl', async () => {
	assert.deepEqual((await resolveCatalog('fil-PH', FIXTURES)).messages['No sites yet.'], ['Wala pang site.']);
});

test('a regional variant loads its own catalog before its language\'s', async (t) => {
	const dir = catalogDir(t, ['es', 'es-mx']);
	assert.equal(await loaded('es-MX', dir), 'es-mx');
	assert.equal(await loaded('es-419', dir), 'es');
});

test('a slug with a three-letter code, and Valencian, load from the tag the OS reports', async (t) => {
	const dir = catalogDir(t, ['bel', 'ca', 'ca-val']);
	assert.equal(await loaded('be-BY', dir), 'bel');
	assert.equal(await loaded('ca-ES-valencia', dir), 'ca-val');
	assert.equal(await loaded('ca-ES', dir), 'ca');
});

test('a slug that is its own tag wins over one that canonicalizes to it, in either order', () => {
	// The order readdir lists them in depends on the file system.
	assert.equal(catalogsFromNames(['bcc.json', 'bal.json']).get('bal'), 'bal');
	assert.equal(catalogsFromNames(['bal.json', 'bcc.json']).get('bal'), 'bal');
	assert.equal(catalogsFromNames(['bcc.json', 'README.md']).get('bal'), 'bcc');
});

test('Chinese with the user\'s region added loads the catalog for its script', async (t) => {
	const dir = catalogDir(t, ['zh-cn', 'zh-tw']);
	assert.equal(await loaded(['zh-Hans-US', 'en-US'], dir), 'zh-cn');
	assert.equal(await loaded(['zh-Hant-US', 'en-US'], dir), 'zh-tw');
});

test('resolveCatalog logs a catalog directory it cannot read', async () => {
	const logged = [];
	assert.equal(await resolveCatalog('xx', path.join(FIXTURES, 'missing'), (message) => logged.push(message)), null);
	assert.equal(logged.length, 1);
	assert.match(logged[0], /^no catalogs read: .*ENOENT/);
});

test('the OS languages are tried in order, past any with no catalog', async (t) => {
	const dir = catalogDir(t, ['de', 'gl']);
	assert.equal(await loaded(['eu-ES', 'gl-ES', 'de-DE'], dir), 'gl');
	assert.deepEqual((await resolveCatalog(['eu-ES', 'de-DE'], dir)).locale, 'de-DE');
});

test('English before another language keeps the English source strings', async (t) => {
	const dir = catalogDir(t, ['de', 'en-gb']);
	assert.equal(await resolveCatalog(['en-US', 'de-DE'], dir), null);
	assert.equal(await loaded(['en-GB', 'de-DE'], dir), 'en-gb');
});

test('resolveCatalog logs a catalog whose messages are not a record and falls back to the language', async () => {
	const logged = [];
	const messages = await resolveCatalog('xx-AR', FIXTURES, (message) => logged.push(message));
	assert.deepEqual(messages.messages['No sites yet.'], ['Xx sites xx.']);
	assert.deepEqual(logged, ['skipped xx-ar.json: no locale_data.messages']);
});

test('resolveCatalog logs a catalog it cannot read, but not one that is missing', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.copyFileSync(path.join(FIXTURES, 'xx.json'), path.join(dir, 'xx.json'));
	// A directory where the catalog should be: reading it fails, and not with ENOENT.
	fs.mkdirSync(path.join(dir, 'xx-de.json'));

	const logged = [];
	const messages = await resolveCatalog('xx-DE', dir, (message) => logged.push(message));
	assert.deepEqual(messages.messages['No sites yet.'], ['Xx sites xx.']);
	assert.equal(logged.length, 1);
	assert.match(logged[0], /^skipped xx-de\.json: .*EISDIR/);

	logged.length = 0;
	await resolveCatalog('xx-FR', dir, (message) => logged.push(message));
	assert.deepEqual(logged, [], 'a missing xx-fr.json is the normal case, not a problem');
});

test('resolveCatalog returns null when there is no catalog, English included', async () => {
	assert.equal(await resolveCatalog('de-DE', FIXTURES), null);
	assert.equal(await resolveCatalog('en-US', FIXTURES), null);
	assert.equal(await resolveCatalog('en', FIXTURES), null);
});

test('resolveCatalog refuses anything that is not a locale, so it cannot name a path', async () => {
	assert.equal(await resolveCatalog('../fixtures/languages/xx', FIXTURES), null);
	assert.equal(await resolveCatalog('', FIXTURES), null);
	assert.equal(await resolveCatalog(undefined, FIXTURES), null);
});

test('a resolved catalog translates through @wordpress/i18n', async () => {
	const i18n = createI18n((await resolveCatalog('xx', FIXTURES)).messages);
	assert.equal(i18n.__('No sites yet.'), 'Xx sites xx.');
	// A string the catalog lacks keeps its English source.
	assert.equal(i18n.__('Create a site'), 'Create a site');
});

test('en-XA is the pseudo-locale and nothing else is', () => {
	assert.equal(isPseudoLocale('en-XA'), true);
	assert.equal(isPseudoLocale('en-GB'), false);
	assert.equal(isPseudoLocale(undefined), false);
});

test('pseudoLocalize brackets, accents and pads', () => {
	const out = pseudoLocalize('No sites yet.');
	assert.match(out, /^\[.*\]$/);
	assert.ok(out.startsWith('[Ñó šíţéš ýéţ.'));
	assert.ok(out.length > 'No sites yet.'.length + 2, 'padded past the source length');
	assert.equal(pseudoLocalize('No sites yet.'), out, 'deterministic');
});

test('pseudoLocalize leaves placeholders and markup readable by code', () => {
	const out = pseudoLocalize('Open %s in <a>%1$d tabs</a>, 100%%');
	for (const kept of ['%s', '<a>', '%1$d', '</a>', '%%']) {
		assert.ok(out.includes(kept), `${kept} survives: ${out}`);
	}
});

test('pseudoLocalize passes an empty string through', () => {
	assert.equal(pseudoLocalize(''), '');
});

test('the languages offered are English and each catalog, named in itself and sorted by that name', () => {
	const choices = languageChoices(['pt-br.json', 'de.json', 'README.md', 'zh-cn.json']);
	// The names are ICU's, which can differ a character between Node
	// versions; what is pinned is each language's tag, that it is named and
	// not merely tagged, written as a list's entry is, and the order.
	assert.deepEqual(choices.map((choice) => choice.tag), ['de', 'en', 'pt-br', 'zh-cn']);
	assert.deepEqual(choices.slice(0, 2), [{ tag: 'de', label: 'Deutsch' }, { tag: 'en', label: 'English' }]);
	assert.match(choices[2].label, /^Portugu/);
	assert.match(choices[3].label, /^中文/);
});

test('the languages offered leave out a slug no OS reports, and English is offered once', () => {
	assert.deepEqual(languageChoices(['pirate.json', 'art-xemoji.json', 'en.json']), [{ tag: 'en', label: 'English' }]);
	assert.deepEqual(languageChoices([]), [{ tag: 'en', label: 'English' }]);
});
