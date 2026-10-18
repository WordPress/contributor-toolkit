'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createI18n } = require('@wordpress/i18n');
const { applyLocale, textDirection } = require('../../src/renderer/locale-setup.cjs');

function recorder() {
	const calls = { setLocaleData: [], addFilter: [] };
	return {
		calls,
		deps: {
			setLocaleData: (...args) => calls.setLocaleData.push(args),
			addFilter: (...args) => calls.addFilter.push(args)
		}
	};
}

test('a locale with a catalog loads it and names the page in that language', () => {
	const { calls, deps } = recorder();
	const data = { 'No sites yet.': ['Aucun site.'] };
	assert.equal(applyLocale({ locale: 'fr', data }, deps), 'fr');
	assert.deepEqual(calls.setLocaleData, [[data]]);
	assert.deepEqual(calls.addFilter, []);
});

test('a locale with no catalog leaves the page in English, and says so', () => {
	// A German OS with no de.json: the text is English, so <html lang> must be
	// too, or a screen reader reads English in a German voice.
	const { calls, deps } = recorder();
	assert.equal(applyLocale({ locale: 'de', data: null }, deps), 'en');
	assert.deepEqual(calls.setLocaleData, []);
	assert.deepEqual(calls.addFilter, []);
});

test('the pseudo-locale installs a filter on every translation function', () => {
	const { calls, deps } = recorder();
	assert.equal(applyLocale({ locale: 'en-XA', data: null }, deps), 'en-XA');
	assert.deepEqual(
		calls.addFilter.map(([hook]) => hook),
		['i18n.gettext', 'i18n.gettext_with_context', 'i18n.ngettext', 'i18n.ngettext_with_context']
	);
	const [, , filter] = calls.addFilter[0];
	assert.match(filter('Cancel'), /^\[Çáñçéļ~+\]$/);
});

test('no reply at all, when the locale read failed, is English', () => {
	const { calls, deps } = recorder();
	assert.equal(applyLocale(undefined, deps), 'en');
	assert.equal(applyLocale({}, deps), 'en');
	assert.deepEqual(calls.setLocaleData, []);
});

test('a catalog that translates the text direction to rtl makes the page right-to-left', () => {
	const i18n = createI18n({ '': {}, 'text direction\u0004ltr': ['rtl'] });
	assert.equal(textDirection(i18n._x), 'rtl');
});

test('the page is left-to-right without a catalog, and with one that keeps ltr', () => {
	assert.equal(textDirection(createI18n()._x), 'ltr');
	assert.equal(textDirection(createI18n({ '': {}, 'text direction\u0004ltr': ['ltr'] })._x), 'ltr');
});

test('the pseudo-locale stays left-to-right', () => {
	// Its filter brackets every string, `ltr` included, which is not `rtl`.
	assert.equal(textDirection((text) => `[${text}~]`), 'ltr');
});
