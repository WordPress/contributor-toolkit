'use strict';

// The window declares which colour schemes it supports, and the browser paints
// the parts it owns — native form controls — to match. Declaring `light dark`
// on a machine in dark mode gave charcoal inputs on hand-painted white cards,
// with placeholder text at dark-on-dark contrast. That is not cosmetic here:
// this app puts guidance in placeholders ("Ticket number or URL, e.g. 62281",
// "WordPress.org username, e.g. janedoe"), so the unreadable text is the text
// a first-timer most needs.
//
// A string assertion looks trivial, and the regression it guards is not: the
// declaration is one word in a file nobody opens, the app looks perfect to
// anyone whose OS is in light mode, and CI machines are in light mode too. The
// only thing that would catch it is a reviewer on a dark laptop, which is how
// it was found.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');

test('the window declares only the colour scheme it actually implements', () => {
	const html = fs.readFileSync(INDEX_HTML, 'utf8');
	const declaration = /<meta\s+name="color-scheme"\s+content="([^"]*)"/i.exec(html);

	assert.ok(declaration, 'index.html no longer declares a color-scheme at all');

	const schemes = declaration[1].trim().toLowerCase().split(/\s+/);
	assert.ok(
		!schemes.includes('dark'),
		'index.html promises dark mode. Every surface in this window is painted light by hand and ' +
		'@wordpress/components ships light styles only, so the promise reaches the browser and ' +
		'nothing else: form controls turn dark against white cards. Remove it, or land a real dark ' +
		'theme in the same change.'
	);
	assert.deepEqual(schemes, ['light']);
});
