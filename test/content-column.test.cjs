'use strict';

// The content column's width cap, and the screenshot that proves it works.
//
// This is a string assertion guarding something a reviewer will not catch by
// eye, for the same reason as color-scheme.test.cjs: the failure is invisible
// on the machine most people look at it on. The default screenshot window is
// 1200px wide with a 280px sidebar, which leaves a content area of about 856px
// — narrower than the 880px cap. So at the size every other image is taken,
// removing the cap entirely changes nothing. Every PNG in the docs would look
// correct while the app ran headings and meta lines to the edge of a maximised
// window.
//
// Two things are pinned here. The cap itself, and the wide screenshot that is
// the only image able to show it. Deleting the shot would leave the cap
// working but unphotographed, which is the state this test was written to end.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { shots } = require('../scripts/screenshots/shots.cjs');

const root = path.join(__dirname, '..');
const TOKENS_CSS = fs.readFileSync(path.join(root, 'src', 'renderer', 'styles', 'tokens.css'), 'utf8');
const INDEX_JSX = fs.readFileSync(path.join(root, 'src', 'renderer', 'index.jsx'), 'utf8');

const WIDE_SHOT = 'site-view-wide';

test('the content column is capped and centred', () => {
	const rule = TOKENS_CSS.match(/\.wpct-content-column\s*\{([^}]*)\}/);
	assert.ok(rule, 'tokens.css has no .wpct-content-column rule');
	assert.match(rule[1], /max-width:\s*var\(--wpct-content-max-width\)/, 'the column must read the cap token');
	assert.match(rule[1], /margin:\s*0 auto/, 'an uncentred cap leaves the content pinned to the left edge');
	assert.match(TOKENS_CSS, /--wpct-content-max-width:\s*\d+px/, 'the cap token has no value');
});

// The rule existing is worth nothing if the scrolling container stopped using it.
test('the scrolling content container still applies the column', () => {
	assert.match(INDEX_JSX, /className="wpct-content-column"/, 'no element uses .wpct-content-column');
});

// The cap replaced a hand-picked inline `maxWidth: 1040`. Reintroducing one
// would override the token silently — an inline style beats a stylesheet.
test('no inline maxWidth competes with the cap', () => {
	assert.doesNotMatch(INDEX_JSX, /maxWidth:\s*(?:1040|880)\b/, 'the cap belongs in tokens.css, not in an inline style');
});

test('a screenshot is taken wide enough for the cap to have an effect', () => {
	const wide = shots.find((shot) => shot.slug === WIDE_SHOT);
	assert.ok(wide, `${WIDE_SHOT} is the only shot that can show the cap; it must not be removed`);
	assert.ok(
		wide.window?.width,
		`${WIDE_SHOT} has no window override, so it is captured at the default width and shows nothing`
	);

	const cap = Number(TOKENS_CSS.match(/--wpct-content-max-width:\s*(\d+)px/)[1]);
	// The sidebar and the content container's own horizontal padding, both read
	// from index.jsx today: 280px and 32px a side. Kept as literals with the
	// arithmetic spelled out, so a failure says which number moved.
	const contentArea = wide.window.width - 280 - 32 * 2;
	assert.ok(
		contentArea > cap,
		`the ${WIDE_SHOT} window is ${wide.window.width}px, leaving ${contentArea}px of content area — ` +
			`not wider than the ${cap}px cap, so the shot proves nothing`
	);
});

test('the wide shot is captured, not just declared', () => {
	const png = path.join(root, 'docs', 'public', 'screenshots', `${WIDE_SHOT}.png`);
	assert.ok(fs.existsSync(png), `${WIDE_SHOT}.png is missing — run "npm run shots"`);
});
