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
const readPage = () => fs.readFileSync(INDEX_HTML, 'utf8').replace(/<!--[\s\S]*?-->/g, '');

// A <script> whose type is not JavaScript is a data block: the browser never
// runs it, so the policy has nothing to block.
const runsAsScript = (attrs) => {
	const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs);
	return !type || /^(module|(text|application)\/(java|ecma)script)$/i.test(type[1]);
};

test('index.html carries no inline <script>, which its CSP would block (#374)', () => {
	const inline = [...readPage().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
		.filter(([, attrs]) => runsAsScript(attrs))
		.filter(([, attrs, body]) => !/\bsrc\s*=/i.test(attrs) || body.trim() !== '');

	assert.deepEqual(
		inline.map(([tag]) => tag),
		[],
		"index.html has an inline <script>: its Content-Security-Policy (default-src 'self', no script-src) blocks it on every launch. Move it into the bundle."
	);
});

// onload="…", onerror="…" and the rest are inline script too, blocked by the
// same directive.
test('index.html carries no inline event handler attribute, which its CSP would block', () => {
	const handlers = [...readPage().matchAll(/<[a-z][^>]*?\s(on[a-z]+)\s*=/gi)].map(([, name]) => name);

	assert.deepEqual(handlers, [], "index.html has an inline event handler attribute: its Content-Security-Policy blocks it like an inline <script>. Add the listener from the bundle.");
});
