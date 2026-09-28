'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveCatalog } = require('../../src/i18n.cjs');
const { isPseudoLocale, pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');
const { createI18n } = require('@wordpress/i18n');

const FIXTURES = path.join(__dirname, 'fixtures', 'languages');

test('resolveCatalog prefers the exact locale', () => {
	assert.deepEqual(resolveCatalog('xx-YY', FIXTURES)['No sites yet.'], ['Yy sites yy.']);
});

test('resolveCatalog falls back to the bare language', () => {
	assert.deepEqual(resolveCatalog('xx-ZZ', FIXTURES)['No sites yet.'], ['Xx sites xx.']);
});

test('resolveCatalog logs a catalog it cannot parse and falls back to the language', () => {
	const logged = [];
	const messages = resolveCatalog('xx-BR', FIXTURES, (message) => logged.push(message));
	assert.deepEqual(messages['No sites yet.'], ['Xx sites xx.']);
	assert.equal(logged.length, 1);
	assert.match(logged[0], /^skipped xx-BR\.json: /);
});

test('resolveCatalog returns null when there is no catalog, English included', () => {
	assert.equal(resolveCatalog('de-DE', FIXTURES), null);
	assert.equal(resolveCatalog('en-US', FIXTURES), null);
	assert.equal(resolveCatalog('en', FIXTURES), null);
});

test('resolveCatalog refuses anything that is not a locale, so it cannot name a path', () => {
	assert.equal(resolveCatalog('../fixtures/languages/xx', FIXTURES), null);
	assert.equal(resolveCatalog('', FIXTURES), null);
	assert.equal(resolveCatalog(undefined, FIXTURES), null);
});

test('a resolved catalog translates through @wordpress/i18n', () => {
	const i18n = createI18n(resolveCatalog('xx', FIXTURES));
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
