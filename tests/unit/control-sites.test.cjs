'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { LOG_LINES, MAX_MAIL_TEXT, describeSite, resolveSite, logLineCount, lastLines, describeEmail } = require('../../src/control-sites.cjs');

test('a site with nothing linked is described by its folder, its project and its branch', () => {
	assert.deepEqual(describeSite({ sitePath: 'C:\\Users\\dev\\sites\\wp one', branch: 'trunk' }), {
		path: 'C:\\Users\\dev\\sites\\wp one',
		label: 'wp one',
		// A record that predates project types is a Core site.
		project: 'core',
		workItem: null,
		branch: 'trunk',
		pullRequest: null,
		initialized: false,
		server: { running: false, url: null }
	});
});

test('the work item carries its provider, so a Trac ticket and a GitHub issue are told apart', () => {
	const core = describeSite({ sitePath: '/sites/wp', meta: { label: 'My site', tracTicket: 62281, initialized: true }, branch: 'ticket/62281' });
	assert.equal(core.label, 'My site');
	assert.equal(core.initialized, true);
	assert.deepEqual(core.workItem, { provider: 'trac', id: 62281 });

	const gutenberg = describeSite({ sitePath: '/sites/gb', meta: { projectType: 'gutenberg', tracTicket: 70123 }, branch: 'issue/70123' });
	assert.equal(gutenberg.project, 'gutenberg');
	assert.deepEqual(gutenberg.workItem, { provider: 'github-issue', id: 70123 });
});

test('a pull request that is checked out is named', () => {
	assert.equal(describeSite({ sitePath: '/sites/wp', branch: 'pr/9000', pullRequest: 9000 }).pullRequest, 9000);
});

test('a server is running once it has a process, and has an address once it has said one', () => {
	const site = (server) => describeSite({ sitePath: '/sites/wp', branch: 'trunk', server }).server;

	assert.deepEqual(site({ child: {} }), { running: true, url: null });
	assert.deepEqual(site({ child: {}, url: 'http://127.0.0.1:9400' }), { running: true, url: 'http://127.0.0.1:9400' });
	// An entry whose process is gone is not a running server, whatever
	// address it still holds.
	assert.deepEqual(site({ child: null, url: 'http://127.0.0.1:9400' }), { running: false, url: null });
});

// One registry in each platform's spelling, so the folder rule is tested for
// Windows from macOS and the other way round.
const POSIX_SITES = ['/Users/dev/sites/wp', '/Users/dev/sites/wp/nested', '/Users/dev/sites/gb'];
const WIN_SITES = ['C:\\Users\\dev\\sites\\wp'];
const META = { '/Users/dev/sites/wp': { label: 'Login fix' }, '/Users/dev/sites/gb': { label: 'Editor' } };

test('a site is named by its path, by a folder inside it, or by its name', () => {
	const find = (ref, options = {}) => resolveSite(ref, { sites: POSIX_SITES, siteMeta: META, platform: 'darwin', ...options });

	assert.deepEqual(find('/Users/dev/sites/wp'), { ok: true, sitePath: '/Users/dev/sites/wp' });
	assert.deepEqual(find('/Users/dev/sites/wp/'), { ok: true, sitePath: '/Users/dev/sites/wp' });
	assert.deepEqual(find('/Users/dev/sites/gb/packages/block-editor'), { ok: true, sitePath: '/Users/dev/sites/gb' });
	// The site the folder is most closely in.
	assert.deepEqual(find('/Users/dev/sites/wp/nested/src'), { ok: true, sitePath: '/Users/dev/sites/wp/nested' });
	assert.deepEqual(find('login FIX'), { ok: true, sitePath: '/Users/dev/sites/wp' });
	// A site with no name of its own goes by its folder's.
	assert.deepEqual(find('nested'), { ok: true, sitePath: '/Users/dev/sites/wp/nested' });

	// macOS and Windows do not tell the case of a folder apart; Linux does.
	assert.equal(find('/users/DEV/sites/wp/src').ok, true);
	assert.equal(find('/users/DEV/sites/wp/src', { platform: 'linux' }).ok, false);
	assert.deepEqual(
		resolveSite('c:\\users\\dev\\sites\\wp\\src\\wp-admin', { sites: WIN_SITES, platform: 'win32' }),
		{ ok: true, sitePath: 'C:\\Users\\dev\\sites\\wp' }
	);
});

test('what names no site, or more than one, is refused with a code, and the answer is never the string sent', () => {
	const find = (ref, sites = POSIX_SITES) => resolveSite(ref, { sites, siteMeta: META, platform: 'darwin' });

	for (const ref of [undefined, null, 7, '', '   ', ['/Users/dev/sites/wp']]) {
		assert.equal(find(ref).code, 'unknown-site', String(ref));
	}
	// A folder beside a site, one above it, and one whose name only starts
	// the same way.
	for (const ref of ['/Users/dev/sites', '/Users/dev/sites/wp-other', '/Users/dev/sites/wp/../../.ssh', '/etc']) {
		const found = find(ref);
		assert.ok(!found.ok || POSIX_SITES.includes(found.sitePath), ref);
	}
	assert.equal(find('/Users/dev/sites/wp-other').code, 'unknown-site');
	assert.equal(find('/etc').code, 'unknown-site');

	assert.equal(find('wp', ['/a/wp', '/b/wp']).code, 'ambiguous-site');
	assert.equal(find('anything', []).code, 'unknown-site');
	assert.equal(resolveSite('wp', { sites: undefined }).code, 'unknown-site');
});

test('the number of log lines is what was asked for, within the limits', () => {
	assert.equal(logLineCount(undefined), LOG_LINES.fallback);
	assert.equal(logLineCount(20), 20);
	assert.equal(logLineCount('20'), 20);
	assert.equal(logLineCount(LOG_LINES.max + 1), LOG_LINES.max);
	for (const asked of [0, -1, 1.5, 'all', null, {}]) assert.equal(logLineCount(asked), LOG_LINES.fallback, String(asked));
});

test('the end of a log is its last lines, without the half line a read from mid-file begins with', () => {
	assert.deepEqual(lastLines('one\ntwo\nthree\n', 2), ['two', 'three']);
	assert.deepEqual(lastLines('one\r\ntwo\r\n', 5), ['one', 'two']);
	assert.deepEqual(lastLines('', 5), []);
	// No newline at the end: the last line is still a line.
	assert.deepEqual(lastLines('one\ntwo', 5), ['one', 'two']);
	assert.deepEqual(lastLines('f of a line\ntwo\nthree\n', 5, { partialFirst: true }), ['two', 'three']);
});

test('a mail is answered with who, what and its text, and a long text is cut and said to be', () => {
	assert.deepEqual(
		describeEmail({ id: '1', sentAt: '2026-11-13T09:00:00.000Z', from: 'a@example.test', to: 'b@example.test', cc: '', subject: 'Hello', text: 'Body', html: '<p>Body</p>', raw: 'x' }),
		{ sentAt: '2026-11-13T09:00:00.000Z', from: 'a@example.test', to: 'b@example.test', subject: 'Hello', text: 'Body', textTruncated: false }
	);
	const long = describeEmail({ text: 'x'.repeat(MAX_MAIL_TEXT + 1) });
	assert.equal(long.text.length, MAX_MAIL_TEXT);
	assert.equal(long.textTruncated, true);
	assert.deepEqual(describeEmail({}), { sentAt: null, from: '', to: '', subject: '', text: '', textTruncated: false });
});
