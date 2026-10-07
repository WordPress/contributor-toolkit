'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { THEMES, THEME_KEYS, resolveTheme, nativeThemeSource, normalizeHexColor, isHexColor, isDarkColor, DARK_BACKGROUND, LIGHT_BACKGROUND, PRIMARY } = require('../../src/theme.cjs');

test('the themes are light, dark, system and custom, and the theme is made of three settings (#560)', () => {
	assert.deepEqual(THEMES, ['light', 'dark', 'system', 'custom']);
	assert.deepEqual(THEME_KEYS, ['theme', 'customBackground', 'customPrimary']);
});

// In the light scheme the provider is given no colour, so the tokens
// stylesheet's values stand as they ship: generating them again from a seed
// would move every colour by a hair, and the light theme is what every
// picture in the guide shows. In the dark scheme it is given the dark seed
// and builds every token from it. The window's colour and the provider's
// seed are the one colour, or the page changes colour as it mounts.
test('light, dark and system come to the two schemes, seeded in the dark one only', () => {
	assert.deepEqual(resolveTheme({ theme: 'light' }), { scheme: 'light', seeds: {}, background: LIGHT_BACKGROUND, key: 'light' });
	assert.deepEqual(resolveTheme({ theme: 'dark' }), { scheme: 'dark', seeds: { background: DARK_BACKGROUND }, background: DARK_BACKGROUND, key: 'dark' });
	assert.deepEqual(resolveTheme({ theme: 'system', systemDark: false }), resolveTheme({ theme: 'light' }));
	assert.deepEqual(resolveTheme({ theme: 'system', systemDark: true }), resolveTheme({ theme: 'dark' }));
	assert.deepEqual(resolveTheme({ theme: 'system' }), resolveTheme({ theme: 'light' }), 'nothing known of the system is light');
});

// A custom theme is its two colours, and a scheme by its background, so the
// native controls Chromium paints for the scheme match the page.
test('a custom theme is seeded from its two colours, is dark when its background is, and the window is made in its background', () => {
	const dark = resolveTheme({ theme: 'custom', customBackground: '#102030', customPrimary: '#ff8800' });
	assert.deepEqual(dark, { scheme: 'dark', seeds: { background: '#102030', primary: '#ff8800' }, background: '#102030', key: 'custom:#102030:#ff8800' });
	const light = resolveTheme({ theme: 'custom', customBackground: '#fff8e1', customPrimary: '#3858e9', systemDark: true });
	assert.equal(light.scheme, 'light', 'the system\'s theme has no say');
	assert.equal(light.background, '#fff8e1');
	// A colour that is not one falls back to the light theme's, so the
	// provider is never given something it cannot build from.
	assert.deepEqual(resolveTheme({ theme: 'custom', customBackground: 'blue', customPrimary: undefined }).seeds, { background: LIGHT_BACKGROUND, primary: PRIMARY });
	// Two themes that paint the same have the same name, and two that do not
	// do not.
	assert.equal(dark.key, resolveTheme({ theme: 'custom', customBackground: '#102030', customPrimary: '#ff8800' }).key);
	assert.notEqual(dark.key, resolveTheme({ theme: 'custom', customBackground: '#102030', customPrimary: '#ff8801' }).key);
});

test('a background is dark when white text reads better on it than black', () => {
	assert.equal(isDarkColor('#000000'), true);
	assert.equal(isDarkColor('#1e1e1e'), true);
	assert.equal(isDarkColor('#3858e9'), true, 'the brand blue takes white text');
	assert.equal(isDarkColor('#ffffff'), false);
	assert.equal(isDarkColor('#fcfcfc'), false);
	assert.equal(isDarkColor('#808080'), false, 'a mid grey still takes black text');
	// The crossover, where the design system's own ramp turns too.
	assert.equal(isDarkColor('#757575'), true);
	assert.equal(isDarkColor('#767676'), false);
});

test('Electron is given the setting for the three it knows, and a custom theme\'s scheme', () => {
	for (const theme of ['light', 'dark', 'system']) assert.equal(nativeThemeSource({ theme }), theme);
	assert.equal(nativeThemeSource({ theme: 'custom', customBackground: '#102030', customPrimary: PRIMARY }), 'dark');
	assert.equal(nativeThemeSource({ theme: 'custom', customBackground: '#fcfcfc', customPrimary: PRIMARY }), 'light');
});

test('a colour is kept as six lowercase hex digits, from three or six as typed, and anything else is not one', () => {
	assert.equal(normalizeHexColor('#3858E9'), '#3858e9');
	assert.equal(normalizeHexColor(' 3858e9 '), '#3858e9');
	assert.equal(normalizeHexColor('#abc'), '#aabbcc');
	assert.equal(normalizeHexColor('ABC'), '#aabbcc');
	for (const bad of ['', '#', '#12345', '#1234567', 'blue', 'rgb(1,2,3)', '#ggg', 42, null, undefined]) assert.equal(normalizeHexColor(bad), null, String(bad));
	assert.equal(isHexColor('#3858e9'), true);
	for (const bad of ['#3858E9', '#abc', '3858e9', '', null]) assert.equal(isHexColor(bad), false, String(bad));
});
