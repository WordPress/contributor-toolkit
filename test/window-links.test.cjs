const test = require('node:test');
const assert = require('node:assert/strict');

const { openLinksExternally } = require('../src/window-links.js');

// Stands in for a window's webContents, so the gestures can be replayed without
// an Electron process - the same approach external-url.test.cjs takes with the
// shell.
function fakeWebContents(currentUrl = 'file:///Applications/toolkit/renderer/index.html') {
	const listeners = {};
	return {
		windowOpenHandler: null,
		getURL() { return currentUrl; },
		setWindowOpenHandler(handler) { this.windowOpenHandler = handler; },
		on(event, listener) { (listeners[event] ||= []).push(listener); },
		// Replays a gesture; returns whether the navigation was cancelled.
		emit(event, url) {
			let prevented = false;
			const fakeEvent = { preventDefault() { prevented = true; } };
			for (const listener of listeners[event] || []) listener(fakeEvent, url);
			return prevented;
		}
	};
}

function recorder() {
	const opened = [];
	const refused = [];
	return {
		opened,
		refused,
		deps: {
			openExternal: async (url) => { opened.push(url); },
			onRefused: (description) => { refused.push(description); }
		}
	};
}

// The hand-off is a promise the synchronous handlers cannot await.
const settled = () => new Promise((resolve) => setImmediate(resolve));

test('a middle click opens the browser instead of a window (#284)', async () => {
	const wc = fakeWebContents();
	const rec = recorder();
	openLinksExternally(wc, rec.deps);

	const result = wc.windowOpenHandler({ url: 'http://127.0.0.1:39372/wp-admin/' });
	await settled();

	assert.deepEqual(result, { action: 'deny' });
	assert.deepEqual(rec.opened, ['http://127.0.0.1:39372/wp-admin/']);
});

test('a click no handler cancelled still opens the browser', async () => {
	const wc = fakeWebContents();
	const rec = recorder();
	openLinksExternally(wc, rec.deps);

	assert.equal(wc.emit('will-navigate', 'https://core.trac.wordpress.org/ticket/284'), true);
	await settled();

	assert.deepEqual(rec.opened, ['https://core.trac.wordpress.org/ticket/284']);
});

test('a redirect cannot move the app window either', async () => {
	// will-redirect covers the 3xx and <meta refresh> that never fire
	// will-navigate - a login redirect on the site would land here.
	const wc = fakeWebContents();
	const rec = recorder();
	openLinksExternally(wc, rec.deps);

	assert.equal(wc.emit('will-redirect', 'https://wordpress.org/'), true);
	await settled();

	assert.deepEqual(rec.opened, ['https://wordpress.org/']);
});

test('a reload is let through', async () => {
	// A reload asks to navigate to the page already loaded. Cancelling it would
	// stop the app window reloading.
	const wc = fakeWebContents('file:///Applications/toolkit/renderer/index.html');
	const rec = recorder();
	openLinksExternally(wc, rec.deps);

	assert.equal(wc.emit('will-navigate', 'file:///Applications/toolkit/renderer/index.html'), false);
	await settled();

	assert.deepEqual(rec.opened, []);
	assert.deepEqual(rec.refused, []);
});

test('the window cannot be navigated off its own page', async () => {
	// The window renders content the app does not author - a captured email body
	// among it - and a link in there can point at a local path or at one relative
	// to the app's own file: origin. Neither is a page this window shows, and
	// neither is an address to hand to the OS.
	const wc = fakeWebContents('file:///Applications/toolkit/renderer/index.html');
	const rec = recorder();
	openLinksExternally(wc, rec.deps);

	for (const url of [
		'file:///Applications/toolkit/renderer/other.html',
		'file:///etc/passwd'
	]) {
		assert.equal(wc.emit('will-navigate', url), true, `${url} should be refused`);
	}
	await settled();

	// Refused by the gate rather than opened, and each refusal is logged.
	assert.deepEqual(rec.opened, []);
	assert.equal(rec.refused.length, 2);
});

test('a scheme the app does not open is refused, and opens no window', async () => {
	const wc = fakeWebContents();
	const rec = recorder();
	openLinksExternally(wc, rec.deps);

	assert.deepEqual(wc.windowOpenHandler({ url: 'file:///etc/passwd' }), { action: 'deny' });
	await settled();

	assert.deepEqual(rec.opened, []);
	assert.equal(rec.refused.length, 1);
});

test('a failed open is reported, not swallowed', async () => {
	// shell.openExternal rejects when the OS has nothing registered. Nothing else
	// is in a position to catch it, and an unreported failure is a link that did
	// nothing.
	const wc = fakeWebContents();
	const failures = [];
	openLinksExternally(wc, {
		openExternal: async () => { throw new Error('no handler'); },
		onFailed: (url, error) => { failures.push([url, error.message]); }
	});

	wc.emit('will-navigate', 'https://example.com/');
	wc.windowOpenHandler({ url: 'https://example.com/' });
	await settled();

	assert.deepEqual(failures, [
		['https://example.com/', 'no handler'],
		['https://example.com/', 'no handler']
	]);
});

test('a failure with no reporter still does not crash the app', async () => {
	const wc = fakeWebContents();
	openLinksExternally(wc, { openExternal: async () => { throw new Error('no handler'); } });

	wc.emit('will-navigate', 'https://example.com/');
	await settled();
});
