'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { planDevServerStart, formatElapsed, watchTabLabel } = require('../../src/renderer/dev-server-command.cjs');

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

test('formatElapsed shows plain seconds under a minute', () => {
	assert.strictEqual(formatElapsed(0), '0s');
	assert.strictEqual(formatElapsed(42), '42s');
	assert.strictEqual(formatElapsed(59), '59s');
});

test('formatElapsed switches to zero-padded minutes form at a minute', () => {
	assert.strictEqual(formatElapsed(60), '1m 00s');
	assert.strictEqual(formatElapsed(185), '3m 05s');
	assert.strictEqual(formatElapsed(671), '11m 11s');
});

// The counter is driven by an incrementing interval, but a clock hiccup or a
// future refactor to timestamps must never render garbage next to the button.
test('formatElapsed clamps negatives and non-numbers to 0s', () => {
	assert.strictEqual(formatElapsed(-5), '0s');
	assert.strictEqual(formatElapsed(NaN), '0s');
	assert.strictEqual(formatElapsed(undefined), '0s');
	assert.strictEqual(formatElapsed(12.9), '12s');
});

// The watcher runs decoupled from the dev server (issue #247), so its tab title
// is the only place its state is shown. Each lifecycle state gets its own label.
test('watchTabLabel names each watcher lifecycle state', () => {
	assert.strictEqual(watchTabLabel('idle'), 'Build watcher');
	assert.strictEqual(watchTabLabel('watching'), 'Build watcher (watching)');
	assert.strictEqual(watchTabLabel('building'), 'Build watcher (building)');
	assert.strictEqual(watchTabLabel('paused'), 'Build watcher (paused)');
});

test('watchTabLabel shows the exit code when the watcher has exited', () => {
	assert.strictEqual(watchTabLabel('exited', 0), 'Build watcher (exited 0)');
	assert.strictEqual(watchTabLabel('exited', 1), 'Build watcher (exited 1)');
});

// A watcher we killed on purpose (pause, dev-server stop) has no meaningful
// exit code to show — 'stopped' reads better than 'exited null'.
test('watchTabLabel falls back to "stopped" when the exit code is unknown', () => {
	assert.strictEqual(watchTabLabel('exited'), 'Build watcher (stopped)');
	assert.strictEqual(watchTabLabel('exited', null), 'Build watcher (stopped)');
	assert.strictEqual(watchTabLabel('exited', NaN), 'Build watcher (stopped)');
});

// An unknown state must never blank the tab or throw — it stays identifiable.
test('watchTabLabel falls back to the bare name for unknown states', () => {
	assert.strictEqual(watchTabLabel(undefined), 'Build watcher');
	assert.strictEqual(watchTabLabel('bogus'), 'Build watcher');
});
