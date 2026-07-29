const test = require('node:test');
const assert = require('node:assert');

const { resolveSpawnTarget, applyPatch, PATCH_MARKER } = require('../src/win-spawn-patch.js');

// The Windows shim layout ensureNodeShimDir() writes, as the patch sees it.
const WIN = {
	platform: 'win32',
	execPath: 'C:\\App\\App.exe',
	npmCliPath: 'C:\\App\\resources\\app.asar\\node_modules\\npm\\bin\\npm-cli.js',
	npxCliPath: 'C:\\App\\resources\\app.asar\\node_modules\\npm\\bin\\npx-cli.js',
	env: { Path: 'C:\\shims;C:\\Windows', PATHEXT: '.COM;.EXE;.BAT;.CMD' },
	lookup: (file) => {
		const known = {
			node: 'C:\\shims\\node.cmd',
			grunt: 'C:\\site\\node_modules\\.bin\\grunt.cmd',
			mysqld: 'C:\\tools\\mysqld.exe'
		};
		return known[String(file).toLowerCase()] || null;
	}
};

// The exact call wordpress-develop's Gruntfile makes in gutenberg:verify.
test('a bare `node` spawn is redirected to Electron in Node mode, without a shell', () => {
	const target = resolveSpawnTarget({
		...WIN,
		file: 'node',
		args: ['tools/gutenberg/utils.js'],
		options: { stdio: 'inherit' }
	});

	assert.equal(target.file, 'C:\\App\\App.exe');
	assert.deepEqual(target.args, ['tools/gutenberg/utils.js']);
	assert.equal(target.options.stdio, 'inherit');
	assert.equal(target.options.env.ELECTRON_RUN_AS_NODE, '1');
	// No shell means no quoting hazard — that is the point of this branch.
	assert.ok(!target.options.shell);
});

test('node.cmd and NODE.EXE resolve to the same redirect as bare node', () => {
	for (const file of ['node.cmd', 'C:\\shims\\node.bat', 'NODE.EXE']) {
		const target = resolveSpawnTarget({ ...WIN, file, args: ['x.js'] });
		assert.equal(target.file, 'C:\\App\\App.exe', file);
		assert.deepEqual(target.args, ['x.js'], file);
	}
});

test('npm and npx are redirected to their JS CLIs', () => {
	const npm = resolveSpawnTarget({ ...WIN, file: 'npm', args: ['ci'] });
	assert.deepEqual(npm.args, [WIN.npmCliPath, 'ci']);
	assert.equal(npm.file, WIN.execPath);

	const npx = resolveSpawnTarget({ ...WIN, file: 'npx.cmd', args: ['wp-scripts', 'build'] });
	assert.deepEqual(npx.args, [WIN.npxCliPath, 'wp-scripts', 'build']);
});

test('npm falls through to the shell branch when no npm CLI path is known', () => {
	const target = resolveSpawnTarget({
		...WIN,
		npmCliPath: null,
		file: 'npm',
		args: ['ci'],
		lookup: () => 'C:\\shims\\npm.cmd'
	});
	assert.equal(target.options.shell, true);
	assert.equal(target.file, '"C:\\shims\\npm.cmd"');
});

test('the caller\'s env is cloned, never mutated', () => {
	const callerEnv = { PATH: 'C:\\Windows' };
	const target = resolveSpawnTarget({ ...WIN, file: 'node', args: [], options: { env: callerEnv } });

	assert.equal(target.options.env.PATH, 'C:\\Windows');
	assert.equal(target.options.env.ELECTRON_RUN_AS_NODE, '1');
	assert.equal(callerEnv.ELECTRON_RUN_AS_NODE, undefined);
});

test('any other .cmd shim gets shell:true with cmd-safe quoting', () => {
	const target = resolveSpawnTarget({
		...WIN,
		file: 'grunt',
		args: ['build', '--base=C:\\My Sites\\wp', 'plain']
	});

	assert.equal(target.options.shell, true);
	assert.equal(target.file, '"C:\\site\\node_modules\\.bin\\grunt.cmd"');
	// Only the argument cmd.exe would mis-split is quoted.
	assert.deepEqual(target.args, ['build', '"--base=C:\\My Sites\\wp"', 'plain']);
});

test('commands that Windows can exec directly are left alone', () => {
	assert.equal(resolveSpawnTarget({ ...WIN, file: 'mysqld', args: [] }), null);
	assert.equal(resolveSpawnTarget({ ...WIN, file: 'C:\\tools\\thing.exe', args: [] }), null);
	// Unresolvable name: leave it be so the caller sees the real ENOENT.
	assert.equal(resolveSpawnTarget({ ...WIN, file: 'nonesuch', args: [] }), null);
});

test('a call that already asked for a shell is left alone', () => {
	assert.equal(
		resolveSpawnTarget({ ...WIN, file: 'node', args: ['x.js'], options: { shell: true } }),
		null
	);
});

test('nothing is rewritten off Windows', () => {
	for (const platform of ['darwin', 'linux']) {
		assert.equal(resolveSpawnTarget({ ...WIN, platform, file: 'node', args: ['x.js'] }), null, platform);
	}
});

test('applyPatch rewrites spawn arguments in every optional-argument shape', () => {
	const calls = [];
	const fake = {
		spawn: (...args) => { calls.push(args); return 'spawned'; },
		spawnSync: (...args) => { calls.push(args); },
		execFile: (...args) => { calls.push(args); },
		execFileSync: (...args) => { calls.push(args); }
	};
	applyPatch(fake, { platform: 'win32', execPath: WIN.execPath, lookup: WIN.lookup, env: WIN.env });

	assert.equal(fake.spawn('node', ['a.js']), 'spawned');
	assert.deepEqual(calls[0][0], WIN.execPath);
	assert.deepEqual(calls[0][1], ['a.js']);

	// No args array, no options.
	fake.spawn('node');
	assert.deepEqual(calls[1][1], []);

	// Trailing callback (execFile) must survive the rewrite.
	const cb = () => {};
	fake.execFile('node', ['a.js'], { cwd: 'C:\\site' }, cb);
	assert.equal(calls[2][2].cwd, 'C:\\site');
	assert.equal(calls[2][3], cb);
});

test('applyPatch is idempotent so a duplicated --require cannot double-wrap', () => {
	let depth = 0;
	const fake = { spawn: () => { depth += 1; } };
	applyPatch(fake, { platform: 'darwin' });
	const afterFirst = fake.spawn;
	applyPatch(fake, { platform: 'darwin' });

	assert.equal(fake.spawn, afterFirst);
	assert.equal(fake[PATCH_MARKER], true);
	fake.spawn('node');
	assert.equal(depth, 1);
});
