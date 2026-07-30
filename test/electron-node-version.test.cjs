// Guards the gap between the Node the app ships (Electron's bundled Node) and the Node that
// wordpress-develop's dependencies demand.
//
// The expectation below is deliberately inverted, because the current state is a mismatch:
// Electron 32 bundles Node 20.18.1, which is under wordpress-develop's range. The app copes by
// retrying installs with engine checks relaxed (src/npm-runner.js) — a workaround, not a fix.
//
// So when a future Electron bump makes the bundled runtime satisfy the range on its own, this
// test fails. That failure is the point: it says the relaxed-engines retry is no longer needed
// and the expectation here should be flipped to `true`. See #37, #46 and #40.

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const { electronBinaryPath } = require('../scripts/run-tests-electron.cjs');

// wordpress-develop's `engines.node`. The same range appears verbatim in the sample npm output
// in npm-runner.test.cjs — keep the two in step.
const WORDPRESS_DEVELOP_NODE_RANGE = '^20.19.0 || ^22.13.0 || >=24';

// Whether Electron's bundled Node currently satisfies that range. Read the header before
// changing this.
const BUNDLED_NODE_SATISFIES_RANGE = false;

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

	assert.equal(check('20.18.1'), false, "Electron 32's Node is below the range");
	assert.equal(check('20.19.0'), true, 'the lower bound of the first clause is included');
	assert.equal(check('20.19.5'), true, "the .nvmrc version satisfies the range");
	assert.equal(check('21.0.0'), false, 'a caret clause must not cross a major');
	assert.equal(check('22.12.0'), false, 'below the second clause');
	assert.equal(check('22.13.0'), true, 'the lower bound of the second clause is included');
	assert.equal(check('24.0.0'), true, '>=24 is open ended');
	assert.equal(check('25.1.2'), true, '>=24 is open ended');
});

test("Electron's bundled Node still mismatches wordpress-develop's engine range", () => {
	const bundled = bundledNodeVersion();

	assert.equal(
		satisfies(bundled, WORDPRESS_DEVELOP_NODE_RANGE),
		BUNDLED_NODE_SATISFIES_RANGE,
		`Electron now bundles Node ${bundled}, which changes its relationship to `
			+ `wordpress-develop's range (${WORDPRESS_DEVELOP_NODE_RANGE}). If it now satisfies the `
			+ 'range, the relaxed-engines retry in src/npm-runner.js is no longer needed: remove it '
			+ 'and set BUNDLED_NODE_SATISFIES_RANGE to true. See #46.'
	);
});
