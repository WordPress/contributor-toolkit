'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { xdebugLaunchConfigFile } = require('../../src/xdebug-launch-file.cjs');

function makeSite(t) {
	const site = fs.mkdtempSync(path.join(os.tmpdir(), 'xdebug-launch-file-'));
	t.after(() => fs.rmSync(site, { recursive: true, force: true }));
	return site;
}

function dependencies(site, overrides = {}) {
	return {
		sites: [site],
		pending: [],
		realPath: (target) => fs.promises.realpath(target),
		stat: (target) => fs.promises.stat(target),
		mkdir: (target, options) => fs.promises.mkdir(target, options),
		writeFile: (target, content, options) => fs.promises.writeFile(target, content, options),
		...overrides
	};
}

test('checks for launch.json, creates it when missing, and leaves an existing file untouched', async (t) => {
	const site = makeSite(t);
	const config = JSON.stringify({ version: '0.2.0', configurations: [{ name: 'Listen for Xdebug' }] }, null, 2);
	const deps = dependencies(site, { config });

	assert.deepEqual(await xdebugLaunchConfigFile(site, deps), { ok: true, exists: false, created: false });
	assert.deepEqual(await xdebugLaunchConfigFile(site, { ...deps, create: true }), { ok: true, exists: true, created: true });
	const launchFile = path.join(site, '.vscode', 'launch.json');
	assert.equal(fs.readFileSync(launchFile, 'utf8'), config);

	const contributorConfig = '{"myConfiguration":true}\n';
	fs.writeFileSync(launchFile, contributorConfig);
	assert.deepEqual(await xdebugLaunchConfigFile(site, { ...deps, create: true }), { ok: true, exists: true, created: false });
	assert.equal(fs.readFileSync(launchFile, 'utf8'), contributorConfig);
});

test('refuses to create a launch file for an unregistered site', async (t) => {
	const site = makeSite(t);
	const result = await xdebugLaunchConfigFile(site, dependencies(site, { sites: [], create: true, config: '{}' }));

	assert.deepEqual(result, { ok: false, reason: 'unregistered-site' });
	assert.equal(fs.existsSync(path.join(site, '.vscode')), false);
});

test('refuses an invalid launch configuration without creating a file', async (t) => {
	const site = makeSite(t);
	const result = await xdebugLaunchConfigFile(site, dependencies(site, { create: true, config: 'not JSON' }));

	assert.deepEqual(result, { ok: false, reason: 'invalid-config' });
	assert.equal(fs.existsSync(path.join(site, '.vscode')), false);
});