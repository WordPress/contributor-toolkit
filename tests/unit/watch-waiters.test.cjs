'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { createWatchWaiters, createRunGeneration, watchOccupiesBuild } = require('../../src/renderer/watch-waiters.cjs');

// The dev-server start is held until the watcher says build/ is complete
// (#488). Ready calls the one side, failure the other, never both.
test('settle(true) calls onReady and not onFail', () => {
	const waiters = createWatchWaiters();
	const calls = [];
	waiters.add(() => calls.push('ready'), () => calls.push('fail'));

	assert.strictEqual(waiters.settle(true), 1);
	assert.deepStrictEqual(calls, ['ready']);
});

test('settle(false) calls onFail and not onReady', () => {
	const waiters = createWatchWaiters();
	const calls = [];
	waiters.add(() => calls.push('ready'), () => calls.push('fail'));

	assert.strictEqual(waiters.settle(false), 1);
	assert.deepStrictEqual(calls, ['fail']);
});

// A start requested while a watch is already on its way queues behind it
// rather than being dropped, and both are answered when it is ready.
test('two queued waiters are both settled, in order', () => {
	const waiters = createWatchWaiters();
	const calls = [];
	waiters.add(() => calls.push('first'));
	waiters.add(() => calls.push('second'));

	assert.strictEqual(waiters.size(), 2);
	waiters.settle(true);
	assert.deepStrictEqual(calls, ['first', 'second']);
	assert.strictEqual(waiters.size(), 0);
});

// The watcher's exit handler and a manual stop both settle; whichever comes
// second must find nothing to do, not call the callbacks again.
test('a second settle is a no-op', () => {
	const waiters = createWatchWaiters();
	let calls = 0;
	waiters.add(() => { calls++; }, () => { calls++; });

	waiters.settle(true);
	assert.strictEqual(waiters.settle(false), 0);
	assert.strictEqual(waiters.settle(true), 0);
	assert.strictEqual(calls, 1);
});

test('settle with nothing queued returns 0 and does not throw', () => {
	assert.strictEqual(createWatchWaiters().settle(true), 0);
	assert.strictEqual(createWatchWaiters().settle(false), 0);
});

test('a throwing waiter does not keep the next one from being called', () => {
	const waiters = createWatchWaiters();
	const calls = [];
	waiters.add(() => { throw new Error('boom'); });
	waiters.add(() => calls.push('second'));

	assert.doesNotThrow(() => waiters.settle(true));
	assert.deepStrictEqual(calls, ['second']);
});

// A waiter with only one side is fine: settling the other side skips it.
test('a waiter missing one side is skipped on that side', () => {
	const waiters = createWatchWaiters();
	const calls = [];
	waiters.add(() => calls.push('ready'));
	waiters.add(undefined, () => calls.push('fail'));

	assert.doesNotThrow(() => waiters.settle(false));
	assert.deepStrictEqual(calls, ['fail']);
});

test('adding nothing queues nothing', () => {
	const waiters = createWatchWaiters();
	waiters.add();
	waiters.add(undefined, undefined);

	assert.strictEqual(waiters.size(), 0);
});

// A waiter added from inside a callback (a retry) belongs to the next round,
// not the one being settled.
test('a waiter added during settle waits for the next settle', () => {
	const waiters = createWatchWaiters();
	const calls = [];
	waiters.add(() => { calls.push('first'); waiters.add(() => calls.push('retry')); });

	waiters.settle(true);
	assert.deepStrictEqual(calls, ['first']);
	assert.strictEqual(waiters.size(), 1);
	waiters.settle(true);
	assert.deepStrictEqual(calls, ['first', 'retry']);
});

// A Gutenberg watcher spends its first ~20 s in 'building' with no terminal
// lock. An operation that needs build/ to itself must pause it then too, not
// only once it is watching, or a full build runs beside the watcher's own.
test('the watch occupies build/ while building and while watching', () => {
	assert.strictEqual(watchOccupiesBuild('watching'), true);
	assert.strictEqual(watchOccupiesBuild('building'), true);
});

test('the watch does not occupy build/ when idle, paused or exited', () => {
	assert.strictEqual(watchOccupiesBuild('idle'), false);
	assert.strictEqual(watchOccupiesBuild('paused'), false);
	assert.strictEqual(watchOccupiesBuild('exited'), false);
	assert.strictEqual(watchOccupiesBuild(undefined), false);
});

// A watcher stopped and restarted before the old process has exited: the old
// run's late callbacks must see they are stale, or they mark the new run
// exited and fail the server start queued behind it.
test('a new start makes the previous run stale', () => {
	const generation = createRunGeneration();
	const first = generation.next();
	const second = generation.next();

	assert.strictEqual(generation.isCurrent(first), false);
	assert.strictEqual(generation.isCurrent(second), true);
});

test('a stop makes the current run stale before any new start', () => {
	const generation = createRunGeneration();
	const token = generation.next();
	generation.invalidate();

	assert.strictEqual(generation.isCurrent(token), false);
});

test('a run is current until something replaces or invalidates it', () => {
	const generation = createRunGeneration();
	const token = generation.next();

	assert.strictEqual(generation.isCurrent(token), true);
});

// Nothing has started: no token is current, so a callback that somehow
// arrives with none is stale too.
test('no token is current before the first start', () => {
	const generation = createRunGeneration();

	assert.strictEqual(generation.isCurrent(undefined), false);
	assert.strictEqual(generation.isCurrent(0), false);
});
