'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { siteUrl, adminUrl, adminerUrl } = require('../src/renderer/site-urls.cjs');

const INDEX_JSX = path.join(__dirname, '..', 'src', 'renderer', 'index.jsx');

const ADMINER_LINK = '>DB inspect (Adminer)</a>';

// The shape server-runner.js actually produces: `http://127.0.0.1:${port}/`.
const RUNNING = 'http://127.0.0.1:8881/';

test('adminUrl: the admin of a running site (issue #248)', () => {
	assert.strictEqual(adminUrl(RUNNING), 'http://127.0.0.1:8881/wp-admin/');
});

test('adminUrl: keeps the trailing slash WordPress would redirect to (issue #248)', () => {
	assert.ok(adminUrl(RUNNING).endsWith('/wp-admin/'));
});

// The bug the old inline `.replace(/\/$/, '/')` could not catch: it swapped a
// trailing slash for a trailing slash.
test('adminUrl: a base without a trailing slash does not run the path together (issue #248)', () => {
	assert.strictEqual(adminUrl('http://127.0.0.1:8881'), 'http://127.0.0.1:8881/wp-admin/');
});

test('adminerUrl: matches what the Open Adminer button produced before (issue #248)', () => {
	assert.strictEqual(adminerUrl(RUNNING), 'http://127.0.0.1:8881/adminer.php');
});

test('adminerUrl: a base without a trailing slash is joined, not concatenated (issue #248)', () => {
	assert.strictEqual(adminerUrl('http://127.0.0.1:8881'), 'http://127.0.0.1:8881/adminer.php');
});

// '' keeps the renderer's existing falsy guard working on the derived URL,
// rather than yielding a link relative to the app.
test('no dev server yields no URL rather than a relative one (issue #248)', () => {
	assert.strictEqual(adminUrl(''), '');
	assert.strictEqual(adminerUrl(''), '');
	assert.strictEqual(siteUrl('', 'wp-admin/'), '');
});

test('a non-string base is treated as absent, not coerced (issue #248)', () => {
	assert.strictEqual(adminUrl(undefined), '');
	assert.strictEqual(adminUrl(null), '');
	assert.strictEqual(adminerUrl(undefined), '');
});

test('siteUrl: a leading slash on the path does not double up (issue #248)', () => {
	assert.strictEqual(siteUrl(RUNNING, '/wp-admin/'), 'http://127.0.0.1:8881/wp-admin/');
});

test('siteUrl: several slashes on either side still join once (issue #248)', () => {
	assert.strictEqual(siteUrl('http://127.0.0.1:8881//', '//wp-admin/'), 'http://127.0.0.1:8881/wp-admin/');
});

test('siteUrl: whitespace around a base is trimmed (issue #248)', () => {
	assert.strictEqual(siteUrl('  http://127.0.0.1:8881/  ', 'wp-admin/'), 'http://127.0.0.1:8881/wp-admin/');
});

test('siteUrl: an empty path yields the base with one trailing slash (issue #248)', () => {
	assert.strictEqual(siteUrl(RUNNING, ''), 'http://127.0.0.1:8881/');
});

// A port is part of the origin, and stripping it would point the link at :80.
test('siteUrl: the port survives (issue #248)', () => {
	assert.ok(adminUrl('http://127.0.0.1:39372/').startsWith('http://127.0.0.1:39372/'));
});

// No DOM here, so what is testable is that the renderer reads its URLs from
// this module rather than restating them — as pr-state.test.cjs does.

test('both places that show the site URL also link wp-admin (issue #248)', () => {
	const source = fs.readFileSync(INDEX_JSX, 'utf8');

	// The two the issue names: the setup checklist step and the site page.
	assert.strictEqual(
		source.split('>wp-admin</a>').length - 1,
		2,
		'expected exactly two wp-admin links: the setup checklist step and the site page'
	);
});

test('the renderer derives both destinations here, not inline (issue #248)', () => {
	const source = fs.readFileSync(INDEX_JSX, 'utf8');

	// What made `…:8881adminer.php` possible was concatenating a path onto the
	// base by hand, so the literals are the guard: without them there is nothing
	// to concatenate. Searching for the old `.replace()` instead would only
	// match one spelling of the same mistake.
	for (const literal of ["'wp-admin", '"wp-admin', "'adminer.php'"]) {
		assert.strictEqual(
			source.split(literal).length - 1,
			0,
			`index.jsx hardcodes ${literal} instead of deriving it from site-urls.cjs`
		);
	}

	// Counted as calls so a comment naming a helper is not a red suite. The href
	// specifically, not the click handler: a link could otherwise open the right
	// page while pointing somewhere else.
assert.strictEqual(
		source.split('href={adminUrl(').length - 1,
		2,
		'expected both wp-admin anchors to take their href from adminUrl'
	);
	assert.strictEqual(
		source.split('e.preventDefault(); window.api.openExternal(adminUrl(').length - 1,
		2,
		'expected both wp-admin anchors to prevent in-app navigation and open adminUrl externally'
	);

	assert.strictEqual(
		source.split('href={adminerUrl(').length - 1,
		1,
		'expected the Adminer link to take its href from adminerUrl'
	);
	assert.strictEqual(
		source.split('e.preventDefault(); window.api.openExternal(adminerUrl(').length - 1,
		1,
		'expected the Adminer link to prevent in-app navigation and open adminerUrl externally'
	);
});

// Adminer became an anchor here, so it needs the same preventDefault the other
// two links have — as a Button it could not navigate the window at all.
test('the running site reads as one row of destinations (issue #249)', () => {
	const source = fs.readFileSync(INDEX_JSX, 'utf8');

	assert.strictEqual(
		source.split('Open Adminer').length - 1,
		0,
		'Open Adminer is still a button in the action row'
	);

	assert.strictEqual(
		source.split(ADMINER_LINK).length - 1,
		1,
		'expected exactly one DB inspect (Adminer) link beside the site URL'
	);

	// Placement is the whole point of #249, and the assertions above pin only the
	// widget: an anchor rendered back inside the action-button row passes all of
	// them. Anchoring it between the site page's wp-admin link and the
	// credentials line puts it in the row it was moved into. lastIndexOf,
	// because the wizard step has a wp-admin link of its own, earlier.
	const wpAdmin = source.lastIndexOf('>wp-admin</a>');
	const adminer = source.indexOf(ADMINER_LINK);
	const credentials = source.indexOf('Log in with <code>admin</code>');
	assert.ok(
		wpAdmin < adminer && adminer < credentials,
		'expected the Adminer link on the links row, after wp-admin and above the credentials line'
	);
});
