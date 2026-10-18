// Where the sites list's context menu anchors, split out of
// sites-sidebar.jsx (#666) because that component cannot be loaded without a
// DOM, so nothing in the suite could reach its position arithmetic.
const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveContextMenuPosition } = require('../../src/renderer/context-menu-position.cjs');

const BOUNDS = { left: 100, top: 200, width: 40, height: 20 };

test('resolveContextMenuPosition uses the pointer\'s own point for a right-click', () => {
	assert.deepEqual(
		resolveContextMenuPosition({ type: 'contextmenu', clientX: 150, clientY: 210 }, BOUNDS),
		{ x: 150, y: 210 }
	);
});

test('resolveContextMenuPosition keeps a right-click at the viewport\'s corner, rather than falling back to the row', () => {
	// A real point of (0, 0) must not be mistaken for a missing one.
	assert.deepEqual(
		resolveContextMenuPosition({ type: 'contextmenu', clientX: 0, clientY: 0 }, BOUNDS),
		{ x: 0, y: 0 }
	);
});

test('resolveContextMenuPosition anchors a keyboard request to the pressed row\'s centre', () => {
	assert.deepEqual(
		resolveContextMenuPosition({ type: 'keydown', clientX: 0, clientY: 0 }, BOUNDS),
		{ x: 120, y: 210 }
	);
});
