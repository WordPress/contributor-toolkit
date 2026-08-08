'use strict';

// Fork, commit, pull request (#167) — the sequence, and the ways it goes wrong.
//
// Two of these tests are the reason the module is shaped the way it is. A fork
// that already exists and is months stale is the ordinary case for anyone who
// has contributed before, and it is the one where the obvious implementation
// fails: the commit is based on the local checkout's HEAD, which a stale fork
// does not contain. And a deletion is a tree entry with a null sha, which is
// easy to get wrong in a way that silently drops the deletion instead of
// carrying it.
//
// Everything is driven through injected `get`/`post`, so nothing here touches
// the network or waits for a real fork to appear.

const test = require('node:test');
const assert = require('node:assert');
const {
	buildPullRequestBody,
	branchNameFor,
	classifyFailure,
	ensureFork,
	resolveBase,
	createTree,
	commitAndBranch,
	createPullRequest,
	openPullRequest
} = require('../src/github-pr.cjs');

const TOKEN = 'gho_test';
const LOGIN = 'janedoe';

// Routes by URL, so a test states what GitHub has rather than the order it is
// asked. `routes` maps a substring of the URL to a response or a function of
// the call count.
function router(routes) {
	const calls = [];
	// Matched against the end of the URL, not anywhere in it: every endpoint here
	// is a path under the fork's own URL, so a substring match would route
	// `…/wordpress-develop/git/commits/abc` to the route for the repository
	// itself. Longest first breaks the remaining ties.
	const patterns = Object.keys(routes)
		.map((key) => ({ key, method: key.split(' ')[0], path: key.slice(key.indexOf(' ') + 1) }))
		.sort((a, b) => b.path.length - a.path.length);
	const hits = new Map();

	const answer = (method) => async (url, payloadOrOpts) => {
		const payload = method === 'POST' ? payloadOrOpts : undefined;
		calls.push({ method, url, payload });
		const match = patterns.find((p) => p.method === method && url.endsWith(p.path));
		if (!match) return { status: 404, headers: {}, json: { message: `no route for ${method} ${url}` } };
		// 1 on the first call, so a route written as a function reads as "the
		// first time this is asked, …".
		const seen = (hits.get(match.key) || 0) + 1;
		hits.set(match.key, seen);
		const route = routes[match.key];
		const res = typeof route === 'function' ? route(seen) : route;
		if (res instanceof Error) throw res;
		return { status: res.status, headers: res.headers || {}, json: res.json === undefined ? {} : res.json };
	};
	return { calls, get: answer('GET'), post: answer('POST'), sleep: async () => {} };
}

const FORK_URL = `repos/${LOGIN}/wordpress-develop`;

test('buildPullRequestBody cites the ticket in the form core’s convention expects', () => {
	const body = buildPullRequestBody({ ticketId: 62281, handle: 'janedoe', event: 'WordCamp Europe 2026' });

	// The exact string this app's own linked-PR search looks for, so a pull
	// request opened here is discoverable by the panel that lists them.
	assert.ok(body.includes('https://core.trac.wordpress.org/ticket/62281'));
	assert.ok(body.includes('@janedoe'));
	assert.ok(body.includes('WordCamp Europe 2026'));

	const bare = buildPullRequestBody({ ticketId: 1 });
	assert.ok(bare.includes('/ticket/1'));
	assert.ok(!bare.includes('undefined'));
});

test('branchNameFor suffixes rather than reusing a taken name', () => {
	assert.strictEqual(branchNameFor(62281), 'trac-62281');
	assert.strictEqual(branchNameFor('#62281', 1), 'trac-62281-2');
});

// classifyHttpFailure reads a 401 with a spent quota as rate-limiting, which is
// right for the anonymous reads it was written for. Here a 401 is always a
// token that has stopped working, and it has its own recovery.
test('classifyFailure calls a 401 unauthorized, and still recognises a spent quota', () => {
	assert.strictEqual(classifyFailure({ status: 401, headers: { 'x-ratelimit-remaining': '0' } }), 'unauthorized');
	assert.strictEqual(classifyFailure({ status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'rate-limited');
	assert.strictEqual(classifyFailure({ status: 422, headers: {} }), 'error');
});

// What GitHub says about a repository that really is the contributor's fork.
const FORK_JSON = { fork: true, parent: { full_name: 'WordPress/wordpress-develop' } };

test('ensureFork uses the fork that is already there, without forking again', async () => {
	const api = router({ [`GET ${FORK_URL}`]: { status: 200, json: FORK_JSON } });

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.deepStrictEqual(res, { ok: true, created: false });
	assert.strictEqual(api.calls.filter((c) => c.method === 'POST').length, 0);
});

// A contributor who owns an unrelated repository named wordpress-develop must
// be told at step one. The alternative is a branch and a commit written into
// their project, and a failure at the very last step with an opaque 422.
test('ensureFork refuses a same-named repository that is not a fork of upstream', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: { status: 200, json: { fork: false } },
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /not a fork/);
	// Nothing written anywhere: no fork attempted, and nothing for later steps
	// to push into.
	assert.strictEqual(api.calls.filter((c) => c.method === 'POST').length, 0);
});

// A fork of something else entirely under the same name is the same refusal.
test('ensureFork refuses a fork of a different repository', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: { status: 200, json: { fork: true, parent: { full_name: 'someone/wordpress-develop' } } }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /not a fork/);
});

// Forking is asynchronous: the POST answers 202 and the repository appears a
// moment later. Treating the 202 as done is the bug this pins — the very next
// request would 404 on a repository that is about to exist.
test('ensureFork waits for a new fork to appear before reporting success', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: (seen) => ({ status: seen < 3 ? 404 : 200 }),
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.deepStrictEqual(res, { ok: true, created: true });
	assert.strictEqual(api.calls.filter((c) => c.method === 'GET').length, 3);
});

test('ensureFork gives up with something actionable when the fork never appears', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: { status: 404 },
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, { ...api, forkPollAttempts: 2 });

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /try again in a minute/);
});

test('ensureFork reports a revoked token as unauthorized rather than as a missing fork', async () => {
	const api = router({ [`GET ${FORK_URL}`]: { status: 401, json: { message: 'Bad credentials' } } });

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.strictEqual(res.reason, 'unauthorized');
});

test('resolveBase uses the local HEAD when the fork already contains it', async () => {
	const api = router({ 'GET git/commits/abc123': { status: 200 } });

	const res = await resolveBase({ token: TOKEN, login: LOGIN, baseSha: 'abc123' }, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'abc123', exact: true });
	// No sync needed, so none attempted.
	assert.strictEqual(api.calls.filter((c) => c.method === 'POST').length, 0);
});

// The stale fork. Without the sync the next step would create a ref from a
// commit the fork has never heard of, and GitHub would refuse it.
test('resolveBase syncs a stale fork, then finds the base commit there', async () => {
	const api = router({
		'GET git/commits/abc123': (seen) => ({ status: seen === 1 ? 404 : 200 }),
		'POST merge-upstream': { status: 200 }
	});

	const res = await resolveBase({ token: TOKEN, login: LOGIN, baseSha: 'abc123' }, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'abc123', exact: true });
	assert.ok(api.calls.some((c) => c.url.includes('merge-upstream') && c.payload.branch === 'trunk'));
});

// A fork that has been committed to directly cannot be fast-forwarded. Failing
// there would strand a contributor who is more experienced, not less — so the
// fork's own tip becomes the base, and `exact: false` is what lets the panel
// warn that the pull request may show more than they changed.
test('resolveBase falls back to the fork’s own trunk when it cannot be fast-forwarded', async () => {
	const api = router({
		'GET git/commits/abc123': { status: 404 },
		'POST merge-upstream': { status: 409, json: { message: 'diverged' } },
		'GET git/ref/heads/trunk': { status: 200, json: { object: { sha: 'forktip' } } }
	});

	const res = await resolveBase({ token: TOKEN, login: LOGIN, baseSha: 'abc123' }, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'forktip', exact: false });
});

test('createTree uploads each file as a base64 blob and inherits the rest', async () => {
	const api = router({
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } }
	});

	const res = await createTree({
		token: TOKEN,
		login: LOGIN,
		baseTreeSha: 'basetree',
		files: [{ path: 'src/wp-admin/a.php', kind: 'modify', content: Buffer.from('<?php\n'), mode: '100644' }]
	}, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'tree1' });
	const blob = api.calls.find((c) => c.url.includes('git/blobs'));
	assert.strictEqual(blob.payload.encoding, 'base64');
	assert.strictEqual(Buffer.from(blob.payload.content, 'base64').toString('utf8'), '<?php\n');
	const tree = api.calls.find((c) => c.url.includes('git/trees'));
	// base_tree is what keeps this from being a commit that deletes all of
	// wordpress-develop except the changed file.
	assert.strictEqual(tree.payload.base_tree, 'basetree');
	assert.deepStrictEqual(tree.payload.tree, [
		{ path: 'src/wp-admin/a.php', mode: '100644', type: 'blob', sha: 'blob1' }
	]);
});

// A null sha is the only way the tree API expresses a deletion, and it is why
// the pull request carries deletions that the `.diff` this app writes does not.
test('createTree expresses a deletion as a null sha, with no blob uploaded for it', async () => {
	const api = router({
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } }
	});

	await createTree({
		token: TOKEN,
		login: LOGIN,
		baseTreeSha: 'basetree',
		files: [
			{ path: 'gone.php', kind: 'delete', content: null, mode: '100644' },
			{ path: 'kept.php', kind: 'add', content: Buffer.from('x'), mode: '100755' }
		]
	}, api);

	const tree = api.calls.find((c) => c.url.includes('git/trees'));
	assert.deepStrictEqual(tree.payload.tree, [
		{ path: 'gone.php', mode: '100644', type: 'blob', sha: null },
		{ path: 'kept.php', mode: '100755', type: 'blob', sha: 'blob1' }
	]);
	assert.strictEqual(api.calls.filter((c) => c.url.includes('git/blobs')).length, 1);
});

// A binary file is the other thing a unified diff cannot carry. Its bytes have
// to survive the round trip exactly.
test('createTree carries bytes a diff could not, unchanged', async () => {
	const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
	const api = router({
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } }
	});

	await createTree({ token: TOKEN, login: LOGIN, baseTreeSha: 't', files: [{ path: 'a.png', kind: 'add', content: bytes, mode: '100644' }] }, api);

	const blob = api.calls.find((c) => c.url.includes('git/blobs'));
	assert.ok(Buffer.from(blob.payload.content, 'base64').equals(bytes));
});

test('commitAndBranch makes one commit, then a branch that points at it', async () => {
	const api = router({
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 201 }
	});

	const res = await commitAndBranch({
		token: TOKEN, login: LOGIN, ticketId: 62281, message: 'Fix it', treeSha: 'tree1', parentSha: 'base1'
	}, api);

	assert.deepStrictEqual(res, { ok: true, branch: 'trac-62281', sha: 'commit1' });
	const commit = api.calls.find((c) => c.url.includes('git/commits'));
	assert.deepStrictEqual(commit.payload.parents, ['base1']);
	assert.strictEqual(commit.payload.tree, 'tree1');
	const ref = api.calls.find((c) => c.url.includes('git/refs'));
	assert.strictEqual(ref.payload.ref, 'refs/heads/trac-62281');
});

// Working the same ticket twice is normal. Re-uploading everything to find that
// out is not, which is why the branch is created last.
test('commitAndBranch takes the next name when the branch already exists', async () => {
	const api = router({
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': (seen) => (seen === 1 ? { status: 422, json: { message: 'Reference already exists' } } : { status: 201 })
	});

	const res = await commitAndBranch({ token: TOKEN, login: LOGIN, ticketId: 62281, message: 'm', treeSha: 't', parentSha: 'p' }, api);

	assert.strictEqual(res.branch, 'trac-62281-2');
	assert.strictEqual(api.calls.filter((c) => c.url.includes('git/commits')).length, 1);
});

test('commitAndBranch stops on a failure that another name would not fix', async () => {
	const api = router({
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 403, headers: { 'x-ratelimit-remaining': '0' } }
	});

	const res = await commitAndBranch({ token: TOKEN, login: LOGIN, ticketId: 1, message: 'm', treeSha: 't', parentSha: 'p' }, api);

	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.reason, 'rate-limited');
	assert.strictEqual(api.calls.filter((c) => c.url.includes('git/refs')).length, 1);
});

test('createPullRequest opens it on upstream, from the fork’s branch', async () => {
	const api = router({
		'POST repos/WordPress/wordpress-develop/pulls': { status: 201, json: { html_url: 'https://github.com/WordPress/wordpress-develop/pull/9', number: 9 } }
	});

	const res = await createPullRequest({ token: TOKEN, login: LOGIN, branch: 'trac-62281', title: 'Fix it', body: 'B' }, api);

	assert.deepStrictEqual(res, { ok: true, url: 'https://github.com/WordPress/wordpress-develop/pull/9', number: 9 });
	const call = api.calls[0];
	assert.strictEqual(call.payload.head, 'janedoe:trac-62281');
	assert.strictEqual(call.payload.base, 'trunk');
});

function happyPathRoutes() {
	return {
		[`GET ${FORK_URL}`]: { status: 200, json: FORK_JSON },
		'GET git/commits/abc123': { status: 200, json: { tree: { sha: 'basetree' } } },
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } },
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 201 },
		'POST repos/WordPress/wordpress-develop/pulls': { status: 201, json: { html_url: 'https://github.com/x/pull/9', number: 9 } }
	};
}

test('openPullRequest runs the sequence and names each step as it starts', async () => {
	const api = router(happyPathRoutes());
	const stages = [];

	const res = await openPullRequest({
		token: TOKEN,
		login: LOGIN,
		ticketId: 62281,
		baseSha: 'abc123',
		files: [{ path: 'a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 'Fix it',
		body: 'B',
		onProgress: (stage) => stages.push(stage)
	}, api);

	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.number, 9);
	assert.strictEqual(res.branch, 'trac-62281');
	assert.strictEqual(res.exactBase, true);
	assert.deepStrictEqual(stages, ['forking', 'syncing', 'committing', 'opening']);
});

// The commit's tree comes from the base commit, not from the base commit's sha:
// they are different objects, and passing the wrong one produces a commit whose
// tree has nothing in it.
test('openPullRequest bases the tree on the base commit’s tree', async () => {
	const api = router(happyPathRoutes());

	await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 1, baseSha: 'abc123',
		files: [{ path: 'a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 't', body: 'b'
	}, api);

	const tree = api.calls.find((c) => c.url.includes('git/trees'));
	assert.strictEqual(tree.payload.base_tree, 'basetree');
});

// Every failure has the same fallback — the patch file — but the panel has to
// say which one happened and how far it got.
test('openPullRequest reports how far it got when a step fails', async () => {
	const api = router({ ...happyPathRoutes(), 'POST git/trees': { status: 401, json: { message: 'Bad credentials' } } });

	const res = await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 1, baseSha: 'abc123',
		files: [{ path: 'a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 't', body: 'b'
	}, api);

	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.reason, 'unauthorized');
	assert.strictEqual(res.stage, 'committing');
});

test('openPullRequest refuses an empty change before it touches GitHub', async () => {
	const api = router(happyPathRoutes());

	const res = await openPullRequest({ token: TOKEN, login: LOGIN, ticketId: 1, baseSha: 'abc123', files: [], title: 't', body: 'b' }, api);

	assert.strictEqual(res.reason, 'empty');
	assert.deepStrictEqual(api.calls, []);
});
