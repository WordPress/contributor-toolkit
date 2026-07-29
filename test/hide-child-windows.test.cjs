const test = require('node:test');
const assert = require('node:assert/strict');

const { patchChildProcess } = require('../src/hide-child-windows.js');

// A stand-in for the child_process module that records what it was called with,
// so the patch can be exercised without actually spawning anything.
function fakeChildProcess() {
	const calls = [];
	const record = (name) => (...args) => {
		calls.push({ name, args });
		return name;
	};
	return {
		calls,
		spawn: record('spawn'),
		spawnSync: record('spawnSync'),
		exec: record('exec'),
		execSync: record('execSync'),
		execFile: record('execFile'),
		execFileSync: record('execFileSync'),
		fork: record('fork')
	};
}

test('leaves child_process untouched off Windows', () => {
	// Forcing windowsHide elsewhere is pointless and would be a silent behaviour
	// change on the platforms where the flashes never happened.
	const cp = fakeChildProcess();
	const originalSpawn = cp.spawn;
	patchChildProcess(cp, 'darwin');
	assert.equal(cp.spawn, originalSpawn);
	cp.spawn('cmd', ['/c', 'x']);
	assert.deepEqual(cp.calls[0].args, ['cmd', ['/c', 'x']]);
});

test('appends an options object when the caller passed none', () => {
	// npm spawns cmd.exe as spawn(cmd, args) with no options in some paths, so
	// the options object has to be created rather than only amended.
	const cp = fakeChildProcess();
	patchChildProcess(cp, 'win32');
	cp.spawn('cmd', ['/d', '/s', '/c', 'grunt build']);
	assert.deepEqual(cp.calls[0].args, [
		'cmd',
		['/d', '/s', '/c', 'grunt build'],
		{ windowsHide: true }
	]);
});

test("preserves the caller's other options and overrides windowsHide: false", () => {
	const cp = fakeChildProcess();
	patchChildProcess(cp, 'win32');
	const options = { cwd: 'C:\\site', windowsHide: false, stdio: 'pipe' };
	cp.spawn('cmd', ['/c', 'x'], options);
	assert.deepEqual(cp.calls[0].args[2], {
		cwd: 'C:\\site',
		windowsHide: true,
		stdio: 'pipe'
	});
	// The caller's object must not be mutated — npm reuses option objects.
	assert.equal(options.windowsHide, false);
});

test('inserts options before a trailing callback', () => {
	// exec(cmd, cb) and execFile(file, args, cb) put the callback last; appending
	// options at the end would make Node treat the callback as options.
	const cp = fakeChildProcess();
	patchChildProcess(cp, 'win32');
	const cb = () => {};

	cp.exec('grunt build', cb);
	assert.deepEqual(cp.calls[0].args, ['grunt build', { windowsHide: true }, cb]);

	cp.execFile('grunt.cmd', ['build'], cb);
	assert.deepEqual(cp.calls[1].args, ['grunt.cmd', ['build'], { windowsHide: true }, cb]);

	cp.exec('grunt build', { cwd: 'C:\\site' }, cb);
	assert.deepEqual(cp.calls[2].args, ['grunt build', { cwd: 'C:\\site', windowsHide: true }, cb]);
});

test('patches every child_process entry point', () => {
	const cp = fakeChildProcess();
	patchChildProcess(cp, 'win32');
	for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
		cp[name]('x');
	}
	for (const call of cp.calls) {
		const last = call.args[call.args.length - 1];
		assert.equal(last.windowsHide, true, `${call.name} was not patched`);
	}
});

test('passes the underlying return value through', () => {
	const cp = fakeChildProcess();
	patchChildProcess(cp, 'win32');
	assert.equal(cp.spawn('cmd'), 'spawn');
});

test('patching twice does not wrap twice', () => {
	// The runners require this module once each, but a double-require must not
	// stack wrappers or the options object would be cloned repeatedly.
	const cp = fakeChildProcess();
	patchChildProcess(cp, 'win32');
	const patchedSpawn = cp.spawn;
	patchChildProcess(cp, 'win32');
	assert.equal(cp.spawn, patchedSpawn);
	cp.spawn('cmd', ['/c', 'x']);
	assert.equal(cp.calls[0].args.length, 3);
});
