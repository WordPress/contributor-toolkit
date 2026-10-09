'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

function loadTracView(electron) {
	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (request === 'electron') return electron;
		return originalLoad.call(this, request, parent, isMain);
	};
	try {
		delete require.cache[require.resolve('../../src/trac-view.js')];
		return require('../../src/trac-view.js');
	} finally {
		Module._load = originalLoad;
	}
}

test('openAndScrape: a navigation that never finishes still reaches the ready timeout (issue #327)', async () => {
	let destroyed = false;
	class BrowserWindowStub {
		constructor() {
			this.webContents = {
				setWindowOpenHandler() {},
				on() {},
				executeJavaScript() { return Promise.resolve(false); }
			};
		}
		loadURL() { return new Promise(() => {}); }
		isDestroyed() { return destroyed; }
		destroy() { destroyed = true; }
		show() {}
	}

	const electron = {
		BrowserWindow: BrowserWindowStub,
		session: { fromPartition: () => ({ setUserAgent() {} }) }
	};
	const { openAndScrape } = loadTracView(electron);
	const harnessTimeout = new Promise((resolve) => {
		setTimeout(() => resolve({ status: 'test-harness-timeout' }), 50);
	});

	const result = await Promise.race([
		openAndScrape(56320, { readyTimeoutMs: 5 }),
		harnessTimeout
	]);

	assert.equal(result.status, 'challenge-timeout');
	assert.equal(destroyed, true, 'the hidden Trac window is cleaned up after timing out');
});

test('fetchAttachment: a refused download is said in the locale main applied (#628)', async (t) => {
	const { addFilter, removeFilter } = require('@wordpress/hooks');
	const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => removeFilter('i18n.gettext', 'test/pseudo-locale'));

	// Trac's answer stands in for the network, as the window does above.
	const originalLoad = Module._load;
	Module._load = function (request, parent, isMain) {
		if (request === './github-prs') return { httpGet: async () => ({ status: 403, body: '' }) };
		return originalLoad.call(this, request, parent, isMain);
	};
	let fetchAttachment;
	try {
		({ fetchAttachment } = loadTracView({ BrowserWindow: class {}, session: {} }));
	} finally {
		Module._load = originalLoad;
	}

	const result = await fetchAttachment('https://core.trac.wordpress.org/raw-attachment/ticket/1/a.diff');
	assert.equal(result.ok, false);
	assert.equal(result.error, pseudoLocalize('Trac returned %s — try opening the ticket again to pass the check.').replace('%s', '403'));
});

// The window is shown when Trac's check needs a click, and where Trac's page
// does not paint it is the colour it was made with: the app's theme (#560),
// which main holds and passes, not white on a dark desktop; the light theme's
// where main passes nothing. A deadline of now skips the poll.
test('openAndScrape: the Trac window is made in the colour of the app\'s theme', async () => {
	const { DARK_BACKGROUND, LIGHT_BACKGROUND } = require('../../src/theme.cjs');
	for (const [given, colour] of [[DARK_BACKGROUND, DARK_BACKGROUND], ['#102030', '#102030'], [undefined, LIGHT_BACKGROUND]]) {
		const made = [];
		class BrowserWindowStub {
			constructor(options) {
				made.push(options);
				this.webContents = {
					setWindowOpenHandler() {},
					on() {},
					executeJavaScript() { return Promise.resolve(false); }
				};
			}
			loadURL() { return Promise.resolve(); }
			isDestroyed() { return false; }
			destroy() {}
			show() {}
		}
		const electron = {
			BrowserWindow: BrowserWindowStub,
			session: { fromPartition: () => ({ setUserAgent() {} }) }
		};
		const { openAndScrape } = loadTracView(electron);

		await openAndScrape(56320, { readyTimeoutMs: 0, backgroundColor: given });

		assert.equal(made.length, 1);
		assert.equal(made[0].backgroundColor, colour, `given: ${given}`);
	}
});

// A journey that links a ticket reaches the real Trac, whose check is the page
// that shows the window. In a hidden e2e run (TOOLKIT_HIDE_WINDOWS) that window
// would take the focus from whoever is at the machine, so it stays hidden.
test('openAndScrape: Trac\'s check shows the window, except in a hidden e2e run', async () => {
	for (const hidden of [false, true]) {
		let shows = 0;
		let destroyed = false;
		// One poll that finds the check and not the ticket, then one that finds
		// the ticket, then empty scrapes: the stub ends the loop, so no deadline
		// decides whether the window was reached at all.
		const answers = [false, true];
		class BrowserWindowStub {
			constructor() {
				this.webContents = {
					setWindowOpenHandler() {},
					on() {},
					executeJavaScript() {
						return Promise.resolve(answers.length ? answers.shift() : '');
					}
				};
			}
			loadURL() { return Promise.resolve(); }
			isDestroyed() { return destroyed; }
			destroy() { destroyed = true; }
			show() { shows++; }
		}
		const electron = {
			BrowserWindow: BrowserWindowStub,
			session: { fromPartition: () => ({ setUserAgent() {} }) }
		};
		const { openAndScrape } = loadTracView(electron);

		const result = await openAndScrape(56320, { readyTimeoutMs: 60_000, hidden });

		assert.equal(result.status, 'no-attachments');
		assert.equal(answers.length, 0, 'the check was found, then the ticket');
		assert.equal(shows, hidden ? 0 : 1, `hidden: ${hidden}`);
	}
});
