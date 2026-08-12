// What the app says about a ticket still sitting on the trunk it was born from
// (#305).
//
// The site moves; the ticket does not. "Update to latest trunk" parks the
// ticket, moves trunk and resets the worktree, and leaves every ticket branch
// exactly where it was — deliberately, because a ticket's diff base has to stay
// fixed. The gap that opens is invisible today, and it is the reason a
// contributor who follows every piece of staleness advice the app gives still
// watches pull requests fail to apply.
//
// Two things are said here, both pure:
//
//   - `describeCarryNote` — the ticket card's sentence. Not an alert: nothing is
//     broken yet, and a ticket that is a day behind is fine. It names the gap,
//     what it will cost, and that there is an action.
//   - `describeCarryOffer` — the offer itself, once the contributor asks. It
//     says how many files come across untouched, how many trunk has also
//     changed, and — before anything moves — which ones cannot come at all.
//
// Nothing here decides anything about the repository: the classification is
// src/ticket-carry.js's answer and arrives already made. This is the rendering
// of it, kept out of index.jsx so it can be asserted (see the invariant in
// AGENTS.md's review standard), and pure and dependency-light like
// update-plan.cjs and applied-layer.cjs.
'use strict';

const { listOf } = require('./applied-layer.cjs');

/**
 * How sure the app is that trunk has moved past this ticket.
 *
 * - `current` — the ticket is on the trunk the site has, or on a newer one.
 *               Nothing to offer.
 * - `behind`  — trunk has moved on, and the carry can be offered.
 * - `unknown` — a commit that would not read: a site adopted from disk, a
 *               registry naming an object this clone never had. Nothing is
 *               offered, and nothing is claimed either.
 *
 * Here rather than in src/ticket-carry.js for the reason BASE_STATUS lives in
 * ticket-base.cjs: the renderer bundle reads these, and it must not pull
 * `isomorphic-git` in behind them.
 */
const CARRY_STATE = {
	CURRENT: 'current',
	BEHIND: 'behind',
	UNKNOWN: 'unknown'
};

/** Why one path cannot be carried. Same list, same reason for living here. */
const REFUSAL = {
	/** Upstream deleted the file this ticket has edits in. */
	UPSTREAM_DELETED: 'upstream-deleted',
	/** Both sides created the same path. */
	ADDED_BOTH: 'added-both',
	/** The ticket deleted a file upstream has since changed. */
	DELETED_BUT_CHANGED: 'deleted-but-changed',
	/** Both sides changed the same binary file, which nothing can reconcile. */
	BINARY_CONFLICT: 'binary-conflict',
	/** The app could not read the file, so it cannot reproduce its bytes. */
	UNREADABLE: 'unreadable'
};

// Why staying behind is the worse option, said in the contributor's terms
// rather than git's. This is the whole argument for the feature and it is said
// once, here, so the card and the offer cannot drift into two versions of it.
const WHY_NOT_STAY = 'A ticket on an older trunk keeps failing to apply the patches and pull requests you came here to test, and the gap only widens.';

// The app never silently rebases anyone (#309). The offer says so out loud,
// because "bring this up to date" is otherwise indistinguishable from the
// destructive buttons next to it.
const NOTHING_MOVES_YET = 'Nothing moves until you accept, and your work stays exactly where it is if any of it cannot come across.';

/**
 * `3 files` / `1 file`.
 *
 * @param {number} n
 * @param {string} [noun]
 * @return {string}
 */
function plural(n, noun = 'file') {
	return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * The sentence one refusal reason deserves. Each is a different thing to do
 * next, which is why they are not one line with a file list appended.
 *
 * @param {string}   reason A `REFUSAL` value.
 * @param {string[]} paths
 * @return {string}
 */
function refusalSentence(reason, paths) {
	const names = listOf(paths);
	const many = paths.length > 1;
	if (reason === REFUSAL.UPSTREAM_DELETED) {
		return `Trunk has deleted ${names}, which this ticket has work in — bringing ${many ? 'them' : 'it'} forward would put back ${many ? 'files' : 'a file'} that no longer exist${many ? '' : 's'} upstream.`;
	}
	if (reason === REFUSAL.ADDED_BOTH) {
		return `${names} ${many ? 'were' : 'was'} added both by this ticket and by trunk, so there is no version of ${many ? 'them' : 'it'} to carry onto.`;
	}
	if (reason === REFUSAL.DELETED_BUT_CHANGED) {
		return `This ticket deletes ${names}, and trunk has changed ${many ? 'them' : 'it'} since — carrying the deletion forward would throw that work away.`;
	}
	if (reason === REFUSAL.BINARY_CONFLICT) {
		return `${names} ${many ? 'are' : 'is'} binary and both this ticket and trunk changed ${many ? 'them' : 'it'} — there is no way to combine the two.`;
	}
	return `${names} could not be read, so ${many ? 'their' : 'its'} contents cannot be reproduced on the new trunk.`;
}

/**
 * The refusals, grouped by reason and in a fixed order so the same set of files
 * always reads the same way.
 *
 * @param {Array<{path: string, reason: string}>} refused
 * @return {string[]}
 */
function refusalSentences(refused) {
	const order = [
		REFUSAL.UPSTREAM_DELETED,
		REFUSAL.DELETED_BUT_CHANGED,
		REFUSAL.ADDED_BOTH,
		REFUSAL.BINARY_CONFLICT,
		REFUSAL.UNREADABLE
	];
	return order
		.map((reason) => ({ reason, paths: refused.filter((entry) => entry.reason === reason).map((entry) => entry.path) }))
		.filter((group) => group.paths.length)
		.map((group) => refusalSentence(group.reason, group.paths));
}

/**
 * The ticket card's note, or null when there is nothing to say.
 *
 * Deliberately quiet. A ticket linked this morning against a trunk that moved
 * this afternoon is in perfectly good shape, and an alert there would teach the
 * contributor to ignore the one that matters. What it must not do is stay
 * silent: today the gap is invisible, and the failures it causes get blamed on
 * the pull request's author instead (#303).
 *
 * @param {Object} [root0]
 * @param {string} [root0.state] A `CARRY_STATE` value.
 * @param {string} [root0.since] Formatted date of the ticket's base, or ''.
 * @return {?{level: string, text: string, actionLabel: string}}
 */
function describeCarryNote({ state = CARRY_STATE.CURRENT, since = '' } = {}) {
	if (state !== CARRY_STATE.BEHIND) return null;
	return {
		level: 'note',
		text: `This ticket started from ${since ? `trunk as of ${since}` : 'an older trunk'}, and the site has moved on since. ${WHY_NOT_STAY}`,
		actionLabel: 'Bring this ticket up to date'
	};
}

/**
 * The offer, in full, once the contributor asks what the action would do.
 *
 * The file counts are the point of it. "Which file collided" is what a
 * patch-based carry could have said; this can say how many files come across
 * exactly as they are, how many trunk has also edited, and which one would no
 * longer take the ticket's change — before anything is touched.
 *
 * `canCarry` is false when anything is refused, and the refusals are named
 * rather than counted: each one is a different decision for the contributor.
 *
 * @param {Object}   [root0]
 * @param {string}   [root0.state]        A `CARRY_STATE` value.
 * @param {string[]} [root0.wholesale]    Paths upstream has not touched.
 * @param {string[]} [root0.merge]        Paths trunk has also changed.
 * @param {string[]} [root0.settled]      Paths trunk has already changed the same way.
 * @param {Array}    [root0.refused]      `{ path, reason }` per refusal.
 * @param {?Object}  [root0.appliedPatch] The applied layer (#306), when there is one.
 * @param {string}   [root0.since]        Formatted date of the ticket's base, or ''.
 * @return {?Object}
 */
function describeCarryOffer({ state = CARRY_STATE.CURRENT, wholesale = [], merge = [], settled = [], refused = [], appliedPatch = null, since = '' } = {}) {
	if (state !== CARRY_STATE.BEHIND) return null;

	const total = wholesale.length + merge.length + settled.length + refused.length;
	const blocked = refusalSentences(refused);
	const sentences = [];

	if (!total) {
		// The base moves and nothing else happens. Worth offering anyway: this is
		// the ticket that has been read but not edited, and leaving it behind
		// costs the contributor the next patch that will not apply.
		sentences.push(`This ticket has no work on it yet, so bringing it up to date only moves the trunk it is measured against${since ? ` — it is still on trunk as of ${since}` : ''}.`);
	} else {
		const parts = [];
		if (wholesale.length) parts.push(`${plural(wholesale.length)} come${wholesale.length === 1 ? 's' : ''} across exactly as ${wholesale.length === 1 ? 'it is' : 'they are'}`);
		if (merge.length) parts.push(`${plural(merge.length)} trunk has also changed, so your change is replayed onto ${merge.length === 1 ? 'its' : 'their'} new version`);
		// Named rather than folded into the wholesale count: trunk having already
		// done what the ticket did is a fact about the ticket's work, and a
		// contributor who deleted a file wants to know upstream deleted it too.
		if (settled.length) parts.push(`${plural(settled.length)} trunk has already removed as well, so there is nothing left to carry for ${settled.length === 1 ? 'it' : 'them'}`);
		if (parts.length) sentences.push(`Of the ${plural(total)} this ticket has work in, ${listOf(parts)}.`);
	}

	if (appliedPatch && appliedPatch.label) {
		sentences.push(appliedPatch.revertable
			? `${appliedPatch.label} is lifted out first so your own edits move on their own, then put back on top.`
			: `${appliedPatch.label} is part of your changes now, so it moves with them as one.`);
	}

	if (blocked.length) {
		sentences.push('This cannot go ahead as it stands:');
	} else {
		sentences.push(NOTHING_MOVES_YET);
	}

	return {
		canCarry: blocked.length === 0,
		headline: 'Bring this ticket up to date',
		sentences,
		blocked,
		why: WHY_NOT_STAY,
		confirmLabel: 'Bring it up to date',
		cancelLabel: 'Leave it as it is'
	};
}

module.exports = {
	CARRY_STATE,
	REFUSAL,
	WHY_NOT_STAY,
	NOTHING_MOVES_YET,
	refusalSentence,
	refusalSentences,
	describeCarryNote,
	describeCarryOffer
};
