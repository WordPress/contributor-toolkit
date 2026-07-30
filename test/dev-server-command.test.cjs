'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { planDevServerStart } = require('../src/renderer/dev-server-command.cjs');

test('a built site skips the build and goes straight to the watcher (issue #72)', () => {
	const plan = planDevServerStart({ hasBuilt: true });

	assert.strictEqual(plan.needsBuild, false, 'a completed build must not be redone at dev-server start');
	assert.strictEqual(plan.watch.script, 'grunt');
	assert.deepStrictEqual(plan.watch.args, ['--', '_watch']);
});

test('an unbuilt site builds first, then runs the same watcher', () => {
	const plan = planDevServerStart({ hasBuilt: false });

	assert.strictEqual(plan.needsBuild, true, 'skip-the-wizard sites still need a build before serving');
	assert.strictEqual(plan.watch.script, 'grunt');
	assert.deepStrictEqual(plan.watch.args, ['--', '_watch']);
});

// script-runner.js deliberately does not insert npm's argument separator, so
// it must be in the args themselves. Without it npm swallows `_watch` and runs
// bare `grunt` — the default task, i.e. the full production build with no
// watcher: exactly the ~30-minute stall this module exists to remove.
test("the watcher args carry npm's `--` separator explicitly", () => {
	const plan = planDevServerStart({ hasBuilt: true });

	assert.strictEqual(plan.watch.args[0], '--');
	assert.ok(plan.watch.args.indexOf('_watch') > plan.watch.args.indexOf('--'), '`_watch` must come after the separator');
});

test('missing flags behave as unbuilt, never as built', () => {
	assert.strictEqual(planDevServerStart().needsBuild, true);
	assert.strictEqual(planDevServerStart({}).needsBuild, true);
});

test('the returned args are a fresh copy a caller cannot corrupt for the next start', () => {
	const first = planDevServerStart({ hasBuilt: true });
	first.watch.args.length = 0;

	assert.deepStrictEqual(planDevServerStart({ hasBuilt: true }).watch.args, ['--', '_watch']);
});
