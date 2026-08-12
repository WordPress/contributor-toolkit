// What the panel says when a patch will not apply.
//
// The refusal itself is right and stays: nothing is written, and a patch placed
// approximately is worse than no patch at all. What was wrong is everything
// after it (#282). "This file has moved on" read identically whether one region
// of twenty missed or all twenty did — opposite decisions for the contributor,
// who either spends ten minutes on a salvageable change or throws it away — and
// the panel showed only the first failing file, sending the rest to the terminal
// where nobody is looking.
//
// So this turns `applyPatchToDir`'s failure payload into something to act on:
// every failing file, how much of the patch actually missed, where, why (#226),
// and what those regions were trying to do. Plus the two ways out that need no
// data the app is not already holding — the ticket's other patches, and the pull
// request itself, where a rebase is someone else's to do.
//
// Pure and dependency-free like open-failure.cjs, and for the same reason: the
// renderer bundle imports it, `node --test` requires it directly, and neither
// needs a DOM.
'use strict';

// Why a region no longer fits, in the contributor's terms.
//
// Hedged on purpose. Matching searches for somewhere the surrounding lines fit,
// so a region whose surroundings repeat can be recognised in the wrong place —
// good enough to choose a sentence, never good enough to decide what to write.
// "Looks like" is that uncertainty, said out loud rather than buried here.
const REASONS = {
	'already-applied': 'looks like it is already in your checkout',
	moved: 'the code around it has changed'
};

/**
 * One failing region, ready to render.
 *
 * @param {Object} region
 * @return {Object}
 */
function describeRegion(region) {
	return {
		line: region.line,
		status: region.status,
		reason: REASONS[region.status] || 'it no longer fits',
		// A line to search for, not a number to go to: the hunk's line numbers
		// are in the patched file's coordinates and miss by the drift the patch
		// failed on. The panel leads with this and keeps `line` as the fallback.
		anchor: region.anchor || '',
		lines: region.lines || [],
		more: region.more || 0
	};
}

/**
 * The headline: how much of the patch missed, across every file.
 *
 * Counts, not adjectives. "2 of 20" is the whole point — it is what separates a
 * patch worth rescuing by hand from one that is genuinely dead.
 *
 * The already-applied case gets its own sentences: a patch whose changes are
 * all in the tree already fails every region, and "none of its changes still
 * fit" over rows saying "already in your checkout" would be the banner
 * contradicting itself — with the headline, the half that decides whether the
 * patch gets thrown away, telling the wrong story.
 *
 * @param {Array} conflicts
 * @return {string}
 */
function headlineFor(conflicts) {
	const failed = conflicts.reduce((sum, c) => sum + c.regions.length, 0);
	const total = conflicts.reduce((sum, c) => sum + c.total, 0);
	const changes = `change${total === 1 ? '' : 's'}`;
	const where = conflicts.length === 1 ? '' : ` across ${conflicts.length} files`;
	const allApplied = conflicts.every((c) => c.regions.every((r) => r.status === 'already-applied'));

	if (allApplied) {
		if (failed === total) {
			return `All ${total} of this patch's ${changes}${where} look like they are already in your checkout.`;
		}
		return `${failed} of this patch's ${total} ${changes}${where} look like they are already in your checkout — the other ${total - failed} still fit.`;
	}
	if (failed === total) {
		return `None of this patch's ${total} ${changes}${where} still fit your checkout.`;
	}
	return `${failed} of this patch's ${total} ${changes}${where} no longer fit — the other ${total - failed} do.`;
}

/**
 * How many other patches the ticket is offering besides the one that failed.
 *
 * The answer decides whether "try another patch" is a way out or a click back
 * to the same dead end, so only what is already on screen counts — Trac
 * attachments load on demand and are genuinely not there until asked for.
 * Matching is by the preview's label on both lists: a failed PR is labelled
 * `PR #n`, a failed attachment (or the same file picked from disk) by its
 * filename.
 *
 * @param {Object}  root0
 * @param {?string} root0.label         The failed preview's label.
 * @param {Array}   [root0.prs]         The ticket's linked pull requests.
 * @param {Array}   [root0.attachments] The ticket's loaded patch attachments.
 * @return {number}
 */
function otherPatchCount({ label, prs = [], attachments = [] } = {}) {
	const failedLabel = label || '';
	return prs.filter((pr) => `PR #${pr.number}` !== failedLabel).length
		+ attachments.filter((att) => att.filename !== failedLabel).length;
}

/**
 * The pull-request framing: whose problem this is, and how big.
 *
 * The regions belong to whoever updates the pull request, and that is its
 * author, not the contributor reading this notice — showing them line-level
 * detail invites them into work that is not theirs. What they need instead is
 * the situation named (the PR is behind trunk), the scale (files and places),
 * and the one act that is genuinely theirs: telling the author.
 *
 * "No longer fits today's trunk" rather than "has conflicts": the app matches
 * without the pull request's base, so its count can include a region a real
 * merge would settle — close enough to size the problem, not a claim GitHub
 * will show the identical number.
 *
 * @param {Array} conflicts
 * @return {{headline: string, advice: string}}
 */
function prFraming(conflicts) {
	const failed = conflicts.reduce((sum, c) => sum + c.regions.length, 0);
	const total = conflicts.reduce((sum, c) => sum + c.total, 0);
	const allApplied = conflicts.every((c) => c.regions.every((r) => r.status === 'already-applied'));

	// A pull request whose changes are all in trunk already needs no rebase and
	// no message — there is nothing left for anyone to do with it.
	if (allApplied && failed === total) {
		return {
			headline: `All ${total} of this pull request's change${total === 1 ? '' : 's'} look like they are already in trunk — there is nothing left to apply.`,
			advice: ''
		};
	}

	const files = conflicts.length;
	const scale = `${failed} of its ${total} change${total === 1 ? '' : 's'}, in ${files} file${files === 1 ? '' : 's'},`;
	return {
		headline: `This pull request was written against an older trunk and no longer fits it: ${scale} would need rework.`,
		advice: 'Bringing it up to date is its author\'s work — a rebase, or merging trunk in. Leaving a comment on the pull request to let them know is a real contribution in itself.'
	};
}

/**
 * Everything the panel needs to explain a failed apply, or null when there is
 * nothing to explain.
 *
 * Two framings, chosen by where the patch came from. A pull request has an
 * author who is the one to fix it, so the notice names the situation and the
 * scale and points at them — no line-level detail. A loose patch (a Trac
 * attachment, a file from disk) has nobody to send the contributor to, so it
 * keeps the full per-region breakdown: there, the contributor with the failing
 * lines in hand is the only way out.
 *
 * `items` follows the order of `failures` so that a patch failing for mixed
 * reasons — one file with drifted regions, another simply not in the checkout —
 * reads as one list rather than two. Failures with no region detail keep their
 * own sentence; that covers every non-conflict refusal (a path escaping the
 * folder, a file to add that already exists) as well as the conflict that could
 * not be broken down.
 *
 * @param {Object}  result                    The apply payload from main.
 * @param {Object}  [options]
 * @param {number}  [options.otherPatchCount] Other patches on this ticket.
 * @param {?string} [options.prUrl]           The failing patch's pull request.
 * @return {?Object}
 */
function describeApplyFailure(result, { otherPatchCount: othersAvailable = 0, prUrl = null } = {}) {
	if (!result || result.ok) return null;

	const failures = Array.isArray(result.failures) ? result.failures : [];
	const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
	// Nothing structured to add: a parse failure, a write that was rolled back,
	// a refusal from main. The single sentence is already the whole story, and
	// the panel keeps rendering it exactly as it did before.
	if (!failures.length && !conflicts.length) return null;

	const fromPr = Boolean(prUrl);

	// Each conflict is consumed as it is matched, not looked up in a map: a
	// concatenated patch can fail the same file twice with the identical
	// sentence, and a map would show one breakdown twice while dropping the
	// other from the counts.
	const unmatched = [...conflicts];
	const sentences = failures.length ? failures : conflicts.map((c) => c.error);
	const items = sentences.map((text) => {
		const at = unmatched.findIndex((c) => c.error === text);
		const conflict = at === -1 ? null : unmatched.splice(at, 1)[0];
		if (!conflict) return { kind: 'note', text };
		return {
			kind: 'conflict',
			path: conflict.path,
			total: conflict.total,
			failed: conflict.regions.length,
			// For a pull request the regions are the author's problem; the file
			// row with its counts is the whole story the contributor needs.
			regions: fromPr ? [] : conflict.regions.map(describeRegion)
		};
	});

	// With no conflicts to count there is nothing to summarise that the items
	// do not already say, so the headline stands down rather than padding.
	let headline = '';
	let advice = '';
	if (conflicts.length) {
		const framing = fromPr ? prFraming(conflicts) : { headline: headlineFor(conflicts), advice: '' };
		headline = framing.headline;
		advice = framing.advice;
	}
	return {
		headline,
		advice,
		items,
		// Both are offered only when they lead somewhere, the way open-failure.cjs
		// withholds its picker: a way out that returns to the same dead end is
		// worse than no button, because it costs a click to find that out.
		offerOtherPatches: othersAvailable > 0,
		prUrl: prUrl || null
	};
}

module.exports = { describeApplyFailure, headlineFor, otherPatchCount, REASONS };
