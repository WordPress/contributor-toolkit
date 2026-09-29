'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { resolveCatalog } = require('../../src/i18n.cjs');
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
	assert.match(logged[0], /^skipped xx-BR\.json: /);
});

test('resolveCatalog logs a catalog whose messages are not a record and falls back to the language', async () => {
	const logged = [];
	const messages = await resolveCatalog('xx-AR', FIXTURES, (message) => logged.push(message));
	assert.deepEqual(messages['No sites yet.'], ['Xx sites xx.']);
	assert.deepEqual(logged, ['skipped xx-AR.json: no locale_data.messages']);
});

test('resolveCatalog logs a catalog it cannot read, but not one that is missing', async (t) => {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-'));
	t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
	fs.copyFileSync(path.join(FIXTURES, 'xx.json'), path.join(dir, 'xx.json'));
	// A directory where the file should be: reading it fails, and not with ENOENT.
	fs.mkdirSync(path.join(dir, 'xx-DE.json'));

	const logged = [];
	const messages = await resolveCatalog('xx-DE', dir, (message) => logged.push(message));
	assert.deepEqual(messages['No sites yet.'], ['Xx sites xx.']);
	assert.equal(logged.length, 1);
	assert.match(logged[0], /^skipped xx-DE\.json: .*EISDIR/);

	logged.length = 0;
	await resolveCatalog('xx-FR', dir, (message) => logged.push(message));
	assert.deepEqual(logged, [], 'a missing xx-FR.json is the normal case, not a problem');
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
