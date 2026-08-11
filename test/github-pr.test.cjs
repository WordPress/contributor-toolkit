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
	MAX_NOTES_LENGTH,
	testMode,
	ensureFork,
	resolveBase,
	staleTouchedPaths,
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

// The contributor's own words are the only part of the body a human writes,
// so they lead — a reviewer wants to know what the change is before they want
// its paperwork.
test('buildPullRequestBody puts the contributor’s notes above the ticket line', () => {
	const body = buildPullRequestBody({
		ticketId: 62281,
		handle: 'janedoe',
		notes: '  Rejects a theme zip in the plugin installer.\n\nSteps: upload twentytwentyfour.zip under Plugins → Add New.  '
	});

	assert.ok(body.startsWith('Rejects a theme zip'), 'the notes lead, and are trimmed');
	assert.ok(body.indexOf('Rejects a theme zip') < body.indexOf('Trac ticket:'));
	// Blank lines inside the notes survive: they are the contributor's
	// paragraphs, and flattening them would rewrite what they wrote.
	assert.ok(body.includes('installer.\n\nSteps:'));
	// The ticket line still has to be there and still has to be findable by
	// bodyCitesTicket, whatever a contributor typed above it.
	assert.ok(body.includes('Trac ticket: https://core.trac.wordpress.org/ticket/62281'));
	assert.ok(body.includes('@janedoe'));
});

test('buildPullRequestBody without notes is what it always was', () => {
	const body = buildPullRequestBody({ ticketId: 62281 });
	assert.ok(body.startsWith('Trac ticket:'));
	// Whitespace-only notes are no notes; they must not open the body with a
	// blank line above the ticket.
	assert.strictEqual(buildPullRequestBody({ ticketId: 62281, notes: '   \n  ' }), body);
});

// A body over GitHub's 65,536-character limit is rejected outright — at the
// last step, after every file has been uploaded. Nothing typed reaches this;
// a paste of the wrong thing does.
test('buildPullRequestBody bounds the notes it was given', () => {
	const body = buildPullRequestBody({ ticketId: 1, notes: 'x'.repeat(MAX_NOTES_LENGTH + 5000) });
	assert.ok(body.length < MAX_NOTES_LENGTH + 500);
	assert.ok(body.includes('Trac ticket:'), 'the ticket line survives the truncation');
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
	const api = router({
		[`GET ${FORK_URL}`]: { status: 200, json: FORK_JSON },
		[`GET ${FORK_URL}/git/ref/heads/trunk`]: { status: 200, json: { object: { sha: 'tip' } } }
	});

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
		[`GET ${FORK_URL}`]: (seen) => (seen < 3
			? { status: 404 }
			: { status: 200, json: FORK_JSON }),
		[`GET ${FORK_URL}/git/ref/heads/trunk`]: { status: 200, json: { object: { sha: 'tip' } } },
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.deepStrictEqual(res, { ok: true, created: true });
});

// The bug found by hand on the first real run: the repository *metadata*
// appears well before the fork's own ref database is ready. Forks share their
// upstream's object store, so every blob, tree and commit write succeeds
// against a fork that cannot yet take a branch — and the failure surfaces at
// the very last write as an opaque 404. Ready means the fork's own trunk ref
// answers, not that the repo shell exists.
test('ensureFork waits for the fork’s refs, not just its metadata', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: { status: 200, json: FORK_JSON },
		// The ref database catches up two polls after the metadata.
		[`GET ${FORK_URL}/git/ref/heads/trunk`]: (seen) => (seen < 3
			? { status: 404 }
			: { status: 200, json: { object: { sha: 'tip' } } }),
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.strictEqual(res.ok, true);
	assert.strictEqual(api.calls.filter((c) => c.url.endsWith('git/ref/heads/trunk')).length, 3);
});

test('ensureFork gives up on a fork whose refs never become ready, naming the wait', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: { status: 200, json: FORK_JSON },
		[`GET ${FORK_URL}/git/ref/heads/trunk`]: { status: 404 },
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, { ...api, forkPollAttempts: 2 });

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /try again/i);
});

test('ensureFork gives up with something actionable when the fork never appears', async () => {
	const api = router({
		[`GET ${FORK_URL}`]: { status: 404 },
		'POST repos/WordPress/wordpress-develop/forks': { status: 202 }
	});

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, { ...api, forkPollAttempts: 2 });

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /still being set up/);
});

test('ensureFork reports a revoked token as unauthorized rather than as a missing fork', async () => {
	const api = router({ [`GET ${FORK_URL}`]: { status: 401, json: { message: 'Bad credentials' } } });

	const res = await ensureFork({ token: TOKEN, login: LOGIN }, api);

	assert.strictEqual(res.reason, 'unauthorized');
});

// The base is the fork's trunk tip, always — verified by hand: git/refs 404s
// a fresh commit parented anywhere else, even on a plainly-reachable ancestor,
// and GET git/commits answers 200 for anything in the fork network, so "does
// the fork contain the local HEAD" cannot even be asked honestly.
test('resolveBase syncs the fork and bases on its trunk tip', async () => {
	const api = router({
		'POST merge-upstream': { status: 200 },
		'GET git/ref/heads/trunk': { status: 200, json: { object: { sha: 'tipsha' } } }
	});

	const res = await resolveBase({ token: TOKEN, login: LOGIN, baseSha: 'oldlocal' }, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'tipsha', exact: false });
	assert.ok(api.calls.some((c) => c.url.includes('merge-upstream') && c.payload.branch === 'trunk'));
});

test('resolveBase reports exact when the local HEAD is the tip', async () => {
	const api = router({
		'POST merge-upstream': { status: 200 },
		'GET git/ref/heads/trunk': { status: 200, json: { object: { sha: 'abc123' } } }
	});

	const res = await resolveBase({ token: TOKEN, login: LOGIN, baseSha: 'abc123' }, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'abc123', exact: true });
});

// A fork that has been committed to directly cannot be fast-forwarded — a 409
// from merge-upstream is a normal state, and the fork's own tip is the base.
test('resolveBase survives a fork that cannot be fast-forwarded', async () => {
	const api = router({
		'POST merge-upstream': { status: 409, json: { message: 'diverged' } },
		'GET git/ref/heads/trunk': { status: 200, json: { object: { sha: 'forktip' } } }
	});

	const res = await resolveBase({ token: TOKEN, login: LOGIN, baseSha: 'abc123' }, api);

	assert.deepStrictEqual(res, { ok: true, sha: 'forktip', exact: false });
});

// The guard for the sharp edge tip-basing has: the tree API replaces whole
// files, so a contributor behind trunk who touched a file upstream also
// changed would silently revert that upstream work.
//
// The base side is the blob sha the checkout already holds, not a second
// lookup — which is the bug this shape fixes, below.
test('staleTouchedPaths names the files upstream changed since the local base', async () => {
	const atTip = {
		'a.php': 'blob1',        // unchanged upstream
		'b.php': 'blob2-new',    // changed upstream
		'd.php': 'blob4'         // added upstream, absent from the base
	};
	const api = {
		get: async (url) => {
			const name = decodeURI(url).split('/contents/')[1].split('?')[0];
			return name in atTip
				? { status: 200, json: { sha: atTip[name] } }
				: { status: 404, json: {} };
		}
	};

	const res = await staleTouchedPaths({
		token: TOKEN,
		login: LOGIN,
		tipSha: 'tip',
		files: [
			{ path: 'a.php', baseBlobSha: 'blob1' },
			{ path: 'b.php', baseBlobSha: 'blob2' },
			// Present at the base, gone at the tip: upstream deleted it, and
			// uploading would bring it back.
			{ path: 'c.php', baseBlobSha: 'blob3' },
			// The contributor is adding it; upstream added one too.
			{ path: 'd.php', baseBlobSha: null }
		]
	}, api);

	assert.deepStrictEqual(res, { ok: true, clashes: ['b.php', 'c.php', 'd.php'] });
});

// A file the contributor is adding that upstream does not have is not a clash,
// and must not be reported as one — it is the ordinary case for a new test
// file.
test('staleTouchedPaths does not call a genuinely new file a clash', async () => {
	const api = { get: async () => ({ status: 404, json: {} }) };

	const res = await staleTouchedPaths(
		{ token: TOKEN, login: LOGIN, tipSha: 'tip', files: [{ path: 'tests/new-test.php', baseBlobSha: null }] },
		api
	);

	assert.deepStrictEqual(res, { ok: true, clashes: [] });
});

// The false positive this shape exists to prevent, reported from a real run:
// the guard fired on CONTRIBUTING.md, a file upstream had not touched since
// 2021. The base side used to be a second lookup against the fork, and a fork
// answers 404 for a commit it has not heard of — indistinguishable from "the
// file was not there", so an unrecognised base read as every touched file
// having changed. Now the base is the sha the checkout holds, and no request
// can produce that answer.
test('staleTouchedPaths cannot be misled about the base by the fork', async () => {
	const asked = [];
	const api = {
		get: async (url) => {
			asked.push(url);
			return { status: 200, json: { sha: 'unchanged-since-2021' } };
		}
	};

	const res = await staleTouchedPaths(
		{ token: TOKEN, login: LOGIN, tipSha: 'tip', files: [{ path: 'CONTRIBUTING.md', baseBlobSha: 'unchanged-since-2021' }] },
		api
	);

	assert.deepStrictEqual(res, { ok: true, clashes: [] });
	// One request, for the tip. The base is never asked about.
	assert.strictEqual(asked.length, 1);
	assert.ok(asked[0].includes('ref=tip'));
});

test('openPullRequest refuses a stale checkout whose files upstream also changed', async () => {
	const api = router({
		...happyPathRoutes(),
		// Same key as the happy path's, so this override wins outright rather
		// than competing on pattern length.
		[`GET ${FORK_URL}/git/ref/heads/trunk`]: { status: 200, json: { object: { sha: 'newer-tip' } } },
		'GET contents/a.php?ref=newer-tip': { status: 200, json: { sha: 'blob-upstream' } }
	});

	const res = await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 1, baseSha: 'abc123',
		files: [{ path: 'a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644', baseBlobSha: 'blob-old' }],
		title: 't', body: 'b'
	}, api);

	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.reason, 'stale');
	assert.match(res.error, /a\.php/);
	assert.match(res.error, /Update this site/);
	// Refused before anything was uploaded.
	assert.strictEqual(api.calls.filter((c) => c.url.includes('git/blobs')).length, 0);
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

// The readiness gate in ensureFork shrinks this window but cannot close it: a
// 404 here is the fork's ref database still initialising, and "Not Found" told
// the contributor nothing.
test('commitAndBranch names a still-initialising fork instead of saying Not Found', async () => {
	const api = router({
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 404, json: { message: 'Not Found' } }
	});

	const res = await commitAndBranch({ token: TOKEN, login: LOGIN, ticketId: 1, message: 'm', treeSha: 't', parentSha: 'p' }, api);

	assert.strictEqual(res.ok, false);
	assert.match(res.error, /still being set up/);
	assert.match(res.error, /try again/i);
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
		// The tip equals the local HEAD, so the happy path is the exact-base one.
		[`GET ${FORK_URL}/git/ref/heads/trunk`]: { status: 200, json: { object: { sha: 'abc123' } } },
		'POST merge-upstream': { status: 200 },
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

// The two quiet-testing switches (both env-driven, both absent in production):
// a sandbox upstream so the whole flow can run without wordpress-develop's
// watchers hearing about it, and a dry run that stops after the branch — the
// fork writes are private; the pull request is the noisy step.

test('WP_DEV_ENV_GITHUB_UPSTREAM points the whole flow at a sandbox', async (t) => {
	process.env.WP_DEV_ENV_GITHUB_UPSTREAM = 'sandbox-org/pr-sandbox';
	t.after(() => { delete process.env.WP_DEV_ENV_GITHUB_UPSTREAM; });

	const api = router({
		'GET repos/janedoe/pr-sandbox': { status: 200, json: { fork: true, parent: { full_name: 'sandbox-org/pr-sandbox' } } },
		'GET repos/janedoe/pr-sandbox/git/ref/heads/trunk': { status: 200, json: { object: { sha: 'abc123' } } },
		'POST merge-upstream': { status: 200 },
		'GET git/commits/abc123': { status: 200, json: { tree: { sha: 'basetree' } } },
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } },
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 201 },
		'POST repos/sandbox-org/pr-sandbox/pulls': { status: 201, json: { html_url: 'https://github.com/sandbox-org/pr-sandbox/pull/1', number: 1 } }
	});

	const res = await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 1, baseSha: 'abc123',
		files: [{ path: 'a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 't', body: 'b'
	}, api);

	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.url, 'https://github.com/sandbox-org/pr-sandbox/pull/1');
	// Nothing touched the real upstream.
	assert.strictEqual(api.calls.some((c) => c.url.includes('wordpress-develop')), false);
});

// The card reads this to say which mode it is in. Null in a shipped build is
// the load-bearing case: it is what keeps the badge off a real contributor's
// screen.
test('testMode is null unless a switch is set, and names the mode when one is', (t) => {
	t.after(() => {
		delete process.env.WP_DEV_ENV_GITHUB_DRY_RUN;
		delete process.env.WP_DEV_ENV_GITHUB_UPSTREAM;
	});

	assert.strictEqual(testMode(), null);

	process.env.WP_DEV_ENV_GITHUB_DRY_RUN = '1';
	assert.deepStrictEqual(testMode(), { dryRun: true, target: 'WordPress/wordpress-develop' });

	delete process.env.WP_DEV_ENV_GITHUB_DRY_RUN;
	process.env.WP_DEV_ENV_GITHUB_UPSTREAM = 'sandbox-org/pr-sandbox';
	assert.deepStrictEqual(testMode(), { dryRun: false, target: 'sandbox-org/pr-sandbox' });

	// An upstream override that names the real repository is not a test mode —
	// it changes nothing, so the badge would be a lie.
	process.env.WP_DEV_ENV_GITHUB_UPSTREAM = 'WordPress/wordpress-develop';
	assert.strictEqual(testMode(), null);
});

test('WP_DEV_ENV_GITHUB_DRY_RUN stops after the branch, before the pull request', async (t) => {
	process.env.WP_DEV_ENV_GITHUB_DRY_RUN = '1';
	t.after(() => { delete process.env.WP_DEV_ENV_GITHUB_DRY_RUN; });

	const api = router(happyPathRoutes());
	const res = await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 62281, baseSha: 'abc123',
		files: [{ path: 'a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 't', body: 'b'
	}, api);

	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.dryRun, true);
	assert.strictEqual(res.branch, 'trac-62281');
	assert.match(res.url, /tree\/trac-62281$/);
	// The branch was created; the pull request never was.
	assert.strictEqual(api.calls.some((c) => c.url.includes('git/refs')), true);
	assert.strictEqual(api.calls.some((c) => c.url.endsWith('/pulls')), false);
});

test('openPullRequest refuses an empty change before it touches GitHub', async () => {
	const api = router(happyPathRoutes());

	const res = await openPullRequest({ token: TOKEN, login: LOGIN, ticketId: 1, baseSha: 'abc123', files: [], title: 't', body: 'b' }, api);

	assert.strictEqual(res.reason, 'empty');
	assert.deepStrictEqual(api.calls, []);
});

// --- per-project pull requests (#251) --------------------------------------

test('branchNameFor uses the project’s prefix, and still de-duplicates', () => {
	// Core, unchanged.
	assert.strictEqual(branchNameFor(62281), 'trac-62281');
	assert.strictEqual(branchNameFor(62281, 1), 'trac-62281-2');
	// Gutenberg: the branch has to read correctly in the repository it lands in.
	assert.strictEqual(branchNameFor(71234, 0, 'fix/issue-'), 'fix/issue-71234');
	assert.strictEqual(branchNameFor(71234, 1, 'fix/issue-'), 'fix/issue-71234-2');
});

test('buildPullRequestBody cites the work item the project’s way', () => {
	// Core, unchanged: the Trac URL, on its own line.
	const core = buildPullRequestBody({ ticketId: 62281 });
	assert.ok(core.includes('Trac ticket: https://core.trac.wordpress.org/ticket/62281'), core);

	// Gutenberg: a closing keyword, so merging the PR closes the issue.
	const gutenberg = buildPullRequestBody({
		ticketId: 71234,
		project: { bodyLine: (id) => `Fixes #${id}`, workItemUrl: 'https://github.com/WordPress/gutenberg/issues/71234' }
	});
	assert.ok(gutenberg.includes('Fixes #71234'), gutenberg);
	assert.ok(!gutenberg.includes('core.trac.wordpress.org'), 'a Gutenberg PR must not cite Trac');
	// The rest of the body is unchanged — it is not project-specific.
	assert.ok(gutenberg.includes('Opened from the WordPress Contributor Toolkit.'));
});

test('buildPullRequestBody keeps the contributor’s notes above the citation', () => {
	const body = buildPullRequestBody({
		ticketId: 71234,
		notes: 'What it does.',
		project: { bodyLine: (id) => `Fixes #${id}` }
	});
	assert.ok(body.indexOf('What it does.') < body.indexOf('Fixes #71234'), body);
});

// The single highest-risk behaviour of the per-project flow: a Gutenberg run has
// to fork, sync, branch and open against WordPress/gutenberg. Every helper reads
// the project out of `deps`, so one that forgets would silently open a pull
// request against wordpress-develop — a real PR, on the wrong project, from a
// contributor who asked for neither. Pinned end to end rather than per helper.
test('a Gutenberg project opens its pull request against WordPress/gutenberg', async () => {
	const api = router({
		'GET repos/janedoe/gutenberg': { status: 200, json: { fork: true, parent: { full_name: 'WordPress/gutenberg' } } },
		'GET repos/janedoe/gutenberg/git/ref/heads/trunk': { status: 200, json: { object: { sha: 'abc123' } } },
		'POST merge-upstream': { status: 200 },
		'GET git/commits/abc123': { status: 200, json: { tree: { sha: 'basetree' } } },
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } },
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 201 },
		'POST repos/WordPress/gutenberg/pulls': { status: 201, json: { html_url: 'https://github.com/WordPress/gutenberg/pull/1', number: 1 } }
	});

	const res = await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 71234, baseSha: 'abc123',
		files: [{ path: 'packages/a/index.js', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 't', body: 'b',
		project: { upstream: { owner: 'WordPress', repo: 'gutenberg', base: 'trunk' }, branchPrefix: 'fix/issue-' }
	}, api);

	assert.strictEqual(res.ok, true, res.error);
	assert.strictEqual(res.url, 'https://github.com/WordPress/gutenberg/pull/1');
	// The branch reads correctly in the repository it landed in.
	assert.strictEqual(res.branch, 'fix/issue-71234');
	// And nothing in the whole sequence — fork, ref read, sync, tree, commit,
	// branch, pull request — went near the other project.
	assert.strictEqual(api.calls.some((c) => c.url.includes('wordpress-develop')), false, 'a Gutenberg run must not touch wordpress-develop');
	// The fork it uses is the Gutenberg one, not a wordpress-develop fork.
	assert.ok(api.calls.some((c) => c.url.includes('repos/janedoe/gutenberg')), 'the fork is the project’s own');
});

// The other side of the same coin: with no project, every call still goes to
// wordpress-develop exactly as it always did.
test('with no project the flow still targets wordpress-develop', async () => {
	const api = router({
		'GET repos/janedoe/wordpress-develop': { status: 200, json: { fork: true, parent: { full_name: 'WordPress/wordpress-develop' } } },
		'GET repos/janedoe/wordpress-develop/git/ref/heads/trunk': { status: 200, json: { object: { sha: 'abc123' } } },
		'POST merge-upstream': { status: 200 },
		'GET git/commits/abc123': { status: 200, json: { tree: { sha: 'basetree' } } },
		'POST git/blobs': { status: 201, json: { sha: 'blob1' } },
		'POST git/trees': { status: 201, json: { sha: 'tree1' } },
		'POST git/commits': { status: 201, json: { sha: 'commit1' } },
		'POST git/refs': { status: 201 },
		'POST repos/WordPress/wordpress-develop/pulls': { status: 201, json: { html_url: 'https://github.com/WordPress/wordpress-develop/pull/9', number: 9 } }
	});

	const res = await openPullRequest({
		token: TOKEN, login: LOGIN, ticketId: 62281, baseSha: 'abc123',
		files: [{ path: 'src/a.php', kind: 'modify', content: Buffer.from('x'), mode: '100644' }],
		title: 't', body: 'b'
	}, api);

	assert.strictEqual(res.ok, true, res.error);
	assert.strictEqual(res.branch, 'trac-62281');
	assert.strictEqual(api.calls.some((c) => c.url.includes('gutenberg')), false);
});
