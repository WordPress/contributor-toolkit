'use strict';

// index.html's Content-Security-Policy has no script-src, so `default-src 'self'`
// applies to scripts and an inline one never runs. Until #374 the page carried
// two, the window's `error` and `unhandledrejection` listeners: Chromium blocked
// both on every launch, and logged two CSP violations into the file people are
// asked to attach to bug reports. Nothing else failed, so nothing noticed.
//
// They were not moved into the bundle because they are not needed. The
// renderer's uncaught errors and unhandled rejections already reach the app log
// without them: Chromium reports each one as a console message ("Uncaught
// Error: …", "Uncaught (in promise) …"), and electron-log's spyRendererConsole
// writes those to the file. Listeners that also called console.error would log
// every error twice, with no more detail than the first line.
//
// A script the page needs belongs in the bundle; one written inline here would
// be blocked the same way.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const INDEX_HTML = path.join(__dirname, '..', '..', 'src', 'renderer', 'index.html');

// HTML comments are dropped first: the ones in index.html explain the page, and
// a comment that names a <script> or an onload= runs nothing.
const stripComments = (html) => html.replace(/<!--[\s\S]*?-->/g, '');
const readPage = () => stripComments(fs.readFileSync(INDEX_HTML, 'utf8'));

// Every start tag, with its attributes by name. A quoted value is read as a
// whole, so a `>` inside one does not end the tag, and names are matched in
// full, so `data-type` is not `type`.
const TAG = /<([a-z][^\s/>]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const startTags = (html) =>
	[...html.matchAll(TAG)].map((match) => {
		const attrs = new Map();
		for (const [, name, dq, sq, bare] of match[2].matchAll(ATTR)) {
			const key = name.toLowerCase();
			if (!attrs.has(key)) attrs.set(key, dq ?? sq ?? bare ?? '');
		}
		return { name: match[1].toLowerCase(), attrs, tag: match[0], end: match.index + match[0].length };
	});

// A <script> whose type is not JavaScript is a data block: the browser never
// runs it, so the policy has nothing to block.
const runsAsScript = (attrs) => {
	const type = (attrs.get('type') ?? '').trim();
	return type === '' || /^(module|(text|application)\/(java|ecma)script)$/i.test(type);
};

const inlineScripts = (html) =>
	startTags(html)
		.filter(({ name, attrs }) => name === 'script' && runsAsScript(attrs))
		.filter(({ attrs, end }) => {
			const close = html.toLowerCase().indexOf('</script', end);
			const body = html.slice(end, close === -1 ? html.length : close);
			return !attrs.has('src') || body.trim() !== '';
		})
		.map(({ tag }) => tag);

// onload="…", onerror="…" and the rest are inline script too, blocked by the
// same directive.
const inlineHandlers = (html) =>
	startTags(html).flatMap(({ attrs }) => [...attrs.keys()].filter((key) => /^on[a-z]+$/.test(key)));

test('index.html carries no inline <script>, which its CSP would block (#374)', () => {
	assert.deepEqual(
		inlineScripts(readPage()),
		[],
		"index.html has an inline <script>: its Content-Security-Policy (default-src 'self', no script-src) blocks it on every launch. Move it into the bundle."
	);
});

test('index.html carries no inline event handler attribute, which its CSP would block', () => {
	assert.deepEqual(inlineHandlers(readPage()), [], "index.html has an inline event handler attribute: its Content-Security-Policy blocks it like an inline <script>. Add the listener from the bundle.");
});

// The two checks above pass on a clean page whether or not they can see
// anything, so they are run here on markup they must flag and markup they
// must leave alone.
test('the inline script and handler checks read attributes the way the browser does', () => {
	assert.equal(inlineScripts('<script>run()</script>').length, 1);
	assert.equal(inlineScripts('<script type="module">run()</script>').length, 1);
	assert.equal(inlineScripts('<script data-type="application/json">run()</script>').length, 1, 'data-type is not type');
	assert.equal(inlineScripts('<script data-src="a.js">run()</script>').length, 1, 'data-src is not src');
	assert.equal(inlineScripts('<script title="a > b">run()</script>').length, 1);
	assert.deepEqual(inlineScripts('<script type="application/json">{"a":1}</script>'), []);
	assert.deepEqual(inlineScripts('<script type="module" src="./a.js"></script>'), []);
	assert.deepEqual(inlineScripts(stripComments('<!-- <script>run()</script> -->')), []);

	assert.deepEqual(inlineHandlers('<body onload="run()">'), ['onload']);
	assert.deepEqual(inlineHandlers('<button title="1 > 0" onclick="run()">'), ['onclick']);
	assert.deepEqual(inlineHandlers('<img alt=\'x\' ONERROR=run()>'), ['onerror']);
	assert.deepEqual(inlineHandlers('<div data-onload="x" title="onclick=run()">'), []);
	assert.deepEqual(inlineHandlers(stripComments('<!-- <body onload="run()"> -->')), []);
});
