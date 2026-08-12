'use strict';

// The remote half of the staleness signal (#307): when the app is allowed to
// ask where trunk is, and what it does with the answer.
//
// Nothing here touches the network. `listServerRefs` is injected, which is also
// the only way to exercise the two things that would otherwise only fail in
// front of a contributor: a prefix match that returns more than the one ref,
// and a request that never settles.

const test = require('node:test');
const assert = require('node:assert/strict');
const {
	REMOTE_PROBE_INTERVAL_MS,
	TRUNK_REF,
	remoteProbeDue,
	readRemoteTrunkOid
} = require('../src/trunk-remote');

const NOW = Date.parse('2026-08-05T12:00:00Z');
const at = (offsetMs) => new Date(NOW + offsetMs).toISOString();

test('remoteProbeDue: a site that has never been asked is due (issue #307)', () => {
	// Including a record written by a version of the app that stored no stamp:
	// the field is simply absent, and that must read as "ask", not as "asked at
	// the epoch" or as "never ask".
	for (const checkedAt of [undefined, null, '', 'not-a-date']) {
		assert.equal(remoteProbeDue({ checkedAt, now: NOW }), true, `checkedAt=${String(checkedAt)}`);
	}
});

test('remoteProbeDue: inside the interval, the stored answer is reused (issue #307)', () => {
	// This is the whole point of the stamp: site:status is called on mount and
	// after every long operation, and each of those would otherwise be a request.
	assert.equal(remoteProbeDue({ checkedAt: at(-1000), now: NOW }), false);
	assert.equal(remoteProbeDue({ checkedAt: at(-(REMOTE_PROBE_INTERVAL_MS - 1)), now: NOW }), false);
});

test('remoteProbeDue: the interval boundary is due, not one tick short of it (issue #307)', () => {
	assert.equal(remoteProbeDue({ checkedAt: at(-REMOTE_PROBE_INTERVAL_MS), now: NOW }), true);
	assert.equal(remoteProbeDue({ checkedAt: at(-2 * REMOTE_PROBE_INTERVAL_MS), now: NOW }), true);
});

test('remoteProbeDue: a stamp in the future is due, not a site that never probes again (issue #307)', () => {
	// A clock that moved backwards — a laptop that woke in another timezone, or
	// a machine whose time was wrong until NTP corrected it. Reading this as
	// "not due" would silence the signal until the stamp's hour came round.
	assert.equal(remoteProbeDue({ checkedAt: at(5 * REMOTE_PROBE_INTERVAL_MS), now: NOW }), true);
});

test('remoteProbeDue: the caller can set its own interval (issue #307)', () => {
	assert.equal(remoteProbeDue({ checkedAt: at(-5000), now: NOW, intervalMs: 1000 }), true);
	assert.equal(remoteProbeDue({ checkedAt: at(-5000), now: NOW, intervalMs: 60000 }), false);
});

test('readRemoteTrunkOid: asks for one ref, and reads the one it asked for (issue #307)', async () => {
	const calls = [];
	const listServerRefs = async (args) => {
		calls.push(args);
		// What a real server answers: `prefix` is a prefix, so every branch whose
		// name merely starts with `refs/heads/trunk` comes back too. Taking the
		// first row would pin the site against a branch nobody is working on and
		// report it behind for ever.
		return [
			{ ref: 'refs/heads/trunk-experiment', oid: 'wrong-one' },
			{ ref: TRUNK_REF, oid: 'the-real-trunk' },
			{ ref: 'refs/heads/trunkish', oid: 'also-wrong' }
		];
	};

	const oid = await readRemoteTrunkOid({ url: 'https://example.test/wp.git', listServerRefs });

	assert.equal(oid, 'the-real-trunk');
	assert.equal(calls.length, 1);
	assert.equal(calls[0].url, 'https://example.test/wp.git');
	// Narrowing at the server, not after it: wordpress-develop's refs/pull/*
	// alone would otherwise be tens of thousands of rows over the wire.
	assert.equal(calls[0].prefix, TRUNK_REF);
});

test('readRemoteTrunkOid: a remote with no trunk answers null rather than throwing (issue #307)', async () => {
	// "Answered, and there is no trunk" is a fact; the caller stores it and it
	// clears any oid an earlier probe left. Only "could not ask" rejects.
	assert.equal(await readRemoteTrunkOid({ url: 'https://example.test/wp.git', listServerRefs: async () => [] }), null);
	assert.equal(await readRemoteTrunkOid({ url: 'https://example.test/wp.git', listServerRefs: async () => null }), null);
});

test('readRemoteTrunkOid: an unreachable remote rejects, so the caller can fall back (issue #307)', async () => {
	await assert.rejects(
		readRemoteTrunkOid({
			url: 'https://example.test/wp.git',
			listServerRefs: async () => { throw new Error('getaddrinfo ENOTFOUND example.test'); }
		}),
		/ENOTFOUND/
	);
});

test('readRemoteTrunkOid: a request that never settles is abandoned (issue #307)', async () => {
	// The characteristic conference-network failure is not a refusal, it is a
	// captive portal that swallows the connection. listServerRefs has no
	// deadline of its own, so without this the probe would stay pending for the
	// whole session and the next hour's would start behind it.
	await assert.rejects(
		readRemoteTrunkOid({
			url: 'https://example.test/wp.git',
			listServerRefs: () => new Promise(() => {}),
			timeoutMs: 20
		}),
		/no answer from https:\/\/example\.test\/wp\.git/
	);
});

test('readRemoteTrunkOid: a prompt answer does not leave its deadline timer running (issue #307)', async () => {
	// An uncleared deadline would keep a handle alive per site per hour in the
	// app, and here it would hold node --test open past the last assertion.
	// Asserted through a fake clock rather than through process internals: the
	// timer has to be cleared, and by the handle setTimeout returned.
	const timers = [];
	const originalSetTimeout = global.setTimeout;
	const originalClearTimeout = global.clearTimeout;
	global.setTimeout = (fn, ms) => {
		const handle = originalSetTimeout(fn, ms);
		timers.push({ handle, cleared: false });
		return handle;
	};
	global.clearTimeout = (handle) => {
		for (const t of timers) if (t.handle === handle) t.cleared = true;
		return originalClearTimeout(handle);
	};

	try {
		assert.equal(
			await readRemoteTrunkOid({
				url: 'https://example.test/wp.git',
				listServerRefs: async () => [{ ref: TRUNK_REF, oid: 'abc' }]
			}),
			'abc'
		);
	} finally {
		global.setTimeout = originalSetTimeout;
		global.clearTimeout = originalClearTimeout;
	}

	assert.equal(timers.length, 1, 'exactly one deadline was armed');
	assert.equal(timers[0].cleared, true, 'the deadline timer was left running');
});
