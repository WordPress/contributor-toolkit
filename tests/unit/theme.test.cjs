'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { THEMES, themeColorSeeds, windowBackground, DARK_BACKGROUND, LIGHT_BACKGROUND } = require('../../src/theme.cjs');

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

test('a window is made in the colour of its scheme, and the dark one is the seed the theme is built from', () => {
	assert.equal(windowBackground(true), DARK_BACKGROUND);
	assert.equal(windowBackground(false), LIGHT_BACKGROUND);
	assert.match(DARK_BACKGROUND, /^#[0-9a-f]{6}$/);
	assert.match(LIGHT_BACKGROUND, /^#[0-9a-f]{6}$/);
});
