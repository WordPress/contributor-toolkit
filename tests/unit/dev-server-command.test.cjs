'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { planDevServerStart, createWatchReadyDetector, formatElapsed, watchTabLabel } = require('../../src/renderer/dev-server-command.cjs');
const { getProjectType } = require('../../src/project-type.cjs');

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

// The watcher is the target's (#251). A Gutenberg site runs its own
// incremental watcher and must not inherit Core's `--` passthrough: `npm run
// dev -- _watch` would hand Gutenberg's build script an argument it does not
// know.
test("a Gutenberg site's watcher is npm run dev, with no passthrough separator", () => {
	const plan = planDevServerStart({ hasBuilt: true }, getProjectType('gutenberg').build);

	assert.strictEqual(plan.watch.script, 'dev');
	assert.deepStrictEqual(plan.watch.args, []);
	assert.strictEqual(plan.watch.label, 'npm run dev');
	assert.strictEqual(plan.needsBuild, false);
});

// Gutenberg's `npm run dev` removes build/ and rebuilds it before it watches,
// writing the PHP registries lib/ calls into last (#488). The plan carries the
// line that says that build is done, so the server start can wait for it.
test("a Gutenberg site's watcher is not ready until it prints that it is watching", () => {
	const plan = planDevServerStart({ hasBuilt: true }, getProjectType('gutenberg').build);

	assert.strictEqual(plan.watch.readyPattern, 'Watching for changes');
});

// Core's grunt _watch touches nothing on start; a server behind it is safe at
// once, and a pattern there would make it wait for a line grunt never prints.
test("Core's watcher has no ready pattern, so the server starts with it", () => {
	const plan = planDevServerStart({ hasBuilt: true }, getProjectType('core').build);

	assert.strictEqual(plan.watch.readyPattern, null);
	assert.strictEqual(createWatchReadyDetector(plan.watch.readyPattern).immediate, true);
});

test('with no pattern the detector is ready before any output', () => {
	const detector = createWatchReadyDetector(null);

	assert.strictEqual(detector.immediate, true);
	assert.strictEqual(detector.ready, true);
	assert.strictEqual(detector.feed('anything'), false, 'an immediate detector never fires from output');
});

test('with a pattern the detector waits for it and fires once', () => {
	const detector = createWatchReadyDetector('Watching for changes');

	assert.strictEqual(detector.immediate, false);
	assert.strictEqual(detector.ready, false);
	assert.strictEqual(detector.feed('🔨 Starting development build...\n'), false);
	assert.strictEqual(detector.feed('✅ Initial build completed! (19s)\n'), false, 'the orchestrator\'s own line comes before wp-build is watching');
	assert.strictEqual(detector.feed('\n👀 Watching for changes...\n'), true);
	assert.strictEqual(detector.ready, true);
	assert.strictEqual(detector.feed('👀 Watching for changes...\n'), false, 'wp-build prints the line after every rebuild; the server must start once');
});

// The pipe delivers whatever it has; the line can arrive in two pieces.
test('the detector sees a pattern split across two chunks', () => {
	const detector = createWatchReadyDetector('Watching for changes');

	assert.strictEqual(detector.feed('👀 Watching for'), false);
	assert.strictEqual(detector.feed(' changes...\n'), true);
});

test('the detector does not grow with output it has ruled out', () => {
	const detector = createWatchReadyDetector('Watching for changes');
	for (let i = 0; i < 10000; i++) detector.feed('a line of build output that is not the one\n');

	assert.strictEqual(detector.ready, false);
	assert.strictEqual(detector.feed('Watching for changes'), true);
});

test('a caller that passes no build config gets Core, the same plan every site got before', () => {
	assert.deepStrictEqual(planDevServerStart({ hasBuilt: true }), planDevServerStart({ hasBuilt: true }, getProjectType('core').build));
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

// While the watch compiles a change just applied, the tab says so; the
// contributor is told to wait for it to go quiet (#492).
test('watchTabLabel says compiling only on a watching watch', () => {
	assert.strictEqual(watchTabLabel('watching', null, true), 'Build watcher (compiling)');
	assert.strictEqual(watchTabLabel('watching', null, false), 'Build watcher (watching)');
	assert.strictEqual(watchTabLabel('building', null, true), 'Build watcher (building)');
	assert.strictEqual(watchTabLabel('paused', null, true), 'Build watcher (paused)');
	assert.strictEqual(watchTabLabel('idle', null, true), 'Build watcher');
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
