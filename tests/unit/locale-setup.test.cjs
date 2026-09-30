'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyLocale } = require('../../src/renderer/locale-setup.cjs');

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
