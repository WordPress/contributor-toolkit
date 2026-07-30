// Guards the gap between the Node the app ships (Electron's bundled Node) and the Node that
// wordpress-develop's dependencies demand.
//
// That gap is closed as of this branch: Electron 43 bundles Node 24.18.0, which satisfies
// wordpress-develop's range, so installs no longer need engine checks relaxed to succeed. On
// trunk the expectation was the opposite — Electron 32 bundled Node 20.18.1, below the range —
// and this test is what reported the change. See #37 and #46.
//
// Keep the expectation matching reality: if a future change drops the bundled runtime back below
// the range, this test fails, and that failure means the app has regressed to needing the
// relaxed-engines workaround.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { electronBinaryPath } = require('../scripts/run-tests-electron.cjs');

// wordpress-develop's `engines.node`. The same range appears verbatim in the sample npm output
// in npm-runner.test.cjs — keep the two in step.
const WORDPRESS_DEVELOP_NODE_RANGE = '^20.19.0 || ^22.13.0 || >=24';

// Whether Electron's bundled Node currently satisfies that range. Read the header before
// changing this.
const BUNDLED_NODE_SATISFIES_RANGE = true;

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

// Just enough semver to evaluate the range above — `^x.y.z` and `>=x` clauses. Hand-rolled
// because the app must not grow a dependency for a version comparison.
function satisfiesClause(version, clause) {
	if (clause.startsWith('^')) {
		const bound = parseVersion(clause.slice(1));
		// A caret clause is >= the bound and < the next major.
		return version[0] === bound[0] && compareVersions(version, bound) >= 0;
	}
	if (clause.startsWith('>=')) {
		return compareVersions(version, parseVersion(clause.slice(2))) >= 0;
	}
	throw new Error(`unsupported range clause: ${clause}`);
}

function satisfies(version, range) {
	const parsed = parseVersion(version);
	return range.split('||').map((clause) => clause.trim()).some((clause) => satisfiesClause(parsed, clause));
}

// Asks the Electron binary itself rather than mapping Electron versions to Node versions by
// hand, so this reads the runtime that will actually ship.
function bundledNodeVersion() {
	const result = spawnSync(electronBinaryPath(), ['-p', 'process.versions.node'], {
		env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
		encoding: 'utf8',
		shell: false,
		windowsHide: true,
	});
	assert.equal(
		result.status,
		0,
		`could not read Electron's bundled Node version (status ${result.status}): ${result.stderr}`
	);
	return result.stdout.trim();
}

// The pinned expectation is only meaningful if the comparison behind it is right: a broken
// parser would also report a mismatch, for the wrong reason.
test('the range check matches semver on the boundaries that matter', () => {
	const check = (version) => satisfies(version, WORDPRESS_DEVELOP_NODE_RANGE);

	assert.equal(check('20.18.1'), false, "Electron 32's Node was below the range");
	assert.equal(check('20.19.0'), true, 'the lower bound of the first clause is included');
	assert.equal(check('20.19.5'), true, 'a patch above the first lower bound is included');
	assert.equal(check('21.0.0'), false, 'a caret clause must not cross a major');
	assert.equal(check('22.12.0'), false, 'below the second clause');
	assert.equal(check('22.13.0'), true, 'the lower bound of the second clause is included');
	assert.equal(check('24.0.0'), true, '>=24 is open ended');
	assert.equal(check('25.1.2'), true, '>=24 is open ended');
});

test("Electron's bundled Node satisfies wordpress-develop's engine range", () => {
	const bundled = bundledNodeVersion();

	assert.equal(
		satisfies(bundled, WORDPRESS_DEVELOP_NODE_RANGE),
		BUNDLED_NODE_SATISFIES_RANGE,
		`Electron bundles Node ${bundled}, which no longer satisfies wordpress-develop's range `
			+ `(${WORDPRESS_DEVELOP_NODE_RANGE}). Installs will fail on its engine-strict setting `
			+ 'unless engine checks are relaxed, so this is a regression in the shipped runtime '
			+ 'rather than something to accommodate here. See #37 and #46.'
	);
});
