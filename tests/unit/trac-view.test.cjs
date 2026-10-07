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
		nativeTheme: { shouldUseDarkColors: false },
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

// The window is shown when Trac's check needs a click, and where Trac's page
// does not paint it is the colour it was made with: the app's theme (#560),
// not white on a dark desktop. A deadline already passed skips the poll.
test('openAndScrape: the Trac window is made in the colour of the app\'s theme', async () => {
	const { DARK_BACKGROUND, LIGHT_BACKGROUND } = require('../../src/theme.cjs');
	for (const [dark, colour] of [[true, DARK_BACKGROUND], [false, LIGHT_BACKGROUND]]) {
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
			nativeTheme: { shouldUseDarkColors: dark },
			session: { fromPartition: () => ({ setUserAgent() {} }) }
		};
		const { openAndScrape } = loadTracView(electron);

		await openAndScrape(56320, { readyTimeoutMs: 0 });

		assert.equal(made.length, 1);
		assert.equal(made[0].backgroundColor, colour, `dark: ${dark}`);
	}
});
