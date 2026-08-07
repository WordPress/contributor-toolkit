'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { toRawUrl, parseAttachments, secureTracUrl } = require('../src/trac-attachments.cjs');

// A representative #attachments block, modelled on WordPress Trac's markup and
// the real attachments on ticket #37578 (three .diff files plus a .txt). Built
// from the documented structure; hardened against live markup during the manual
// pass. Kept verbatim so the test breaks loudly if the real markup drifts.
const BLOCK = `<div id="attachments">
  <h2 class="foldable">Attachments <span class="trac-count">(4)</span></h2>
  <div class="attachments">
    <dl class="attachments">
      <dt>
        <a class="trac-rawlink" href="/raw-attachment/ticket/37578/37578-01.diff" title="Download"></a>
        <a href="/attachment/ticket/37578/37578-01.diff" title="View attachment">37578-01.diff</a>
        <span class="trac-args">(1.7 KB) - added by <a class="trac-author" href="/query?status=!closed&amp;owner=Jonnyauk">Jonnyauk</a> <a class="timeline" href="/timeline?from=2015" title="See timeline at 09/12/2015 10:15:00 AM">10 years</a> ago.</span>
      </dt>
      <dd>New filters for Dashboard Recent Activity widget.</dd>
      <dt>
        <a class="trac-rawlink" href="/raw-attachment/ticket/37578/good%20first%20bug%201.txt" title="Download"></a>
        <a href="/attachment/ticket/37578/good%20first%20bug%201.txt" title="View attachment">good first bug 1.txt</a>
        <span class="trac-args">(606 bytes) - added by <a class="trac-author" href="/query?owner=vedantsonone1234">vedantsonone1234</a> <a class="timeline" href="/timeline" title="See timeline at 04/03/2025 02:00:00 PM">16 months</a> ago.</span>
      </dt>
      <dd>notes</dd>
      <dt>
        <a class="trac-rawlink" href="/raw-attachment/ticket/37578/37578.diff" title="Download"></a>
        <a href="/attachment/ticket/37578/37578.diff" title="View attachment">37578.diff</a>
        <span class="trac-args">(1.7 KB) - added by <a class="trac-author" href="/query?owner=pmbaldha">pmbaldha</a> <a class="timeline" title="See timeline at 05/15/2025 09:30:00 AM">15 months</a> ago.</span>
      </dt>
      <dd>Added a patch using the existing filter.</dd>
      <dt>
        <a class="trac-rawlink" href="/raw-attachment/ticket/37578/37578-1.diff" title="Download"></a>
        <a href="/attachment/ticket/37578/37578-1.diff" title="View attachment">37578-1.diff</a>
        <span class="trac-args">(1.8 KB) - added by <a class="trac-author" href="/query?owner=pmbaldha">pmbaldha</a> <a class="timeline" title="See timeline at 05/16/2025 11:00:00 AM">15 months</a> ago.</span>
      </dt>
      <dd>PHPDoc Comment update.</dd>
    </dl>
  </div>
</div>`;

test('toRawUrl: the view path becomes the raw download path (issue #11)', () => {
	assert.strictEqual(
		toRawUrl('/attachment/ticket/37578/37578.diff'),
		'https://core.trac.wordpress.org/raw-attachment/ticket/37578/37578.diff'
	);
	// An already-raw or absolute URL is left as the raw form.
	assert.strictEqual(
		toRawUrl('https://core.trac.wordpress.org/raw-attachment/ticket/37578/37578.diff'),
		'https://core.trac.wordpress.org/raw-attachment/ticket/37578/37578.diff'
	);
});

test('parseAttachments: every attachment is found once, with a raw download URL (issue #11)', () => {
	const rows = parseAttachments(BLOCK, 37578);
	assert.deepStrictEqual(rows.map((r) => r.filename), [
		'37578-01.diff', 'good first bug 1.txt', '37578.diff', '37578-1.diff'
	]);
	// Deduped despite each attachment carrying both a raw and a view link.
	assert.strictEqual(rows.length, 4);
	assert.strictEqual(rows[0].url, 'https://core.trac.wordpress.org/raw-attachment/ticket/37578/37578-01.diff');
});

test('parseAttachments: only .diff/.patch are applyable (issue #11)', () => {
	const rows = parseAttachments(BLOCK, 37578);
	const byName = Object.fromEntries(rows.map((r) => [r.filename, r.applyable]));
	assert.strictEqual(byName['37578.diff'], true);
	assert.strictEqual(byName['37578-1.diff'], true);
	assert.strictEqual(byName['good first bug 1.txt'], false);
});

test('parseAttachments: author, size and an absolute date are extracted (issue #11)', () => {
	const rows = parseAttachments(BLOCK, 37578);
	const diff = rows.find((r) => r.filename === '37578.diff');
	assert.strictEqual(diff.author, 'pmbaldha');
	assert.strictEqual(diff.sizeText, '1.7 KB');
	// Absolute timestamp from the title, not the "15 months ago" relative text.
	assert.strictEqual(diff.dateText, '05/15/2025 09:30:00 AM');
});

test('parseAttachments: an encoded filename is decoded (issue #11)', () => {
	const rows = parseAttachments(BLOCK, 37578);
	assert.ok(rows.some((r) => r.filename === 'good first bug 1.txt'), 'the %20 spaces decode');
});

// A row missing its metadata should still be usable — the filename and a working
// download link are the load-bearing parts.
test('parseAttachments: a bare attachment link still yields a row (issue #11)', () => {
	const rows = parseAttachments(
		'<div id="attachments"><dl><dt><a href="/attachment/ticket/62281/62281.diff">62281.diff</a></dt></dl></div>',
		62281
	);
	assert.strictEqual(rows.length, 1);
	assert.strictEqual(rows[0].filename, '62281.diff');
	assert.strictEqual(rows[0].url, 'https://core.trac.wordpress.org/raw-attachment/ticket/62281/62281.diff');
	assert.strictEqual(rows[0].author, '');
	assert.strictEqual(rows[0].applyable, true);
});

// A poisoned ticket page could carry an absolute href on another host that
// still matches the id-shaped path. It must not become a row — the filename is
// rendered as an openExternal link.
test('parseAttachments: an off-host absolute attachment href is rejected (issue #11)', () => {
	const rows = parseAttachments(
		'<div id="attachments"><dt><a href="https://evil.example.com/attachment/ticket/37578/x.diff">x.diff</a></dt></div>',
		37578
	);
	assert.deepStrictEqual(rows, []);
});

// Same host, but http:// — a downgrade of the origin that carries the session
// cookie. It must not become a row.
test('parseAttachments: a same-host http (non-https) attachment href is rejected (issue #11)', () => {
	const rows = parseAttachments(
		'<div id="attachments"><dt><a href="http://core.trac.wordpress.org/attachment/ticket/37578/x.diff">x.diff</a></dt></div>',
		37578
	);
	assert.deepStrictEqual(rows, []);
});

test('secureTracUrl: accepts only the exact https Trac origin (issue #11)', () => {
	assert.strictEqual(
		secureTracUrl('https://core.trac.wordpress.org/raw-attachment/ticket/1/a.diff'),
		'https://core.trac.wordpress.org/raw-attachment/ticket/1/a.diff'
	);
	assert.strictEqual(secureTracUrl('http://core.trac.wordpress.org/raw-attachment/ticket/1/a.diff'), null);
	assert.strictEqual(secureTracUrl('https://evil.example.com/raw-attachment/ticket/1/a.diff'), null);
	assert.strictEqual(secureTracUrl('https://core.trac.wordpress.org.evil.com/a.diff'), null);
	assert.strictEqual(secureTracUrl('not a url'), null);
});

test('parseAttachments: links to other tickets are ignored (issue #11)', () => {
	const rows = parseAttachments(
		'<div id="attachments"><dt><a href="/attachment/ticket/99999/other.diff">other.diff</a></dt></div>',
		37578
	);
	assert.deepStrictEqual(rows, []);
});

test('parseAttachments: an empty or attachment-less block yields nothing, not a throw (issue #11)', () => {
	assert.deepStrictEqual(parseAttachments('', 37578), []);
	assert.deepStrictEqual(parseAttachments(null, 37578), []);
	assert.deepStrictEqual(parseAttachments('<div id="attachments"><p>No attachments.</p></div>', 37578), []);
});
