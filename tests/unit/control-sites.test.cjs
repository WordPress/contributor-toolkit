'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { describeSite } = require('../../src/control-sites.cjs');

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
