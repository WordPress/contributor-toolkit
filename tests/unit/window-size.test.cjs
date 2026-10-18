const test = require('node:test');
const assert = require('node:assert/strict');

const { mainWindowSize, DEFAULT_SIZE, MINIMUM_SIZE } = require('../../src/window-size.cjs');

test('on a screen with room, the window opens at the size the shell is designed for', () => {
	assert.deepEqual(mainWindowSize({ width: 1920, height: 1080 }), {
		width: DEFAULT_SIZE.width,
		height: DEFAULT_SIZE.height,
		minWidth: MINIMUM_SIZE.width,
		minHeight: MINIMUM_SIZE.height
	});
});

test('the default is wide enough for the sites list and a two-column page', () => {
	// 320 for the list and 960 for the page; see the module's header.
	assert.ok(DEFAULT_SIZE.width >= 320 + 960);
});

test('a screen shorter than the default gives the window its own height', () => {
	// A 1366×768 laptop with a 40px taskbar.
	const size = mainWindowSize({ width: 1366, height: 728 });
	assert.equal(size.width, 1280);
	assert.equal(size.height, 728);
	assert.equal(size.minHeight, 600);
});

test('a screen narrower than the default gives the window its own width', () => {
	const size = mainWindowSize({ width: 1024, height: 768 });
	assert.equal(size.width, 1024);
	assert.equal(size.height, 768);
});

test('the minimum never exceeds what the window opens at', () => {
	const size = mainWindowSize({ width: 640, height: 480 });
	assert.deepEqual(size, { width: 640, height: 480, minWidth: 640, minHeight: 480 });
});

test('a work area that cannot be read leaves the defaults standing', () => {
	for (const workArea of [undefined, null, {}, { width: 0, height: 0 }, { width: NaN, height: -1 }]) {
		assert.deepEqual(mainWindowSize(workArea), {
			width: DEFAULT_SIZE.width,
			height: DEFAULT_SIZE.height,
			minWidth: MINIMUM_SIZE.width,
			minHeight: MINIMUM_SIZE.height
		});
	}
});

test('a fractional work area is rounded down, since a window has whole pixels', () => {
	assert.equal(mainWindowSize({ width: 1100.7, height: 700.2 }).width, 1100);
	assert.equal(mainWindowSize({ width: 1100.7, height: 700.2 }).height, 700);
});
