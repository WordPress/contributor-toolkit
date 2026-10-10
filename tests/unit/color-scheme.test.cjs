'use strict';

// The window declares which colour schemes it supports, and the browser paints
// the parts it owns — native form controls — to match. Until #560 the window
// painted light only, and declared `light` only: declaring `light dark` on a
// machine in dark mode gave charcoal inputs on hand-painted white cards, with
// placeholder text at dark-on-dark contrast. Now that the page paints both
// schemes, the declaration has to say both: with `light` alone, the controls
// would be painted light inside a dark window, and the placeholders this app
// puts its guidance in ("Ticket number or URL, e.g. 62281") would be the
// unreadable text again, the other way round.
//
// A string assertion looks trivial, and the regression it guards is not: the
// declaration is one word in a file nobody opens, the app looks perfect to
// anyone whose OS is in light mode, and CI machines are in light mode too. The
// only thing that would catch it is a reviewer on a dark laptop, which is how
// the first form of it was found.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DARK_BACKGROUND } = require('../../src/theme.cjs');

const INDEX_HTML = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');

test('the window declares both colour schemes, since it paints both (#560)', () => {
	const html = fs.readFileSync(INDEX_HTML, 'utf8');
	const declaration = /<meta\s+name="color-scheme"\s+content="([^"]*)"/i.exec(html);

	assert.ok(declaration, 'index.html no longer declares a color-scheme at all');

	const schemes = declaration[1].trim().toLowerCase().split(/\s+/);
	assert.deepEqual(
		schemes,
		['light', 'dark'],
		'index.html must declare `light dark`: the page paints both schemes (#560), and the browser paints the native form controls from this declaration. With `light` alone they are light inside a dark window.'
	);
});

// The page's first paint is before its script runs, with the light tokens;
// the dark window would show a light page for that moment. index.html paints
// the body the dark seed under the dark scheme until the design system's
// provider has mounted, which it marks on the document; that colour must be
// the seed the app then builds its dark theme from, or the page changes
// colour as it mounts, and the rule must stop at the mount, or the body keeps
// the seed where the theme's own surface is wanted.
test('the body is painted the dark seed before the app mounts, under the dark scheme, and only until then', () => {
	const html = fs.readFileSync(INDEX_HTML, 'utf8');
	const prePaint = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*html:not\(\[data-wpds-root-provider\]\)\s+body\s*\{\s*background:\s*(#[0-9a-f]{6})\s*;?\s*\}\s*\}/i.exec(html);

	assert.ok(prePaint, 'index.html no longer paints the body for the dark scheme before the provider mounts, on `html:not([data-wpds-root-provider]) body`');
	assert.equal(prePaint[1].toLowerCase(), DARK_BACKGROUND.toLowerCase(), 'the colour painted before the app mounts is not the dark seed the app builds its theme from');
});
