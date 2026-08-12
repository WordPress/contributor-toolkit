'use strict';

/**
 * Where trunk really is on the remote (#307).
 *
 * The staleness signal used to be a calendar reading of the site's own
 * snapshot, and age is a proxy that misses in both directions: a three-day-old
 * snapshot can be dozens of commits behind in a busy week, and a two-week-old
 * one can be nearly current. This module answers the question the app was
 * actually asking — has trunk moved since this snapshot — by asking the remote
 * for one ref.
 *
 * It is a refs lookup (`git.listServerRefs`, protocol v2 `ls-refs`), not a
 * fetch: no objects are downloaded, no dependency is added, and the answer is a
 * single 40-character oid. All git I/O goes through isomorphic-git, as
 * everywhere else in this app — nothing shells out to a git binary.
 *
 * Two things this module deliberately does NOT do:
 *
 * - **It never says by how many commits.** The refs protocol carries oids, not
 *   distances; counting would mean downloading the objects between them, which
 *   is the fetch this exists to avoid. "Trunk has moved" is what can be known
 *   for free, and it is already truer than a date.
 * - **It never decides anything.** Offline, behind a proxy, rate-limited or
 *   air-gapped are all normal states for a Contributor Day laptop, and this
 *   module reports them as a rejection rather than absorbing them. Absorbing
 *   them is `refreshRemoteTrunk`'s job in src/main.js, precisely because that
 *   is where "unknown" becomes "fall back to the calendar".
 */

const git = require('isomorphic-git');
const http = require('isomorphic-git/http/node');

const TRUNK_REF = 'refs/heads/trunk';

/**
 * How long a probe's answer is trusted before another one is worth making.
 *
 * One hour, because the signal it feeds is measured in days: a contributor is
 * told trunk has moved so they update before writing a patch, and an answer
 * that is up to an hour old never changes that recommendation. It also bounds
 * the traffic: `site:status` is read on mount and again after every install,
 * build, update, apply and ticket switch, and without a stamp every one of
 * those would be a request.
 */
const REMOTE_PROBE_INTERVAL_MS = 60 * 60 * 1000;

// How long one probe may take before it is abandoned. Generous, because a slow
// answer is still a useful one and nothing is waiting on it; bounded, because a
// request that never settles is the one failure mode a captive portal produces.
const PROBE_TIMEOUT_MS = 15 * 1000;

/**
 * Whether the remote is worth asking again.
 *
 * A never-probed site (no stamp, or a stamp from an older app version that did
 * not write one) is always due. A stamp in the future is treated as due too:
 * that is a clock that moved backwards, and the alternative is a site that
 * never probes again until the stamp's hour arrives.
 *
 * @param {Object}  root0
 * @param {?string} [root0.checkedAt]  ISO stamp of the last probe attempt.
 * @param {number}  [root0.now]
 * @param {number}  [root0.intervalMs]
 * @return {boolean}
 */
function remoteProbeDue({ checkedAt, now = Date.now(), intervalMs = REMOTE_PROBE_INTERVAL_MS } = {}) {
	const last = checkedAt ? Date.parse(checkedAt) : NaN;
	if (!Number.isFinite(last)) return true;
	if (last > now) return true;
	return now - last >= intervalMs;
}

/**
 * The oid `refs/heads/trunk` points at on the remote, or null if the remote
 * answered but has no such branch.
 *
 * A remote that could not be reached rejects rather than resolving null, so the
 * caller can tell "trunk is gone" from "we could not ask" — the second is the
 * one that must leave the calendar fallback in charge. `refreshRemoteTrunk` in
 * src/main.js is where that rejection is absorbed.
 *
 * `prefix` narrows the server's answer to the one ref, so a repository with
 * tens of thousands of refs — wordpress-develop's `refs/pull/*` alone is
 * enormous — still costs one small response. It is a prefix and not an exact
 * match, though: `refs/heads/trunk-experiment` comes back under it too, which
 * is why the row is picked by full ref name rather than taken as the first.
 *
 * The deadline is not belt-and-braces. The network this app runs on is a
 * conference or café one, and the characteristic failure there is a captive
 * portal that black-holes the connection rather than refusing it —
 * `listServerRefs` has no deadline of its own, so without this a probe could
 * stay pending for the whole session while the next hour's probe starts behind
 * it.
 *
 * `listServerRefs` is injectable so the exact-ref filtering and the deadline can
 * be tested without a network, which is the house pattern for platform- and
 * environment-dependent code in this repo.
 *
 * @param {Object}   root0
 * @param {string}   root0.url              Clone URL of the remote.
 * @param {Function} [root0.listServerRefs] Seam for tests.
 * @param {number}   [root0.timeoutMs]      Deadline for the whole request.
 * @return {Promise<?string>}
 */
async function readRemoteTrunkOid({ url, listServerRefs = git.listServerRefs, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
	let timer;
	const deadline = new Promise((_resolve, reject) => {
		timer = setTimeout(() => reject(new Error(`no answer from ${url} within ${timeoutMs}ms`)), timeoutMs);
	});
	const request = listServerRefs({ http, url, prefix: TRUNK_REF });
	// The race can be decided by the deadline while the request is still in
	// flight; a rejection arriving after that has nobody left to await it, and
	// Node treats an unhandled rejection as fatal.
	request.catch(() => {});
	let refs;
	try {
		refs = await Promise.race([request, deadline]);
	} finally {
		clearTimeout(timer);
	}
	const match = (refs || []).find((r) => r && r.ref === TRUNK_REF);
	return (match && match.oid) || null;
}

module.exports = { REMOTE_PROBE_INTERVAL_MS, PROBE_TIMEOUT_MS, TRUNK_REF, remoteProbeDue, readRemoteTrunkOid };
