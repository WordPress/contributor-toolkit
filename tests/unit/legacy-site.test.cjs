'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { legacySiteError, legacySiteNotice } = require('../../src/renderer/legacy-site.cjs');
const { addFilter, removeFilter } = require('@wordpress/hooks');
const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');

test('legacySiteNotice names the cause and the way out (#385)', () => {
	const notice = legacySiteNotice({ legacy: true });
	assert.equal(notice.title, 'This site was created by an earlier version of the app.');
	assert.match(notice.body, /Export your work as a patch, create a new site/);
	assert.match(notice.body, /then delete this one/);
});

test('legacySiteNotice stays silent for every other site (#385)', () => {
	assert.equal(legacySiteNotice({ legacy: false }), null);
	assert.equal(legacySiteNotice({}), null);
	assert.equal(legacySiteNotice(), null);
});

test('the refusal main returns says what still works (#385)', () => {
	assert.match(legacySiteError(), /earlier version of the app/);
	assert.match(legacySiteError(), /export a patch/);
	assert.match(legacySiteError(), /delete this site/);
});

test('the refusal and the notice are said in the locale applied when they are asked for (#629)', (t) => {
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	addFilter('i18n.ngettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => {
		removeFilter('i18n.gettext', 'test/pseudo-locale');
		removeFilter('i18n.ngettext', 'test/pseudo-locale');
	});

	assert.equal(legacySiteError(), pseudoLocalize('This site was created by an earlier version of the app and cannot be changed by this one. Create a new site to keep working; you can still export a patch of what is here, and delete this site.'));
	assert.equal(legacySiteNotice({ legacy: true }).title, pseudoLocalize('This site was created by an earlier version of the app.'));
});
