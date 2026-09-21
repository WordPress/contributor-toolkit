'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createWatchActivity, compilingMessage, watchBusyMessage, applyFinishMessage, resumedWatchHandOff } = require('../../src/renderer/watch-activity.cjs');

// A change handed to the watch is compiling until the watch has been quiet
// for quietMs (#492). The clock is injected: t is milliseconds.
test('nothing is compiling before a hand-off', () => {
	const activity = createWatchActivity({ quietMs: 3000 });

	assert.strictEqual(activity.isCompiling(0), false);
	assert.strictEqual(activity.settlesAt(), null);
});

test('a hand-off compiles until quietMs of silence', () => {
	const activity = createWatchActivity({ quietMs: 3000 });
	activity.handOff(1000);

	assert.strictEqual(activity.isCompiling(1000), true);
	assert.strictEqual(activity.isCompiling(3999), true);
	assert.strictEqual(activity.isCompiling(4000), false);
	assert.strictEqual(activity.settlesAt(), 4000);
});

// wp-build prints one line per package it rebuilds; each one pushes "done"
// back, so a pull request touching many packages stays compiling throughout.
test('watch output extends the compiling stretch', () => {
	const activity = createWatchActivity({ quietMs: 3000 });
	activity.handOff(1000);
	activity.output(3500);
	activity.output(6000);

	assert.strictEqual(activity.isCompiling(8999), true);
	assert.strictEqual(activity.isCompiling(9000), false);
	assert.strictEqual(activity.settlesAt(), 9000);
});

// Output before the hand-off (the watch's own startup, an earlier rebuild)
// says nothing about the change just applied.
test('output with no hand-off open is ignored', () => {
	const activity = createWatchActivity({ quietMs: 3000 });
	activity.output(500);

	assert.strictEqual(activity.isCompiling(600), false);
	activity.handOff(1000);
	activity.output(200);
	assert.strictEqual(activity.settlesAt(), 4000, 'a stale timestamp must not move the hand-off back');
});

// A change the watch has nothing to compile prints nothing; it clears after
// the same silence rather than never.
test('a hand-off with no output at all clears after quietMs', () => {
	const activity = createWatchActivity({ quietMs: 3000 });
	activity.handOff(1000);

	assert.strictEqual(activity.isCompiling(4000), false);
});

// The watch stopping mid-compile is not "done": nothing is compiling, and the
// banner must not promise a rebuild that will not come.
test('clear ends the stretch at once', () => {
	const activity = createWatchActivity({ quietMs: 3000 });
	activity.handOff(1000);
	activity.clear();

	assert.strictEqual(activity.isCompiling(1001), false);
	assert.strictEqual(activity.settlesAt(), null);
});

test('a second hand-off restarts the stretch', () => {
	const activity = createWatchActivity({ quietMs: 3000 });
	activity.handOff(1000);
	activity.handOff(10000);

	assert.strictEqual(activity.isCompiling(12999), true);
	assert.strictEqual(activity.settlesAt(), 13000);
});

test('the default quiet window is three seconds', () => {
	const activity = createWatchActivity();
	activity.handOff(0);

	assert.strictEqual(activity.settlesAt(), 3000);
});

test('the banner line tells the contributor what to wait for', () => {
	assert.match(compilingMessage(), /Build watcher tab/);
	assert.match(compilingMessage(), /before trying the site/);
});

// The watch's first line can come after the quiet window has closed (chokidar
// waits for writes to settle; a big checkout takes a while to write). Within
// the grace period that line reopens the window; after it, it is some other
// rebuild's and is ignored.
test('output within the grace period reopens a window the quiet rule closed', () => {
	const activity = createWatchActivity({ quietMs: 3000, graceMs: 15000 });
	activity.handOff(1000);

	assert.strictEqual(activity.isCompiling(5000), false, 'quiet for 3 s: closed');
	activity.output(6000);
	assert.strictEqual(activity.isCompiling(8999), true, 'the late first line reopened it');
	assert.strictEqual(activity.isCompiling(9000), false);
});

test('output after the grace period does not reopen a closed window', () => {
	const activity = createWatchActivity({ quietMs: 3000, graceMs: 15000 });
	activity.handOff(1000);
	activity.output(20000);

	assert.strictEqual(activity.isCompiling(20001), false);
});

// A window still open past the grace period keeps extending on output: a
// long rebuild is not cut short at 15 s.
test('output past the grace period still extends an open window', () => {
	const activity = createWatchActivity({ quietMs: 3000, graceMs: 15000 });
	activity.handOff(1000);
	for (let t = 3000; t <= 30000; t += 2000) activity.output(t);

	assert.strictEqual(activity.isCompiling(30001), true);
	assert.strictEqual(activity.settlesAt(), 32000, "last line at 29 s");
});

// A pull-request checkout pauses the watch and resumes it after its own
// build; on Gutenberg the resumed watch rebuilds build/ from scratch and the
// site is unusable until it is watching again (#489). The banner is already
// up, so it is the banner that has to say so.
test('the banner says rebuilding while the watch is building, whatever the hand-off', () => {
	assert.match(watchBusyMessage('building', false), /rebuilding after this change/);
	assert.match(watchBusyMessage('building', true), /rebuilding after this change/);
	assert.match(watchBusyMessage('building', false), /say \(watching\)/);
});

test('the banner says compiling only on a watching watch with a hand-off open', () => {
	assert.strictEqual(watchBusyMessage('watching', true), compilingMessage());
	assert.strictEqual(watchBusyMessage('watching', false), null);
});

test('the banner says nothing when the watch is idle, paused or exited', () => {
	for (const state of ['idle', 'paused', 'exited', undefined]) {
		assert.strictEqual(watchBusyMessage(state, true), null, `${state}: no rebuild is coming`);
		assert.strictEqual(watchBusyMessage(state, false), null);
	}
});

// "Checked out — open the site to try it out." followed by "wait before trying
// the site" contradicts itself; when the resumed watch is rebuilding, the
// invitation goes and the rebuilding line follows.
test('the apply finish line drops the invitation while the resumed watch rebuilds', () => {
	const out = applyFinishMessage('\nChecked out — open the site to try it out.\n', 'building');

	assert.doesNotMatch(out, /open the site to try it out/);
	assert.match(out, /^\nChecked out\.\n/);
	assert.match(out, /rebuilding after this change/);
});

test('the apply finish line is untouched when the watch is watching or stopped', () => {
	const line = '\nChecked out — open the site to try it out.\n';

	assert.strictEqual(applyFinishMessage(line, 'watching'), line);
	assert.strictEqual(applyFinishMessage(line, 'idle'), line);
});

// #506: an apply that paused a watch which rebuilds from scratch on resume
// (Gutenberg) leaves the one build to that resume. What the terminal says
// depends on whether the watch is still there to resume, and then on how the
// rebuild ends.
test('the resumed-watch hand-off waits on a paused watch and names both endings', () => {
	const out = resumedWatchHandOff('Checked out', 'pull request', 'paused');

	assert.strictEqual(out.waits, true);
	assert.match(out.ready, /^\nChecked out — the build watch has rebuilt\. Open the site to try it out\.\n$/);
	assert.match(out.failed, /The pull request is checked out but the build watch stopped before it finished rebuilding/);
	assert.match(out.failed, /still runs the old assets/);
	assert.match(out.failed, /Start the build watch, or run npm run build/);
	assert.strictEqual(out.stopped, undefined);
});

test('the resumed-watch hand-off does not wait when nothing will resume', () => {
	for (const state of ['idle', 'exited', 'watching', undefined]) {
		const out = resumedWatchHandOff('Restored', 'saved work', state);
		assert.strictEqual(out.waits, false, `${state}: no resume is coming`);
		assert.match(out.stopped, /The saved work is restored but the build watch was stopped/);
		assert.match(out.stopped, /Start the build watch, or run npm run build/);
		assert.strictEqual(out.ready, undefined);
	}
});
