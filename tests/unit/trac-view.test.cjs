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
