'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { launchCreateOffer } = require('../../src/renderer/launch-create-offer.cjs');

const SETTINGS = { newSiteLocation: null };
const wait = { consume: false, open: false };

test('a window whose reads have both answered with no site consumes the offer and opens the dialog', () => {
	assert.deepEqual(launchCreateOffer({ offered: false, sitesLoaded: true, settings: SETTINGS, siteCount: 0 }), { consume: true, open: true });
});

test('a window whose reads have both answered with a site consumes the offer without opening the dialog', () => {
	assert.deepEqual(launchCreateOffer({ offered: false, sitesLoaded: true, settings: SETTINGS, siteCount: 2 }), { consume: true, open: false });
});

test('an empty list that has not been read yet is not an answer, so nothing is decided', () => {
	assert.deepEqual(launchCreateOffer({ offered: false, sitesLoaded: false, settings: SETTINGS, siteCount: 0 }), wait);
});

test('settings that have not been read yet wait, since the dialog takes its folder from them as it opens', () => {
	assert.deepEqual(launchCreateOffer({ offered: false, sitesLoaded: true, settings: null, siteCount: 0 }), wait);
});

test('an offer already consumed is never made again, so emptying the list later does not reopen the dialog', () => {
	assert.deepEqual(launchCreateOffer({ offered: true, sitesLoaded: true, settings: SETTINGS, siteCount: 0 }), wait);
});
