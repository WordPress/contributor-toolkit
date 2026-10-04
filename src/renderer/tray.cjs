'use strict';

/**
 * The tray along the bottom of the window (#558): what it can hold, how tall
 * it may be, and how many rows and columns of a terminal fit in it.
 *
 * The tray is one for the window. It holds one thing at a time, for the site
 * that is open, and the footer's buttons say which. What is decided here is
 * pure, so that `node --test` can ask it; the element, the dragging and the
 * terminal are the component's and the hook's.
 */

const { __ } = require( '@wordpress/i18n' );

// As tall as it opens, before anyone has dragged it.
const DEFAULT_TRAY_HEIGHT = 280;
// Never so short that what it holds has no line to show under its heading.
const MIN_TRAY_HEIGHT = 120;
// Never more than this share of the window: the page above it is where the
// work is, and the tray must not be able to cover it.
const MAX_TRAY_SHARE = 0.5;
// What one press of an arrow key moves the edge by.
const TRAY_KEY_STEP = 24;

/**
 * What the tray can hold, in the order the footer offers them. Each is named
 * twice: as the tray's heading, and as what its button in the footer does.
 *
 * @return {{id: string, title: string, toggle: string}[]} The trays.
 */
function trayList() {
	return [
		{ id: 'terminal', title: __( 'Terminal' ), toggle: __( 'Toggle Terminal' ) },
	];
}

/**
 * Which tray is open after a footer button is pressed: the one pressed, or
 * none when it was the open one.
 *
 * @param {string|null} current The tray that is open, if any.
 * @param {string}      pressed The tray whose button was pressed.
 * @return {string|null} The tray to show.
 */
function toggleTray( current, pressed ) {
	return current === pressed ? null : pressed;
}

/**
 * The shortest and the tallest the tray may be in a window of this height.
 * In a window too short for both, the share of the window wins: the page
 * keeps its half.
 *
 * @param {number} windowHeight
 * @return {{min: number, max: number}} In pixels.
 */
function trayHeightLimits( windowHeight ) {
	const max = Math.floor( windowHeight * MAX_TRAY_SHARE );
	return { min: Math.min( MIN_TRAY_HEIGHT, max ), max };
}

/**
 * A height the tray may have, nearest to the one asked for.
 *
 * @param {number}                     height
 * @param {{min: number, max: number}} limits
 * @return {number} In pixels, whole.
 */
function clampTrayHeight( height, limits ) {
	return Math.round( Math.min( Math.max( height, limits.min ), limits.max ) );
}

/**
 * The height a key asks for, on the tray's top edge. Up makes the tray
 * taller, since its edge moves up; Home and End are the two ends. Any other
 * key asks for nothing.
 *
 * @param {number}                     height
 * @param {string}                     key    `event.key`.
 * @param {{min: number, max: number}} limits
 * @return {number|null} The new height, or null for a key that is not one of these.
 */
function trayHeightForKey( height, key, limits ) {
	if ( key === 'ArrowUp' ) return clampTrayHeight( height + TRAY_KEY_STEP, limits );
	if ( key === 'ArrowDown' ) return clampTrayHeight( height - TRAY_KEY_STEP, limits );
	if ( key === 'Home' ) return limits.max;
	if ( key === 'End' ) return limits.min;
	return null;
}

/**
 * How many columns and rows of a terminal fit in a box.
 *
 * Whole cells only, and never fewer than a terminal can be read in. A box or
 * a cell that has no size yet, which is what an element that is not shown
 * measures, fits nothing: the terminal is left as it is until there is one.
 *
 * @param {Object} box
 * @param {number} box.width      The room for the rows, in pixels.
 * @param {number} box.height     The room for the rows, in pixels.
 * @param {number} box.cellWidth  One character's width.
 * @param {number} box.cellHeight One row's height.
 * @return {{cols: number, rows: number}|null} The grid, or null when there is nothing to measure.
 */
function terminalGrid( { width, height, cellWidth, cellHeight } ) {
	if ( ! ( width > 0 && height > 0 && cellWidth > 0 && cellHeight > 0 ) ) return null;
	return {
		cols: Math.max( 20, Math.floor( width / cellWidth ) ),
		rows: Math.max( 2, Math.floor( height / cellHeight ) ),
	};
}

module.exports = {
	DEFAULT_TRAY_HEIGHT,
	MIN_TRAY_HEIGHT,
	TRAY_KEY_STEP,
	trayList,
	toggleTray,
	trayHeightLimits,
	clampTrayHeight,
	trayHeightForKey,
	terminalGrid,
};
