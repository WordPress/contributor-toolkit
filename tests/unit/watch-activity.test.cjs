'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createWatchActivity, compilingMessage } = require('../../src/renderer/watch-activity.cjs');

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
