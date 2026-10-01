'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCatalog, catalogCandidates, reachableSlugs, ELECTRON_LOCALES } = require('../../src/i18n.cjs');
const { isPseudoLocale, pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');
const { createI18n } = require('@wordpress/i18n');

const FIXTURES = path.join(__dirname, 'fixtures', 'languages');

test('resolveCatalog prefers the exact locale', async () => {
	assert.deepEqual((await resolveCatalog('xx-YY', FIXTURES))['No sites yet.'], ['Yy sites yy.']);
});

test('resolveCatalog falls back to the bare language', async () => {
	assert.deepEqual((await resolveCatalog('xx-ZZ', FIXTURES))['No sites yet.'], ['Xx sites xx.']);
});

test('resolveCatalog logs a catalog it cannot parse and falls back to the language', async () => {
	const logged = [];
	const messages = await resolveCatalog('xx-BR', FIXTURES, (message) => logged.push(message));
	assert.deepEqual(messages['No sites yet.'], ['Xx sites xx.']);
	assert.equal(logged.length, 1);
	assert.match(logged[0], /^skipped xx-br\.json: /);
});

test('a locale tries its lowercase translate.wordpress.org slug, then its language', () => {
	// Asserted on the names rather than on a file found: macOS and Windows match
	// file names without regard to case, so only the name can show the lookup is
	// right for Linux and for the packaged app's asar, where case matters.
	assert.deepEqual(catalogCandidates('pt-BR'), ['pt-br', 'pt']);
	assert.deepEqual(catalogCandidates('es-419'), ['es-419', 'es']);
	assert.deepEqual(catalogCandidates('de'), ['de']);
	assert.deepEqual(catalogCandidates('../etc'), []);
});

test('Filipino is Chromium\'s fil and translate.wordpress.org\'s tl, tried once', async () => {
	assert.deepEqual(catalogCandidates('fil'), ['tl']);
	assert.deepEqual((await resolveCatalog('fil', FIXTURES))['No sites yet.'], ['Wala pang site.']);
});

test('reachable slugs are what some Electron locale can load, and nothing else', () => {
	const reachable = reachableSlugs();
	for (const slug of ['de', 'pt-br', 'pt', 'es', 'zh-tw', 'tl', 'en-gb']) assert.ok(reachable.has(slug), slug);
	// translate.wordpress.org has these; Chromium never reports them.
	for (const slug of ['es-cl', 'en-au', 'nl-be', 'bn-in', 'pirate']) assert.ok(!reachable.has(slug), slug);
});

test('ELECTRON_LOCALES is the list the installed Electron ships', () => {
	// macOS keeps them as Resources/<name>.lproj, with `_` and `en` for en-US;
	// Windows and Linux as locales/<name>.pak.
	const dist = path.dirname(require.resolve('electron/package.json'));
	const lproj = path.join(dist, 'dist', 'Electron.app', 'Contents', 'Resources');
	const pak = path.join(dist, 'dist', 'locales');
	let shipped;
	if (fs.existsSync(lproj)) {
		shipped = fs.readdirSync(lproj).filter((n) => n.endsWith('.lproj')).map((n) => n.slice(0, -'.lproj'.length).replace('_', '-')).map((n) => (n === 'en' ? 'en-US' : n));
	} else {
		shipped = fs.readdirSync(pak).filter((n) => n.endsWith('.pak')).map((n) => n.slice(0, -'.pak'.length));
	}
	assert.deepEqual([...shipped].sort(), [...ELECTRON_LOCALES].sort());
});

test('resolveCatalog logs a catalog whose messages are not a record and falls back to the language', async () => {
	const logged = [];
	const messages = await resolveCatalog('xx-AR', FIXTURES, (message) => logged.push(message));
	assert.deepEqual(messages['No sites yet.'], ['Xx sites xx.']);
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
	assert.deepEqual(messages['No sites yet.'], ['Xx sites xx.']);
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
	const i18n = createI18n(await resolveCatalog('xx', FIXTURES));
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
