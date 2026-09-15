// Guards the floor on the npm the app ships, the way electron-node-version.test.cjs guards the
// Node it ships.
//
// The two upstreams this app installs set that floor: wordpress-develop through `engines.npm`,
// which the runners relax with `npm_config_engine_strict=false`, and Gutenberg through
// `devEngines.packageManager` with `onFail: error`, which nothing relaxes: `npm ci` refuses
// before it reads the lockfile. A bundled npm below the floor therefore fails a Gutenberg
// install in under a second with `EBADDEVENGINES`, which the app's engine-mismatch detector
// does not recognise and cannot retry around (#251).
//
// The floor lives in package.json's own dependency range, so this reads it from there rather
// than repeating the number: the assertion is that what npm resolved into node_modules is inside
// the range package.json declares, and that the range itself does not drop below what the
// upstreams need.

const test = require('node:test');
const assert = require('node:assert/strict');

const { dependencies } = require('../../package.json');
const { version: bundledNpmVersion } = require('npm/package.json');

// The higher of the two upstream floors, both `>=11.16.0` as of 2026-09-15: wordpress-develop's
// `engines.npm` and Gutenberg's `devEngines.packageManager`. Raise it when they do.
const UPSTREAM_NPM_FLOOR = '11.16.0';

function parseVersion(version) {
	const match = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(version);
	assert.ok(match, `unparseable version: ${version}`);
	return [match[1], match[2], match[3]].map((part) => Number(part ?? 0));
}

function compareVersions(a, b) {
	for (let i = 0; i < 3; i += 1) {
		if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
	}
	return 0;
}

// The one clause shape package.json uses for npm, `^x.y.z`; anything else is a change to this
// test as well as to the dependency.
function caretBound(range) {
	assert.match(range, /^\^\d+\.\d+\.\d+$/, `the npm dependency range should be a single caret clause, got ${range}`);
	return parseVersion(range.slice(1));
}

test("package.json's npm range does not drop below the upstream floor", () => {
	const bound = caretBound(dependencies.npm);
	assert.ok(
		compareVersions(bound, parseVersion(UPSTREAM_NPM_FLOOR)) >= 0,
		`package.json asks for npm ${dependencies.npm}, below the ${UPSTREAM_NPM_FLOOR} that `
			+ 'wordpress-develop and Gutenberg require; a Gutenberg install would fail with EBADDEVENGINES'
	);
});

test('the npm that resolved into node_modules is inside the range package.json declares', () => {
	const bound = caretBound(dependencies.npm);
	const installed = parseVersion(bundledNpmVersion);
	assert.ok(
		installed[0] === bound[0] && compareVersions(installed, bound) >= 0,
		`node_modules holds npm ${bundledNpmVersion}, outside package.json's ${dependencies.npm}; `
			+ 'package.json and package-lock.json have drifted apart'
	);
});
