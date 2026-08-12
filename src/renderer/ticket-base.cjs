// How much the app actually knows about the trunk a ticket started from, and
// what it is allowed to say once it knows that (#308).
//
// A ticket's base is the measurement everything in the patch flow rests on:
// what counts as the contributor's own work, what a generated patch contains,
// which files the pre-apply warning names (#301). It used to come back as an
// oid or `null`, which folded four situations into two answers — and both of
// the folds were silent:
//
// - a branch with no recorded base got today's `trunk` substituted for it, and
//   "Update to latest trunk" has very likely moved that past where the branch
//   was really born, so the ticket was measured against a base it never had;
// - anything that threw while reading it came back as `null`, which every
//   caller reads as "this site is on trunk" — sending the measurement back to
//   HEAD, the exact reading #301 exists to remove.
//
// So the status is the answer, and the oid rides along with it. `unrecorded`
// still measures against today's trunk, because there is nothing better to
// measure against, but wherever that answer reaches the contributor it is
// qualified rather than stated. `unreadable` measures nothing at all.
//
// Pure and dependency-free like open-failure.cjs, and for the same reasons: the
// renderer bundle imports it, `node --test` requires it directly, the main
// process requires it for the statuses and the failure copy, and none of the
// three needs a DOM.
'use strict';

/**
 * The four answers to "where did this ticket start".
 *
 * - `trunk`      — nothing is checked out but trunk, so there is no branch
 *                  point; callers fall back to HEAD, as they always have.
 * - `recorded`   — the app wrote the branch point down when it created the
 *                  branch. This is the healthy path and the only exact one.
 * - `unrecorded` — a ticket branch with no recorded base: a registry edited by
 *                  hand, a site adopted from disk, a branch the contributor
 *                  made in their own git client. Measured against today's
 *                  trunk, and said to be approximate.
 * - `unreadable` — the read itself failed. Not the same as "on trunk", and it
 *                  must not resolve to it.
 */
const BASE_STATUS = {
	TRUNK: 'trunk',
	RECORDED: 'recorded',
	UNRECORDED: 'unrecorded',
	UNREADABLE: 'unreadable'
};

/**
 * Whether a base is exact enough to speak about without hedging. Trunk counts:
 * there is no ticket to be wrong about.
 *
 * @param {?string} status A `BASE_STATUS` value.
 * @return {boolean}
 */
function baseIsApproximate(status) {
	return status === BASE_STATUS.UNRECORDED;
}

/**
 * What the app says when it could not read the base at all.
 *
 * One shape, several consequences, because the consequence is the half that
 * differs per surface and the half the contributor acts on: a preview that was
 * not shown is a different next step from a patch that was not created. The
 * failure is honest rather than fail-open — measuring against HEAD instead
 * would answer the wrong question in the same voice as the right one.
 *
 * It says "which trunk", not "which trunk this ticket started from": the read
 * that failed can be the branch itself, so this is also what a site with no
 * ticket at all says when its folder has been moved or deleted, and naming a
 * ticket there would point at something the contributor never linked.
 *
 * @param {string} consequence What did not happen, as a clause.
 * @return {string}
 */
function baseUnreadableMessage(consequence) {
	return `Could not work out which trunk to compare your work against, so ${consequence}.`;
}

// The warning as it has always read on a site with a recorded base. Kept whole
// and unhedged: that path is exact, and softening it would teach contributors
// to skim the one warning that is never wrong.
function recordedWarning(conflicts) {
	return `You have your own edits to ${conflicts.join(', ')}. The patch is applied on top of them: it succeeds if the changes do not overlap, and fails without touching anything if they do. Save a patch of your work first if you want a copy.`;
}

// The same warning with its uncertainty said out loud. The hedge comes first
// because it changes what the list means: these are files that differ from
// today's trunk, which on a branch born before the last update includes files
// trunk itself moved on, not the contributor.
function unrecordedWarning(conflicts) {
	return `${conflicts.join(', ')} may hold your own edits. This ticket has no record of the trunk it started from, so your work was compared against today's trunk instead — that can name files you never touched, and miss ones you did. The patch is applied on top of whatever is there: it succeeds if the changes do not overlap, and fails without touching anything if they do. Save a patch of your work first if you want a copy.`;
}

// Nothing collided, but on an approximate base "nothing collided" is not a
// promise the app can make. Said quietly rather than as an alert: there is no
// problem here yet, only a check that was less than exact.
const UNRECORDED_CLEAR_NOTE = 'This ticket has no record of the trunk it started from, so the check for your own edits was made against today\'s trunk and is approximate.';

/**
 * What the apply preview says about the contributor's own work, or null when
 * there is nothing to say.
 *
 * `level` picks the styling and whether it is announced: `warning` is the amber
 * block that has always been there, `note` is a quiet line that exists only to
 * stop an approximate silence from reading as a clean bill of health.
 *
 * @param {Object}   [root0]
 * @param {string[]} [root0.conflicts]  Files the patch touches that the ticket has work in.
 * @param {?string}  [root0.baseStatus] A `BASE_STATUS` value; anything else is treated as exact.
 * @return {?{level: 'warning'|'note', text: string}}
 */
function describeOwnWorkWarning({ conflicts = [], baseStatus = BASE_STATUS.RECORDED } = {}) {
	const files = Array.isArray(conflicts) ? conflicts.filter(Boolean) : [];
	if (!baseIsApproximate(baseStatus)) {
		return files.length ? { level: 'warning', text: recordedWarning(files) } : null;
	}
	return files.length
		? { level: 'warning', text: unrecordedWarning(files) }
		: { level: 'note', text: UNRECORDED_CLEAR_NOTE };
}

module.exports = {
	BASE_STATUS,
	UNRECORDED_CLEAR_NOTE,
	baseIsApproximate,
	baseUnreadableMessage,
	describeOwnWorkWarning
};
