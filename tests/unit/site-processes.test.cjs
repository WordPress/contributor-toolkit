const test = require('node:test');
const assert = require('node:assert/strict');

const { serverProcess, watchProcess, serverLinks, serverSection, ADMIN_CREDENTIALS } = require('../../src/renderer/site-processes.cjs');

test('a stopped server offers to start', () => {
	assert.deepEqual(serverProcess(), { status: 'offline', label: 'Server stopped', action: 'Start development server', short: 'Start', pending: false, disabled: false, detail: '' });
	assert.deepEqual(serverProcess({ active: false, starting: false }), serverProcess());
});

test('a running server offers to stop', () => {
	assert.deepEqual(serverProcess({ active: true }), { status: 'online', label: 'Server running', action: 'Stop development server', short: 'Stop', pending: false, disabled: false, detail: '' });
});

test('a server that is starting cannot be pressed, and says what it is doing', () => {
	// A second start would be a second server (#488), and there is nothing
	// to stop yet.
	const starting = serverProcess({ active: true, starting: true });
	assert.deepEqual(starting, { status: 'busy', label: 'Server starting…', action: 'Starting development server…', short: 'Starting…', pending: true, disabled: true, detail: '' });
	// Starting is what is said even when "active" has not caught up.
	assert.deepEqual(serverProcess({ active: false, starting: true }), starting);
});

test('a server that went by itself, or could not start, says so and where its last lines are, and offers to start', () => {
	const stopped = serverProcess({ failure: 'stopped' });
	assert.deepEqual(stopped, { status: 'failed', label: 'Server stopped', action: 'Start development server', short: 'Start', pending: false, disabled: false, detail: 'The development server stopped by itself. Its last lines are in the Logs.' });
	const start = serverProcess({ failure: 'start' });
	assert.equal(start.status, 'failed');
	assert.equal(start.detail, 'The development server could not start. Its last lines are in the Logs.');
	// A failure is of the last run: one that is starting or running again
	// has nothing to say of it.
	assert.equal(serverProcess({ failure: 'stopped', starting: true }).detail, '');
	assert.equal(serverProcess({ failure: 'start', active: true }).status, 'online');
	assert.equal(serverProcess({ failure: 'bogus' }).status, 'offline');
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
	for (const state of [undefined, 'idle', 'something-else']) {
		assert.deepEqual(watchProcess({ state }), { status: 'offline', label: 'Build stopped', action: 'Start build watch', short: 'Start', disabled: false, detail: '' });
	}
});

test('a watch that ended without being asked to is a failure whatever it ended with, and says what is known', () => {
	// The hook's 'exited' is only ever an end nobody asked for. Ending with
	// 0, or with no code at all when a signal killed it, is as much that as
	// ending with an error.
	const failed = watchProcess({ state: 'exited', exitCode: 2 });
	assert.equal(failed.status, 'failed');
	assert.equal(failed.label, 'Build stopped');
	assert.equal(failed.action, 'Start build watch');
	assert.equal(failed.detail, 'The build watch ended by itself, with exit code 2. Its last lines are in the Logs.');
	for (const exitCode of [0, null, undefined, NaN]) {
		const ended = watchProcess({ state: 'exited', exitCode });
		assert.equal(ended.status, 'failed', `exit code ${exitCode}`);
		assert.equal(ended.detail, 'The build watch ended by itself. Its last lines are in the Logs.');
	}
});

test('a build that failed before the watch could start is not called a watch that ended', () => {
	const failed = watchProcess({ state: 'exited', exitCode: 1, exitOf: 'build' });
	assert.equal(failed.status, 'failed');
	assert.equal(failed.action, 'Start build watch');
	assert.equal(failed.detail, 'The build that has to finish before the watch can start failed, with exit code 1, so the watch was not started. Its last lines are in the Logs.');
	assert.doesNotMatch(failed.detail, /ended by itself/);
	assert.equal(watchProcess({ state: 'exited', exitCode: null, exitOf: 'build' }).detail, 'The build that has to finish before the watch can start failed, so the watch was not started. Its last lines are in the Logs.');
	// Which process ended only matters once one has.
	assert.equal(watchProcess({ state: 'watching', exitOf: 'build' }).status, 'online');
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

const URL = 'http://127.0.0.1:8881/';

test('a server with no address has nowhere to send anyone', () => {
	assert.deepEqual(serverLinks(), []);
	assert.deepEqual(serverLinks({ url: '', running: true }), []);
});

test('a server with an address offers the site and its admin, and its database once it is running', () => {
	assert.deepEqual(serverLinks({ url: URL }), [
		{ id: 'site', label: 'View site', href: URL },
		{ id: 'admin', label: 'wp-admin', href: `${URL}wp-admin/` }
	]);
	assert.deepEqual(serverLinks({ url: URL, running: true }).at(-1), { id: 'database', label: 'Database', href: `${URL}adminer.php` });
	assert.equal(serverLinks({ url: URL, running: true }).length, 3);
});

test('the section of a server with an address shows where the site is and what to log in with', () => {
	assert.deepEqual(serverSection({ url: URL, running: true }), {
		state: 'online',
		links: serverLinks({ url: URL, running: true }),
		menuLinks: serverLinks({ url: URL, running: true }).slice(0, 2),
		credentials: ADMIN_CREDENTIALS,
		text: ''
	});
	assert.deepEqual(ADMIN_CREDENTIALS, { username: 'admin', password: 'password' });
	// An address is what counts, whatever else is said of the server.
	assert.equal(serverSection({ url: URL, starting: true }).state, 'online');
});

test('the header\'s menu is given the site and its admin, and never the database', () => {
	assert.deepEqual(serverSection({ url: URL, running: true }).menuLinks.map((link) => link.id), ['site', 'admin']);
	assert.deepEqual(serverSection({ url: URL }).menuLinks.map((link) => link.id), ['site', 'admin']);
	assert.deepEqual(serverSection({ starting: true }).menuLinks, []);
	assert.deepEqual(serverSection().menuLinks, []);
});

test('the section of a server that is starting says how long it has been', () => {
	const section = serverSection({ starting: true, elapsed: 65 });
	assert.equal(section.state, 'starting');
	assert.deepEqual(section.links, []);
	assert.deepEqual(section.menuLinks, []);
	assert.equal(section.credentials, null);
	assert.match(section.text, /^Dev server is starting… \(.+\)$/);
	assert.notEqual(serverSection({ starting: true, elapsed: 5 }).text, section.text);
});

test('the section of a stopped server shows nothing, which is drawn as offline', () => {
	assert.deepEqual(serverSection(), { state: 'offline', links: [], menuLinks: [], credentials: null, text: '' });
	assert.deepEqual(serverSection({ running: true }), { state: 'offline', links: [], menuLinks: [], credentials: null, text: '' });
});
