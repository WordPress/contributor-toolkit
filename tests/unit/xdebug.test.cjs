const test = require('node:test');
const assert = require('node:assert/strict');

const { xdebugLaunchConfig, phpStormSettings, xdebugStatus, xdebugSection, otherXdebugSites } = require('../../src/renderer/xdebug.cjs');

const mappings = (text) => JSON.parse(text).configurations[0].pathMappings;

// The snippet is pasted into VS Code as a whole launch.json, so it has to be
// JSON VS Code's PHP Debug extension reads: a listener on Xdebug's port.
test('the launch config is a whole launch.json that listens for Xdebug on 9003', () => {
	const config = JSON.parse(xdebugLaunchConfig({ sitePath: '/sites/wp', serve: { strategy: 'docroot' } }));
	assert.equal(config.version, '0.2.0');
	assert.equal(config.configurations.length, 1);
	const [listen] = config.configurations;
	assert.equal(listen.type, 'php');
	assert.equal(listen.request, 'launch');
	assert.equal(listen.port, 9003);
});

// Playground serves build/, but build/'s PHP is src/'s, line for line, and
// src/ is what a contributor edits: a breakpoint set there has to hit.
test('a Core site maps the served WordPress to the checkout’s src/, not build/', () => {
	assert.deepEqual(mappings(xdebugLaunchConfig({ sitePath: '/sites/wp', serve: { strategy: 'docroot' } })), { '/wordpress': '/sites/wp/src' });
	assert.deepEqual(mappings(xdebugLaunchConfig({ sitePath: '/sites/wp/', serve: { strategy: 'docroot' } })), { '/wordpress': '/sites/wp/src' });
});

test('a Windows path keeps its own separator, and the JSON escapes it', () => {
	const text = xdebugLaunchConfig({ sitePath: 'C:\\Users\\Jane Doe\\sites\\wp', serve: { strategy: 'docroot' } });
	assert.deepEqual(mappings(text), { '/wordpress': 'C:\\Users\\Jane Doe\\sites\\wp\\src' });
});

// A Gutenberg checkout is mounted as it is, under the plugins directory.
test('a plugin-mount site maps the plugin’s mount to the checkout itself', () => {
	assert.deepEqual(
		mappings(xdebugLaunchConfig({ sitePath: '/sites/gb', serve: { strategy: 'plugin-mount', pluginSlug: 'gutenberg' } })),
		{ '/wordpress/wp-content/plugins/gutenberg': '/sites/gb' }
	);
});

// What the page says follows the server that is running, not the setting:
// the setting applies at the next start, and a server keeps what it started
// with.
test('a server that is not running says nothing of Xdebug, whatever the setting', () => {
	assert.deepEqual(xdebugStatus({ setting: true, running: false, startedWith: false }), { on: false, note: '' });
	assert.deepEqual(xdebugStatus({ setting: false, running: false, startedWith: false }), { on: false, note: '' });
});

test('a server started with Xdebug is on, and says nothing more while the setting agrees', () => {
	assert.deepEqual(xdebugStatus({ setting: true, running: true, startedWith: true }), { on: true, note: '' });
});

test('a server started without Xdebug after it was turned on says to restart it', () => {
	const status = xdebugStatus({ setting: true, running: true, startedWith: false });
	assert.equal(status.on, false);
	assert.match(status.note, /restart the server/i);
});

test('a server started with Xdebug after it was turned off says it is still on until a restart', () => {
	const status = xdebugStatus({ setting: false, running: true, startedWith: true });
	assert.equal(status.on, true);
	assert.match(status.note, /still on/i);
});

test('a server running without Xdebug, and the setting off, says nothing', () => {
	assert.deepEqual(xdebugStatus({ setting: false, running: true, startedWith: false }), { on: false, note: '' });
});

// Every server sends Xdebug to the same port, so VS Code cannot tell two
// running sites apart: the other ones are named, by the name the list shows.
test('the other sites named are those whose server is running with Xdebug', () => {
	const servers = {
		'/sites/wp': { status: 'online', text: '', xdebug: true },
		'/sites/two': { status: 'online', text: '', xdebug: true },
		'/sites/gb': { status: 'online', text: '', xdebug: false },
		'/sites/three': { status: 'busy', text: '', xdebug: true },
		'/sites/four': { status: 'offline', text: '', xdebug: true }
	};
	const siteMeta = { '/sites/two': { label: 'Second site' } };
	assert.deepEqual(otherXdebugSites({ servers, siteMeta, sitePath: '/sites/wp' }), ['Second site']);
	assert.deepEqual(otherXdebugSites({ servers, siteMeta: {}, sitePath: '/sites/two' }), ['wp']);
	assert.deepEqual(otherXdebugSites({ servers: {}, siteMeta, sitePath: '/sites/wp' }), []);
});

// The section the server's details draw: nothing when there is nothing to
// say, a note without a launch.json for a server that would not connect, and
// the launch.json with the other sites while the server has Xdebug.
test('the details show no Xdebug section when there is nothing to say', () => {
	const base = { sitePath: '/sites/wp', serve: { strategy: 'docroot' }, others: [] };
	assert.equal(xdebugSection({ ...base, setting: false, running: true, startedWith: false }), null);
	assert.equal(xdebugSection({ ...base, setting: true, running: false, startedWith: false }), null);
});

test('a server that started before Xdebug was turned on gets the note and no launch.json', () => {
	const section = xdebugSection({ sitePath: '/sites/wp', serve: { strategy: 'docroot' }, others: ['Two'], setting: true, running: true, startedWith: false });
	assert.equal(section.on, false);
	assert.match(section.note, /restart the server/i);
	assert.equal(section.config, '');
	assert.deepEqual(section.phpStorm, []);
});

test('a server with Xdebug gets its launch.json, its PhpStorm values and the other sites running with it', () => {
	const section = xdebugSection({ sitePath: '/sites/wp', serve: { strategy: 'docroot' }, url: 'http://127.0.0.1:9400/', others: ['Two'], setting: true, running: true, startedWith: true });
	assert.equal(section.on, true);
	assert.equal(section.note, '');
	assert.equal(section.config, xdebugLaunchConfig({ sitePath: '/sites/wp', serve: { strategy: 'docroot' } }));
	assert.deepEqual(section.phpStorm, phpStormSettings({ sitePath: '/sites/wp', serve: { strategy: 'docroot' }, url: 'http://127.0.0.1:9400/' }));
	assert.deepEqual(section.others, ['Two']);
});

// PhpStorm keeps its debug setup in its own settings, so the toolkit gives
// the values to enter there: the server the site runs on, and the same
// mapping the launch.json has.
test('the PhpStorm values for a Core site name the server and the src/ mapping', () => {
	assert.deepEqual(phpStormSettings({ sitePath: '/sites/wp', serve: { strategy: 'docroot' }, url: 'http://127.0.0.1:9400/' }), [
		{ id: 'host', label: 'Host', value: '127.0.0.1' },
		{ id: 'port', label: 'Port', value: '9400' },
		{ id: 'local', label: 'File/Directory', value: '/sites/wp/src' },
		{ id: 'server', label: 'Absolute path on the server', value: '/wordpress' }
	]);
});

test('the PhpStorm values for a plugin-mount site map the checkout to the plugin’s mount', () => {
	const values = phpStormSettings({ sitePath: 'C:\\sites\\gb', serve: { strategy: 'plugin-mount', pluginSlug: 'gutenberg' }, url: 'http://127.0.0.1:9401/' });
	assert.equal(values.find((v) => v.id === 'port').value, '9401');
	assert.equal(values.find((v) => v.id === 'local').value, 'C:\\sites\\gb');
	assert.equal(values.find((v) => v.id === 'server').value, '/wordpress/wp-content/plugins/gutenberg');
});
