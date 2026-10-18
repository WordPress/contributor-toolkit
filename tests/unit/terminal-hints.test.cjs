'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { computeTerminalBusy } = require('../../src/renderer/terminal-hints.cjs');

test('an idle terminal is free, so the hint links stay clickable (issue #182)', () => {
	assert.strictEqual(computeTerminalBusy({}), false);
	assert.strictEqual(computeTerminalBusy(), false, 'no flags at all must not read as busy');
});

test('a command typed at the prompt makes the terminal busy (issue #182)', () => {
	// The regression this file exists for: the first version of the predicate
	// read only the checklist and chain flags, none of which move when the
	// contributor types a command themselves. `npm run watch` set the terminal
	// state machine's `running` flag and nothing else, so the hint links kept
	// rendering as enabled while the prompt refused every click — and watch
	// never exits, so it stayed that way for the whole session.
	assert.strictEqual(computeTerminalBusy({ terminalRunning: true }), true);
});

test('the checklist buttons make the terminal busy without claiming the prompt (issue #182)', () => {
	// runInstallWithTerminal / runBuildWithTerminal stream into the terminal but
	// never set its `running` flag, so these two flags are load-bearing rather
	// than redundant.
	assert.strictEqual(computeTerminalBusy({ installing: true }), true);
	assert.strictEqual(computeTerminalBusy({ building: true }), true);
});

test('a dev server and its watcher hold the terminal for the whole session', () => {
	assert.strictEqual(computeTerminalBusy({ starting: true }), true);
	assert.strictEqual(computeTerminalBusy({ running: true }), true);
});

test('the update and apply chains hold the terminal', () => {
	assert.strictEqual(computeTerminalBusy({ isUpdating: true }), true);
	assert.strictEqual(computeTerminalBusy({ isApplying: true }), true);
});

test('any one flag is enough — none of them cancels another out', () => {
	const flags = ['terminalRunning', 'installing', 'building', 'starting', 'running', 'isUpdating', 'isApplying'];
	for (const flag of flags) {
		const allOthersFalse = Object.fromEntries(flags.map((f) => [f, f === flag]));
		assert.strictEqual(computeTerminalBusy(allOthersFalse), true, `${flag} alone must read as busy`);
	}
});

test('the result is a boolean, not whichever flag happened to be truthy', () => {
	// The value is spread into a prop, so a leaked string or object would render.
	assert.strictEqual(computeTerminalBusy({ installing: 'yes' }), true);
	assert.strictEqual(computeTerminalBusy({ installing: undefined }), false);
});

// --- Whether a run's end brings the terminal up (#558) ---------------------

const { runFailedInTerminal } = require( '../../src/renderer/terminal-hints.cjs' );

test( 'a run that ends badly with its output in the terminal brings the terminal up', () => {
	assert.equal( runFailedInTerminal( { code: 1 } ), true );
	// One that never started has no code of its own.
	assert.equal( runFailedInTerminal( { code: -1 } ), true );
	// Killed by something other than the app: no code at all.
	assert.equal( runFailedInTerminal( { code: null } ), true );
} );

test( 'a run that ended well does not', () => {
	assert.equal( runFailedInTerminal( { code: 0 } ), false );
} );

test( 'a run that was asked to stop did not fail, whatever it ended with', () => {
	assert.equal( runFailedInTerminal( { code: null, stopRequested: true } ), false );
	assert.equal( runFailedInTerminal( { code: 1, stopRequested: true } ), false );
	assert.equal( runFailedInTerminal( { code: 143, stopRequested: true } ), false );
} );

test( 'a run whose output is somewhere else does not bring the terminal up', () => {
	assert.equal( runFailedInTerminal( { code: 1, outputInTerminal: false } ), false );
} );
