// How large the main window opens, and how small it may be made (#555).
//
// The shell is a 320px sites list beside the open site's page, and the page
// lays its cards out in two columns from 960px up, so 1280 is the narrowest
// window that shows both as designed. That is larger than some screens: a
// 1366×768 laptop has less height than 800 once the taskbar is taken off, so
// both sizes give way to the room there is.
'use strict';

const DEFAULT_SIZE = { width: 1280, height: 800 };
// With the sites list closed, what is left is the page at the width it had
// before there was a list.
const MINIMUM_SIZE = { width: 800, height: 600 };

/**
 * The size options for the main window on a screen with the given work area.
 *
 * @param {{width: number, height: number}} [workArea] The primary display's work area. Missing or unusable, the defaults stand.
 * @return {{width: number, height: number, minWidth: number, minHeight: number}}
 */
function mainWindowSize(workArea) {
	const room = (value, fallback) => (Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback);
	const maxWidth = room(workArea && workArea.width, DEFAULT_SIZE.width);
	const maxHeight = room(workArea && workArea.height, DEFAULT_SIZE.height);
	const width = Math.min(DEFAULT_SIZE.width, maxWidth);
	const height = Math.min(DEFAULT_SIZE.height, maxHeight);
	return {
		width,
		height,
		minWidth: Math.min(MINIMUM_SIZE.width, width),
		minHeight: Math.min(MINIMUM_SIZE.height, height)
	};
}

module.exports = { mainWindowSize, DEFAULT_SIZE, MINIMUM_SIZE };
