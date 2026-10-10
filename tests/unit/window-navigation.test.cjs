'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { pinToOwnPage } = require('../../src/window-navigation.js');

const APP_PAGE = 'file:///Applications/Toolkit.app/Contents/Resources/app.asar/src/renderer/index.html';

// Stands in for a window's webContents, so what Chromium asks of the window
// can be replayed without an Electron process: a request for a new window
// through the handler the module installed, a navigation or a redirect as the
// event Electron emits for it.
function fakeWebContents(url = APP_PAGE) {
	const listeners = new Map();
	return {
		url,
		windowOpenHandler: null,
		getURL() { return this.url; },
		setWindowOpenHandler(handler) { this.windowOpenHandler = handler; },
		on(name, listener) {
			if (!listeners.has(name)) listeners.set(name, []);
			listeners.get(name).push(listener);
		},
		// Returns whether the navigation was cancelled.
		emit(name, target, { isMainFrame = true } = {}) {
			let prevented = false;
			const event = { url: target, isMainFrame, preventDefault() { prevented = true; } };
			for (const listener of listeners.get(name) || []) listener(event);
			return prevented;
		}
	};
}

function pinned(url) {
	const wc = fakeWebContents(url);
	const offered = [];
	pinToOwnPage(wc, { openInBrowser: (target) => { offered.push(target); } });
	return { wc, offered };
}

test('a request for a new window is denied whatever the address, and the address is offered to the browser', () => {
	const { wc, offered } = pinned();

	// The app's own page included: a second window of it is still a second
	// window.
	for (const url of ['http://127.0.0.1:8881/wp-admin/', 'file:///etc/passwd', 'about:blank', APP_PAGE]) {
		assert.deepEqual(wc.windowOpenHandler({ url }), { action: 'deny' }, url);
	}

	// Offered, not opened: which of these may reach the browser is the
	// caller's decision (external-url.js in the app), not this module's.
	assert.deepEqual(offered, ['http://127.0.0.1:8881/wp-admin/', 'file:///etc/passwd', 'about:blank', APP_PAGE]);
});

test('a navigation away from the page is cancelled, and the address is offered to the browser', () => {
	const { wc, offered } = pinned();

	assert.equal(wc.emit('will-navigate', 'https://core.trac.wordpress.org/ticket/62281'), true);
	assert.deepEqual(offered, ['https://core.trac.wordpress.org/ticket/62281']);
});

test('a redirect away from the page is cancelled too', () => {
	const { wc, offered } = pinned();

	assert.equal(wc.emit('will-redirect', 'https://wordpress.org/'), true);
	assert.deepEqual(offered, ['https://wordpress.org/']);
});

test('a frame inside the page redirecting is not the window leaving', () => {
	// will-redirect is sent for frames too. Treating one as the window's own
	// would open the browser on an address nobody clicked.
	const { wc, offered } = pinned();

	assert.equal(wc.emit('will-redirect', 'https://wordpress.org/', { isMainFrame: false }), false);
	assert.deepEqual(offered, []);
});

test('no scheme is a way out, another local file included', () => {
	// The app's page is a file: address, so "it is only a file" is exactly the
	// navigation that must not be let through: a preload runs on whatever page
	// the window loads.
	const { wc } = pinned();

	for (const url of [
		'file:///etc/passwd',
		'file:///Applications/Toolkit.app/Contents/Resources/app.asar/src/renderer/other.html',
		'data:text/html,<p>hello</p>',
		'javascript:void 0',
		'about:blank',
		'wpct://ticket/1'
	]) {
		assert.equal(wc.emit('will-navigate', url), true, url);
	}
});

test('the page reloading itself is left alone', () => {
	// A reload the page asks for is a navigation to its own address. Cancelling
	// it would break `location.reload()`, and offering it to the browser would
	// log a refused file: address for something that went nowhere.
	const { wc, offered } = pinned();

	assert.equal(wc.emit('will-navigate', APP_PAGE), false);
	assert.equal(wc.emit('will-navigate', `${APP_PAGE}#section`), false);
	assert.deepEqual(offered, []);
});

test('the page it may stay on is the one it is on, not one fixed address', () => {
	// Read from the window at the moment of the event, so there is no second
	// copy of the app's address to keep in step with where main.js loads it
	// from, and no path to normalise across platforms.
	const { wc } = pinned('file:///C:/Program%20Files/Toolkit/resources/app.asar/src/renderer/index.html#ticket');

	assert.equal(wc.emit('will-navigate', 'file:///C:/Program%20Files/Toolkit/resources/app.asar/src/renderer/index.html'), false);
	assert.equal(wc.emit('will-navigate', APP_PAGE), true);
});

test('an event that carries no address is cancelled, not let through', () => {
	// The address is read off the event. If a later Electron delivered it
	// somewhere else, the comparison has to fail towards staying put.
	const { wc, offered } = pinned();

	assert.equal(wc.emit('will-navigate', undefined), true);
	assert.deepEqual(offered, [undefined]);
});
