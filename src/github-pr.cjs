'use strict';

/**
 * Opening a pull request against wordpress-develop from the working tree (#167).
 *
 * Nothing here shells out to git and nothing here writes a credential to disk.
 * The whole sequence is GitHub's own API: fork the repository, bring the fork's
 * trunk up to date, upload the changed files as blobs, assemble a tree, commit
 * it, create a branch pointing at that commit, and open the pull request. The
 * only thing that ever holds the token is the main process, in memory, for the
 * length of one app run.
 *
 * Why the Git Data API rather than the contents API, which is simpler: the
 * contents endpoint writes one commit per file, so a five-file change would
 * arrive as five commits with four intermediate states that never compiled.
 * Blobs → tree → commit produces the one commit a reviewer expects.
 *
 * Two things in here exist because of what a real first run taught (all of it
 * verified by hand on 2026-08-08):
 *
 *   - the branch bases on the fork's trunk tip, never on the local checkout's
 *     HEAD — `git/refs` refuses a commit parented anywhere else, and the fork
 *     answers 200 for *any* commit in the fork network, so "does the fork have
 *     it" cannot even be asked honestly. See resolveBase.
 *   - basing on the tip replaces whole files, so a checkout that is behind
 *     trunk must not touch a file upstream also changed — that would silently
 *     revert other people's work. See staleTouchedPaths.
 *
 * Every failure is typed, because every failure has the same fallback — the
 * patch file, which is always still there — but not the same explanation.
 */

const { getJson, postJson } = require('./github-http.cjs');
const { classifyHttpFailure } = require('./patch-sources.cjs');
const { ticketUrl } = require('./renderer/trac-ticket.cjs');

const UPSTREAM_OWNER = 'WordPress';
const UPSTREAM_REPO = 'wordpress-develop';

/**
 * Which repository the flow targets. `WP_DEV_ENV_GITHUB_UPSTREAM=owner/repo`
 * points the whole sequence — fork, branch and pull request — at a sandbox, so
 * the flow can be exercised end to end without a single watcher of
 * wordpress-develop hearing about it. Same pattern as the client-ID override:
 * an environment variable for testing, the constant for what ships. The
 * sandbox needs a `trunk` branch and must not be owned by the signed-in
 * account, since an account cannot fork its own repository.
 *
 * @return {{owner: string, repo: string}}
 */
function upstream() {
	const raw = process.env.WP_DEV_ENV_GITHUB_UPSTREAM;
	const match = typeof raw === 'string' && /^([^/\s]+)\/([^/\s]+)$/.exec(raw.trim());
	if (match) return { owner: match[1], repo: match[2] };
	return { owner: UPSTREAM_OWNER, repo: UPSTREAM_REPO };
}
const BASE_BRANCH = 'trunk';
const API = 'https://api.github.com';

// Forking is asynchronous: the POST returns 202 and the repository fills in
// afterwards. GitHub documents up to five minutes for a large repository, and
// wordpress-develop is one — the first real run took minutes to become ready.
// These bounds are that documented worst case; the progress label says what
// the wait is, so a long one reads as work rather than a hang.
const FORK_POLL_ATTEMPTS = 100;
const FORK_POLL_INTERVAL_MS = 3000;

// How many `-2`, `-3`… suffixes to try before giving up on a branch name. A
// contributor with ten open branches for one ticket has a different problem.
const MAX_BRANCH_ATTEMPTS = 10;

const DEFAULT_MODE = '100644';

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Why a request failed, in the terms the panel can act on.
 *
 * 401 is checked before the shared classifier because in the GitHub API it
 * always means the token is no longer good — a revoked authorization, most
 * often — and that has its own recovery: forget the token and offer sign-in
 * again. classifyHttpFailure reads a 401 with a spent quota as rate-limiting,
 * which is right for the anonymous reads it was written for and wrong here.
 *
 * @param {{status: number, headers: Object}} res
 * @return {string}
 */
function classifyFailure(res) {
	if (res.status === 401) return 'unauthorized';
	return classifyHttpFailure(res.status, res.headers || {});
}

/**
 * The trailing diagnostic exists because a failure here has already survived
 * three wrong theories: the status, GitHub's request id and the scopes GitHub
 * says the presented token had make the error self-describing enough to take
 * to GitHub support — or to disprove the next theory without another round
 * trip through a contributor.
 *
 * @param {{status: number, headers: Object, json: Object|null}} res
 * @param {string}                                               what
 * @return {{ok: false, reason: string, error: string}}
 */
function failure(res, what) {
	const detail = res.json && res.json.message ? res.json.message : `GitHub returned ${res.status}`;
	return { ok: false, reason: classifyFailure(res), error: `${what}: ${detail}${describeResponse(res)}` };
}

/**
 * @param {{status: number, headers: Object}} res
 * @return {string}
 */
function describeResponse(res) {
	const headers = res.headers || {};
	const parts = [`status ${res.status}`];
	if (headers['x-oauth-scopes'] !== undefined) parts.push(`token scopes: ${headers['x-oauth-scopes'] || '(none)'}`);
	if (headers['x-github-request-id']) parts.push(`request ${headers['x-github-request-id']}`);
	return ` [${parts.join('; ')}]`;
}

/**
 * The pull request body, in the form core's Trac↔GitHub convention expects.
 *
 * The ticket line is not decoration: it is what links the pull request back to
 * the ticket, what Trac's own bot reads, and — pleasingly — what this app's own
 * `bodyCitesTicket` in patch-sources.cjs looks for, so a pull request opened
 * here shows up in the site's "patches on this ticket" list afterwards.
 *
 * @param {Object}        root0
 * @param {number|string} root0.ticketId
 * @param {string}        [root0.handle]
 * @param {string}        [root0.event]
 * @return {string}
 */
function buildPullRequestBody({ ticketId, handle, event } = {}) {
	const lines = [`Trac ticket: ${ticketUrl(ticketId)}`];
	// The same two facts the mentor-handoff header carries (#166), for the same
	// reason: props follow whoever wrote the patch, and a contributor-day room
	// is worth naming while it is still happening.
	if (handle) lines.push('', `Written by @${handle} on WordPress.org.`);
	if (event) lines.push(handle ? `At ${event}.` : `Written at ${event}.`);
	lines.push('', 'Opened from the WordPress Contributor Toolkit.');
	return lines.join('\n');
}

/**
 * A branch name for a ticket, and the alternatives to try if it is taken.
 *
 * @param {number|string} ticketId
 * @param {number}        attempt  Zero for the first try.
 * @return {string}
 */
function branchNameFor(ticketId, attempt = 0) {
	const base = `trac-${String(ticketId).replace(/[^0-9]/g, '')}`;
	return attempt === 0 ? base : `${base}-${attempt + 1}`;
}

/**
 * The fork, creating it first if the contributor has none.
 *
 * An existing fork short-circuits: forking twice is not an error at GitHub, but
 * it is a wasted write and a needless wait.
 *
 * @param {Object} root0
 * @param {string} root0.token
 * @param {string} root0.login
 * @param {Object} [deps]
 * @return {Promise<{ok: true, created: boolean}|{ok: false, reason: string, error: string}>}
 */
async function ensureFork({ token, login }, deps = {}) {
	const get = deps.get || getJson;
	const post = deps.post || postJson;
	const wait = deps.sleep || sleep;
	const attempts = deps.forkPollAttempts || FORK_POLL_ATTEMPTS;
	const up = upstream();
	const forkUrl = `${API}/repos/${login}/${up.repo}`;

	// A repository under the fork's name is only usable if it actually is a
	// fork of upstream. A contributor who happens to own an unrelated
	// repository called wordpress-develop must be told at step one — the
	// alternative is writing a branch and a commit into their project and
	// failing at the very end with an opaque 422.
	const isOurFork = (json) => Boolean(json && json.fork)
		&& [json.parent, json.source].some((repo) => repo && repo.full_name === `${up.owner}/${up.repo}`);
	const notAFork = () => ({
		ok: false,
		reason: 'error',
		error: `You already have a repository named ${up.repo} that is not a fork of ${up.owner}/${up.repo}, so there is nowhere to push this. The patch file still works.`
	});

	// Ready means the fork's own trunk ref answers — not that the repo
	// metadata exists. Forks share their upstream's object store, so on a fork
	// that is still initialising every blob, tree and commit write *succeeds*
	// while the fork's own ref database is not there yet, and the failure
	// surfaces at the very last write — the branch — as an opaque 404. Found
	// by hand on the first real run against this repository, which is big
	// enough for that window to be minutes wide.
	const readRefs = () => get(`${forkUrl}/git/ref/heads/${BASE_BRANCH}`, { token });

	let existing;
	try {
		existing = await get(forkUrl, { token });
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
	if (existing.status === 200 && !isOurFork(existing.json)) return notAFork();
	if (existing.status !== 200 && existing.status !== 404) return failure(existing, 'Could not check for your fork');

	let created = false;
	if (existing.status === 404) {
		let forked;
		try {
			forked = await post(`${API}/repos/${up.owner}/${up.repo}/forks`, {}, { token });
		} catch (e) {
			return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
		}
		if (forked.status !== 202 && forked.status !== 200) return failure(forked, 'Could not fork wordpress-develop');
		created = true;
	}

	// One wait loop for both cases: a fork this call just made, and one from an
	// earlier attempt that is still initialising — which is exactly the state a
	// contributor retrying after the first try "failed" arrives in.
	try {
		for (let i = 0; i < attempts; i++) {
			const ref = await readRefs();
			if (ref.status === 200) return { ok: true, created };
			// 404 is the fork still initialising, the state this loop exists to
			// wait out. Anything else — a token revoked mid-wait, a spent rate
			// limit — will not resolve by waiting, so it is reported as itself.
			if (ref.status !== 404) return failure(ref, 'Could not read your fork');
			await wait(FORK_POLL_INTERVAL_MS);
		}
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}

	return {
		ok: false,
		reason: 'error',
		error: 'Your fork is still being set up on GitHub — for a repository this size that can take a few minutes. Try again shortly; the patch file still works.'
	};
}

/**
 * Which commit the new branch is based on: the fork's trunk tip, always.
 *
 * An earlier version based the branch on the local checkout's HEAD whenever
 * `GET git/commits/{sha}` on the fork answered 200 — and that answer is a lie.
 * Forks share their upstream's object store, so the fork serves *any* commit
 * in the network, reachable from its own refs or not. Worse, verified by hand
 * on 2026-08-08: `POST git/refs` refuses (404, not 422) a freshly API-created
 * commit whose parent is anything but the current branch tip — even a
 * plainly-reachable ancestor. The tip is not merely the safest base; it is
 * the only one GitHub will let a branch point at.
 *
 * Basing on the tip has one sharp edge the caller must handle: the tree API
 * replaces whole files, so a contributor whose checkout is behind trunk would
 * silently revert any upstream change to a file they also touched. That is
 * what `staleTouchedPaths` below is for — openPullRequest refuses that case
 * and sends the contributor to the app's own "Update to latest trunk" flow
 * instead of opening a pull request that undoes other people's work.
 *
 * @param {Object} root0
 * @param {string} root0.token
 * @param {string} root0.login
 * @param {string} root0.baseSha The local checkout's HEAD, for the exact flag.
 * @param {Object} [deps]
 * @return {Promise<{ok: true, sha: string, exact: boolean}|{ok: false, reason: string, error: string}>}
 */
async function resolveBase({ token, login, baseSha }, deps = {}) {
	const get = deps.get || getJson;
	const post = deps.post || postJson;
	const repo = `${API}/repos/${login}/${upstream().repo}`;

	try {
		// Always fast-forward first, so "the tip" means today's trunk and not
		// wherever the fork was left. 409 here is a diverged fork, which is a
		// normal state for someone who has contributed before — not a failure
		// to report; the branch then bases on the fork's own tip.
		await post(`${repo}/merge-upstream`, { branch: BASE_BRANCH }, { token });

		const ref = await get(`${repo}/git/ref/heads/${BASE_BRANCH}`, { token });
		if (ref.status !== 200 || !ref.json || !ref.json.object || !ref.json.object.sha) {
			return failure(ref, 'Could not read your fork’s trunk');
		}
		const tip = String(ref.json.object.sha);
		return { ok: true, sha: tip, exact: tip === baseSha };
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
}

/**
 * Which of the contributor's files upstream has also changed since the local
 * checkout's HEAD. Non-empty means opening the pull request would replace
 * those files wholesale and silently revert the upstream work.
 *
 * Asked per file through the contents API rather than once through compare:
 * compare caps its file list at 300, and a checkout a few weeks old is behind
 * by more than that repo-wide — a cap that silently hides exactly the clash
 * being looked for. The contributor's own file count is small.
 *
 * A path answers with its blob sha at each of the two commits; any difference
 * — content, or existing on one side only — is a clash. An error reading
 * either side counts as a clash too: the check exists to prevent silent
 * damage, so it fails closed.
 *
 * @param {Object}   root0
 * @param {string}   root0.token
 * @param {string}   root0.login
 * @param {string}   root0.baseSha Local checkout's HEAD.
 * @param {string}   root0.tipSha  The fork's trunk tip.
 * @param {string[]} root0.paths   Repo-relative paths the contributor changed.
 * @param {Object}   [deps]
 * @return {Promise<{ok: true, clashes: string[]}|{ok: false, reason: string, error: string}>}
 */
async function staleTouchedPaths({ token, login, baseSha, tipSha, paths }, deps = {}) {
	const get = deps.get || getJson;
	const repo = `${API}/repos/${login}/${upstream().repo}`;

	const blobShaAt = async (path, ref) => {
		const res = await get(`${repo}/contents/${encodeURI(path)}?ref=${ref}`, { token });
		if (res.status === 404) return null;
		if (res.status !== 200 || !res.json || !res.json.sha) throw new Error(`GitHub returned ${res.status} for ${path}`);
		return String(res.json.sha);
	};

	const clashes = [];
	try {
		for (const path of paths) {
			const [atBase, atTip] = await Promise.all([blobShaAt(path, baseSha), blobShaAt(path, tipSha)]);
			if (atBase !== atTip) clashes.push(path);
		}
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
	return { ok: true, clashes };
}

/**
 * Uploads the changed files and assembles the tree they belong in.
 *
 * `base_tree` is the base commit's tree, so unchanged files are inherited
 * rather than re-uploaded — the alternative is sending all of wordpress-develop
 * over a contributor day's wifi.
 *
 * A deletion is an entry with a null sha; that is the only way the tree API
 * expresses one, and it is why deletions work here even though the `.diff` this
 * app writes still drops them (#174).
 *
 * @param {Object} root0
 * @param {string} root0.token
 * @param {string} root0.login
 * @param {string} root0.baseTreeSha
 * @param {Array}  root0.files       `{ path, kind, content: Buffer|null, mode }`
 * @param {Object} [deps]
 * @return {Promise<{ok: true, sha: string}|{ok: false, reason: string, error: string}>}
 */
async function createTree({ token, login, baseTreeSha, files }, deps = {}) {
	const post = deps.post || postJson;
	const repo = `${API}/repos/${login}/${upstream().repo}`;
	const entries = [];

	try {
		for (const file of files) {
			if (file.kind === 'delete') {
				entries.push({ path: file.path, mode: file.mode || DEFAULT_MODE, type: 'blob', sha: null });
				continue;
			}
			// base64 for every file, not just the binary ones: it is the only
			// encoding that survives a file the API's utf-8 mode would mangle,
			// and there is no benefit to picking per file.
			const blob = await post(`${repo}/git/blobs`, {
				content: Buffer.from(file.content || Buffer.alloc(0)).toString('base64'),
				encoding: 'base64'
			}, { token });
			if (blob.status !== 201 || !blob.json || !blob.json.sha) {
				return failure(blob, `Could not upload ${file.path}`);
			}
			entries.push({ path: file.path, mode: file.mode || DEFAULT_MODE, type: 'blob', sha: blob.json.sha });
		}

		const tree = await post(`${repo}/git/trees`, { base_tree: baseTreeSha, tree: entries }, { token });
		if (tree.status !== 201 || !tree.json || !tree.json.sha) return failure(tree, 'Could not assemble the change');
		return { ok: true, sha: String(tree.json.sha) };
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
}

/**
 * The commit, and the branch that points at it.
 *
 * The branch is created last and separately so a name collision — the same
 * ticket worked on twice — costs one retry rather than re-uploading everything.
 *
 * @param {Object}        root0
 * @param {string}        root0.token
 * @param {string}        root0.login
 * @param {number|string} root0.ticketId
 * @param {string}        root0.message
 * @param {string}        root0.treeSha
 * @param {string}        root0.parentSha
 * @param {Object}        [deps]
 * @return {Promise<{ok: true, branch: string, sha: string}|{ok: false, reason: string, error: string}>}
 */
async function commitAndBranch({ token, login, ticketId, message, treeSha, parentSha }, deps = {}) {
	const post = deps.post || postJson;
	const repo = `${API}/repos/${login}/${upstream().repo}`;

	try {
		const commit = await post(`${repo}/git/commits`, {
			message,
			tree: treeSha,
			parents: [parentSha]
		}, { token });
		if (commit.status !== 201 || !commit.json || !commit.json.sha) return failure(commit, 'Could not create the commit');
		const sha = String(commit.json.sha);

		let lastRes = null;
		for (let attempt = 0; attempt < MAX_BRANCH_ATTEMPTS; attempt++) {
			const branch = branchNameFor(ticketId, attempt);
			const ref = await post(`${repo}/git/refs`, { ref: `refs/heads/${branch}`, sha }, { token });
			if (ref.status === 201) return { ok: true, branch, sha };
			// A 404 here is the fork's ref database still initialising — the
			// residual window the readiness gate in ensureFork cannot fully
			// close, since the commit just succeeded against the shared object
			// store. "Not Found" told the contributor nothing.
			if (ref.status === 404) {
				return {
					ok: false,
					reason: 'error',
					error: `Your fork is still being set up on GitHub. Try again in a minute — the patch file still works.${describeResponse(ref)}`
				};
			}
			// 422 is how GitHub says the reference already exists — the only
			// status worth another name. Anything else is a real failure and
			// retrying it nine more times would only slow down the report.
			if (ref.status !== 422) return failure(ref, 'Could not create the branch');
			lastRes = ref;
		}
		return failure(lastRes, 'Could not find an unused branch name');
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
}

/**
 * The pull request itself, opened on upstream from the fork's branch.
 *
 * @param {Object} root0
 * @param {string} root0.token
 * @param {string} root0.login
 * @param {string} root0.branch
 * @param {string} root0.title
 * @param {string} root0.body
 * @param {Object} [deps]
 * @return {Promise<{ok: true, url: string, number: number}|{ok: false, reason: string, error: string}>}
 */
async function createPullRequest({ token, login, branch, title, body }, deps = {}) {
	const post = deps.post || postJson;
	try {
		const up = upstream();
		const res = await post(`${API}/repos/${up.owner}/${up.repo}/pulls`, {
			title,
			body,
			head: `${login}:${branch}`,
			base: BASE_BRANCH,
			maintainer_can_modify: true
		}, { token });
		if (res.status !== 201 || !res.json || !res.json.html_url) return failure(res, 'Could not open the pull request');
		return { ok: true, url: String(res.json.html_url), number: Number(res.json.number) };
	} catch (e) {
		return { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) };
	}
}

/**
 * The whole sequence, reporting each step as it starts.
 *
 * Returns rather than throws on every failure, and the caller's fallback is
 * always the same: the patch file. `stage` says how far it got, which is what
 * makes "your fork exists, the pull request does not" a message a contributor
 * can act on instead of a dead end.
 *
 * @param {Object}        root0
 * @param {string}        root0.token
 * @param {string}        root0.login
 * @param {number|string} root0.ticketId
 * @param {string}        root0.baseSha
 * @param {Array}         root0.files
 * @param {string}        root0.title
 * @param {string}        root0.body
 * @param {Function}      [root0.onProgress]
 * @param {Object}        [deps]
 * @return {Promise<{ok: true, url: string, number: number, branch: string, exactBase: boolean}|{ok: false, reason: string, error: string, stage: string}>}
 */
async function openPullRequest({ token, login, ticketId, baseSha, files, title, body, onProgress }, deps = {}) {
	const get = deps.get || getJson;
	const report = typeof onProgress === 'function' ? onProgress : () => {};
	const at = (stage, result) => ({ ...result, stage });

	if (!files || files.length === 0) {
		return { ok: false, reason: 'empty', error: 'There are no changes to open a pull request with.', stage: 'collect' };
	}

	report('forking');
	const fork = await ensureFork({ token, login }, deps);
	if (!fork.ok) return at('forking', fork);

	report('syncing');
	const base = await resolveBase({ token, login, baseSha }, deps);
	if (!base.ok) return at('syncing', base);

	// A stale checkout is fine — the branch bases on today's trunk and carries
	// the contributor's files on top — except where upstream also changed one
	// of those same files. There the tree API's whole-file replacement would
	// silently revert other people's work, so that case stops here, pointed at
	// the app's own update flow rather than at a pull request that undoes
	// commits its author never saw.
	if (!base.exact) {
		const stale = await staleTouchedPaths({
			token,
			login,
			baseSha,
			tipSha: base.sha,
			paths: files.map((f) => f.path)
		}, deps);
		if (!stale.ok) return at('syncing', stale);
		if (stale.clashes.length > 0) {
			return {
				ok: false,
				reason: 'stale',
				error: `Trunk has moved under ${stale.clashes.length === 1 ? 'a file you edited' : 'files you edited'} (${stale.clashes.slice(0, 3).join(', ')}${stale.clashes.length > 3 ? ', …' : ''}). Update this site to the latest trunk, check your changes still apply, and try again.`,
				stage: 'syncing'
			};
		}
	}

	// The tree the commit inherits from, read off the base commit rather than
	// assumed: a commit sha and its tree sha are different objects, and passing
	// the wrong one silently produces a tree with no history behind it.
	let baseCommit;
	try {
		baseCommit = await get(`${API}/repos/${login}/${upstream().repo}/git/commits/${base.sha}`, { token });
	} catch (e) {
		return at('syncing', { ok: false, reason: 'offline', error: String(e && e.message ? e.message : e) });
	}
	if (baseCommit.status !== 200 || !baseCommit.json || !baseCommit.json.tree) {
		return at('syncing', failure(baseCommit, 'Could not read the base commit'));
	}

	report('committing');
	const tree = await createTree({ token, login, baseTreeSha: baseCommit.json.tree.sha, files }, deps);
	if (!tree.ok) return at('committing', tree);

	const branched = await commitAndBranch({
		token,
		login,
		ticketId,
		message: title,
		treeSha: tree.sha,
		parentSha: base.sha
	}, deps);
	if (!branched.ok) return at('committing', branched);

	// Everything up to here wrote only to the contributor's own fork, where a
	// spare branch bothers nobody. The pull request is the one step the
	// upstream's watchers hear about, so it is the one a dry run skips —
	// letting the rest of the flow be exercised against the real API without
	// generating noise.
	if (process.env.WP_DEV_ENV_GITHUB_DRY_RUN) {
		return {
			ok: true,
			dryRun: true,
			url: `https://github.com/${login}/${upstream().repo}/tree/${branched.branch}`,
			number: null,
			branch: branched.branch,
			exactBase: base.exact
		};
	}

	report('opening');
	const pr = await createPullRequest({ token, login, branch: branched.branch, title, body }, deps);
	if (!pr.ok) return at('opening', pr);

	return { ok: true, url: pr.url, number: pr.number, branch: branched.branch, exactBase: base.exact };
}

module.exports = {
	UPSTREAM_OWNER,
	UPSTREAM_REPO,
	BASE_BRANCH,
	MAX_BRANCH_ATTEMPTS,
	classifyFailure,
	buildPullRequestBody,
	branchNameFor,
	ensureFork,
	resolveBase,
	staleTouchedPaths,
	createTree,
	commitAndBranch,
	createPullRequest,
	openPullRequest
};
