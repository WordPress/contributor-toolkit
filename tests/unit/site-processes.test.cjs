const test = require('node:test');
const assert = require('node:assert/strict');

const { serverProcess, watchProcess } = require('../../src/renderer/site-processes.cjs');

test('a stopped server offers to start', () => {
	assert.deepEqual(serverProcess(), { status: 'offline', label: 'Server stopped', action: 'Start development server', short: 'Start', pending: false, disabled: false });
	assert.deepEqual(serverProcess({ active: false, starting: false }), serverProcess());
});

test('a running server offers to stop', () => {
	assert.deepEqual(serverProcess({ active: true }), { status: 'online', label: 'Server running', action: 'Stop development server', short: 'Stop', pending: false, disabled: false });
});

test('a server that is starting cannot be pressed, and says what it is doing', () => {
	// A second start would be a second server (#488), and there is nothing
	// to stop yet.
	const starting = serverProcess({ active: true, starting: true });
	assert.deepEqual(starting, { status: 'busy', label: 'Server starting…', action: 'Starting development server…', short: 'Starting…', pending: true, disabled: true });
	// Starting is what is said even when "active" has not caught up.
	assert.deepEqual(serverProcess({ active: false, starting: true }), starting);
});

test('an update of trunk holds the server\'s button, started or stopped', () => {
	assert.equal(serverProcess({ isUpdating: true }).disabled, true);
	assert.equal(serverProcess({ active: true, isUpdating: true }).disabled, true);
	assert.equal(serverProcess({ active: true, isUpdating: false }).disabled, false);
});

test('a watch that is watching offers to stop, and says what it watches', () => {
	assert.deepEqual(watchProcess({ state: 'watching', sourceDir: 'src/' }), {
		status: 'online', label: 'Build watching', action: 'Stop build watch', short: 'Stop', disabled: false,
		detail: 'Edits in src/ are compiled as they are saved.'
	});
	assert.equal(watchProcess({ state: 'watching' }).detail, '');
});

test('a watch compiling a change is busy, and is still the watch', () => {
	const compiling = watchProcess({ state: 'watching', compiling: true, sourceDir: 'src/' });
	assert.equal(compiling.status, 'busy');
	assert.equal(compiling.label, 'Build compiling');
	assert.equal(compiling.action, 'Stop build watch');
	// Compiling is only said of a watch that is watching.
	assert.equal(watchProcess({ state: 'idle', compiling: true }).label, 'Build stopped');
});

test('a watch building before it can watch is busy and can be stopped', () => {
	const building = watchProcess({ state: 'building' });
	assert.equal(building.status, 'busy');
	assert.equal(building.label, 'Build building');
	assert.equal(building.action, 'Stop build watch');
	assert.equal(building.detail, 'Building the site before watching it.');
});

test('a paused watch is busy, says it will come back, and offers to start as it always has', () => {
	const paused = watchProcess({ state: 'paused' });
	assert.equal(paused.status, 'busy');
	assert.equal(paused.label, 'Build paused');
	assert.equal(paused.action, 'Start build watch');
	assert.match(paused.detail, /comes back by itself/);
});

test('a watch that was never started, or was stopped, offers to start and has nothing to add', () => {
	for (const state of [undefined, 'idle', 'exited', 'something-else']) {
		assert.deepEqual(watchProcess({ state }), { status: 'offline', label: 'Build stopped', action: 'Start build watch', short: 'Start', disabled: false, detail: '' });
	}
	// Ended with nothing wrong: stopped, not failed.
	assert.equal(watchProcess({ state: 'exited', exitCode: 0 }).status, 'offline');
	assert.equal(watchProcess({ state: 'exited', exitCode: null }).status, 'offline');
});

test('a watch that ended by itself with an error says so, with the code', () => {
	const failed = watchProcess({ state: 'exited', exitCode: 2 });
	assert.equal(failed.status, 'failed');
	assert.equal(failed.label, 'Build stopped');
	assert.equal(failed.action, 'Start build watch');
	assert.equal(failed.detail, 'The build watch ended by itself, with exit code 2. Its last lines are in the Logs.');
});

test('an update of trunk holds the watch\'s button, unless the update is waiting for the watch', () => {
	assert.equal(watchProcess({ state: 'watching', isUpdating: true }).disabled, true);
	assert.equal(watchProcess({ state: 'idle', isUpdating: true }).disabled, true);
	// #507: the one way out of a watch that never gets ready.
	assert.equal(watchProcess({ state: 'building', isUpdating: true, updateWaitingOnWatch: true }).disabled, false);
	assert.equal(watchProcess({ state: 'building', isUpdating: false, updateWaitingOnWatch: true }).disabled, false);
});

test('no arguments at all is a stopped watch', () => {
	assert.equal(watchProcess().label, 'Build stopped');
});
