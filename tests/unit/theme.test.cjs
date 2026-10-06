'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { THEMES, themeColorSeeds, windowBackground, DARK_BACKGROUND } = require('../../src/theme.cjs');

test('the themes are light, dark and system: the prototype\'s custom colours are not one (#560)', () => {
	assert.deepEqual(THEMES, ['light', 'dark', 'system']);
});

// In the light scheme the provider is given no colour, so the tokens
// stylesheet's values stand as they ship: generating them again from a seed
// would move every colour by a hair, and the light theme is what every
// picture in the guide shows. In the dark scheme it is given the dark seed
// and builds every token from it.
test('the provider is seeded in the dark scheme only, and from the dark background', () => {
	assert.deepEqual(themeColorSeeds(false), {});
	assert.deepEqual(themeColorSeeds(true), { background: DARK_BACKGROUND });
});

// The window's colour and the provider's seed have to be the one colour, or
// the page changes colour as it mounts; and both have to be what Electron
// takes for a window's colour, `#rrggbb`.
test('a window is made in the colour of its scheme, which in the dark scheme is the seed the theme is built from', () => {
	assert.equal(windowBackground(true), themeColorSeeds(true).background);
	assert.notEqual(windowBackground(false), windowBackground(true));
	for (const colour of [windowBackground(true), windowBackground(false)]) assert.match(colour, /^#[0-9a-f]{6}$/);
});
