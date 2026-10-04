'use strict';

// The tray along the bottom of the window (#558): what it holds, how tall it
// may be and how a terminal is fitted to it. The element and the dragging are
// the journeys'; these are the answers they are built on.

const test = require( 'node:test' );
const assert = require( 'node:assert/strict' );
const {
	DEFAULT_TRAY_HEIGHT,
	MIN_TRAY_HEIGHT,
	TRAY_KEY_STEP,
	trayList,
	toggleTray,
	trayAfterReveal,
	trayHeightLimits,
	clampTrayHeight,
	trayHeightForKey,
	terminalGrid,
} = require( '../../src/renderer/tray.cjs' );

test( 'each tray has an id of its own, a heading and a name for its button', () => {
	const trays = trayList();
	assert.ok( trays.length > 0 );
	assert.equal( new Set( trays.map( ( tray ) => tray.id ) ).size, trays.length );
	for ( const tray of trays ) {
		assert.ok( tray.title );
		assert.notEqual( tray.toggle, tray.title );
	}
	// In the order the footer offers them.
	assert.deepEqual( trays, [
		{ id: 'terminal', title: 'Terminal', toggle: 'Toggle Terminal' },
		{ id: 'logs', title: 'Logs', toggle: 'Toggle Logs' },
	] );
} );

test( 'a footer button opens its tray, swaps it for the open one, and closes it when it is the open one', () => {
	assert.equal( toggleTray( null, 'terminal' ), 'terminal' );
	assert.equal( toggleTray( 'logs', 'terminal' ), 'terminal' );
	assert.equal( toggleTray( 'terminal', 'terminal' ), null );
} );

test( 'asked for by the app, the terminal takes the tray whatever is in it, and the logs do not take the terminal\'s place', () => {
	assert.equal( trayAfterReveal( null, 'terminal' ), 'terminal' );
	assert.equal( trayAfterReveal( 'logs', 'terminal' ), 'terminal' );
	assert.equal( trayAfterReveal( 'terminal', 'terminal' ), 'terminal' );
	assert.equal( trayAfterReveal( null, 'logs' ), 'logs' );
	assert.equal( trayAfterReveal( 'logs', 'logs' ), 'logs' );
	assert.equal( trayAfterReveal( 'terminal', 'logs' ), 'terminal' );
} );

test( 'the tray is never taller than half the window, and never shorter than its floor while the window has room', () => {
	assert.deepEqual( trayHeightLimits( 800 ), { min: MIN_TRAY_HEIGHT, max: 400 } );
	assert.deepEqual( trayHeightLimits( 729 ), { min: MIN_TRAY_HEIGHT, max: 364 } );
	// A window too short for the floor: the page keeps its half.
	assert.deepEqual( trayHeightLimits( 200 ), { min: 100, max: 100 } );
	assert.deepEqual( trayHeightLimits( 300 ), { min: 150, max: 150 } );
	assert.ok( DEFAULT_TRAY_HEIGHT > MIN_TRAY_HEIGHT );
} );

test( 'a height is brought inside the limits, and to a whole pixel', () => {
	const limits = { min: 120, max: 400 };
	assert.equal( clampTrayHeight( 280, limits ), 280 );
	assert.equal( clampTrayHeight( 20, limits ), 120 );
	assert.equal( clampTrayHeight( 2000, limits ), 400 );
	assert.equal( clampTrayHeight( 280.6, limits ), 281 );
} );

test( 'the arrow keys move the edge a step, up for taller, and stop at the limits; Home is the smallest and End the largest', () => {
	const limits = { min: 120, max: 400 };
	assert.equal( trayHeightForKey( 280, 'ArrowUp', limits ), 280 + TRAY_KEY_STEP );
	assert.equal( trayHeightForKey( 280, 'ArrowDown', limits ), 280 - TRAY_KEY_STEP );
	assert.equal( trayHeightForKey( 395, 'ArrowUp', limits ), 400 );
	assert.equal( trayHeightForKey( 125, 'ArrowDown', limits ), 120 );
	assert.equal( trayHeightForKey( 280, 'Home', limits ), 120 );
	assert.equal( trayHeightForKey( 280, 'End', limits ), 400 );
	// Anything else is not the edge's to answer, Tab above all.
	assert.equal( trayHeightForKey( 280, 'Tab', limits ), null );
	assert.equal( trayHeightForKey( 280, 'ArrowLeft', limits ), null );
} );

test( 'a terminal is fitted in whole cells, and one that cannot be measured is left alone', () => {
	assert.deepEqual( terminalGrid( { width: 800, height: 200, cellWidth: 8, cellHeight: 17 } ), { cols: 100, rows: 11 } );
	assert.deepEqual( terminalGrid( { width: 807.9, height: 203.9, cellWidth: 8, cellHeight: 17 } ), { cols: 100, rows: 11 } );
	// Too small to read in: it keeps a size that can be, and is clipped.
	assert.deepEqual( terminalGrid( { width: 40, height: 10, cellWidth: 8, cellHeight: 17 } ), { cols: 20, rows: 2 } );
	// Not shown: every measure is zero.
	assert.equal( terminalGrid( { width: 0, height: 0, cellWidth: 8, cellHeight: 17 } ), null );
	assert.equal( terminalGrid( { width: 800, height: 200, cellWidth: 0, cellHeight: 0 } ), null );
	assert.equal( terminalGrid( { width: 800, height: 200, cellWidth: NaN, cellHeight: 17 } ), null );
} );
