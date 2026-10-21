// Guards which PHP versions the packaged app carries (#704).
//
// @wp-playground/cli installs one @php-wasm/node-X-Y package per PHP version it knows, about 30 MB
// each once the asyncify builds are gone, including versions the app never offers: the settings
// list only `SupportedPHPVersions` (#559), and a stored version outside it starts on the fallback.
// build.files in package.json leaves each other version out by name. A Playground update that
// drops a version from the list, or ships a new legacy one, changes which names those are; this
// test fails then, naming the exclusion to add or remove.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { SupportedPHPVersions } = require('@php-wasm/universal');
const { build } = require('../../package.json');

const PHP_WASM_DIR = path.join(path.dirname(require.resolve('@php-wasm/universal/package.json')), '..');

// The PHP version each installed build package is for: `node-8-3` is 8.3.
function installedBuilds() {
	return fs.readdirSync(PHP_WASM_DIR)
		.map((name) => /^node-(\d+)-(\d+)$/.exec(name))
		.filter(Boolean)
		.map(([name, major, minor]) => ({ name, version: `${major}.${minor}` }));
}

const exclusion = (name) => `!node_modules/@php-wasm/${name}{,/**/*}`;

test('build.files leaves out every PHP build the app cannot offer, and only those', () => {
	const builds = installedBuilds();
	assert.ok(builds.length > 0, `no @php-wasm/node-X-Y packages in ${PHP_WASM_DIR}`);

	const unsupported = builds.filter(({ version }) => !SupportedPHPVersions.includes(version)).map(({ name }) => exclusion(name));
	const supported = builds.filter(({ version }) => SupportedPHPVersions.includes(version)).map(({ name }) => exclusion(name));

	assert.deepEqual(
		unsupported.filter((pattern) => !build.files.includes(pattern)),
		[],
		'add these to build.files in package.json: SupportedPHPVersions does not offer their PHP version'
	);
	assert.deepEqual(
		supported.filter((pattern) => build.files.includes(pattern)),
		[],
		'remove these from build.files in package.json: their PHP version is one the settings offer'
	);
});

test('every PHP version the settings offer has a build installed', () => {
	const installed = installedBuilds().map(({ version }) => version);
	assert.deepEqual(SupportedPHPVersions.filter((version) => !installed.includes(version)), []);
});
