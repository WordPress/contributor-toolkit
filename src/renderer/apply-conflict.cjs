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

const { __, _n, sprintf } = require('@wordpress/i18n');

// Why a region no longer fits, in the contributor's terms.
//
// Hedged on purpose. Matching searches for somewhere the surrounding lines fit,
// so a region whose surroundings repeat can be recognised in the wrong place —
// good enough to choose a sentence, never good enough to decide what to write.
// "Looks like" is that uncertainty, said out loud rather than buried here.
//
// Functions rather than constants, so that each is translated when it is shown.
function reasons() {
	return {
		'already-applied': __('looks like it is already in your checkout'),
		moved: __('the code around it has changed')
	};
}

// The same two statuses read backwards, for a revert (#306). `already-applied`
// is derived by testing the inverse of what is being applied, so on a reverse it
// means the *forward* hunk fits — that region's change is not in the checkout
// any more. Rendering the forward wording there would put "already in your
// checkout" under a headline saying the contributor has edited over it.
function revertReasons() {
	return {
		'already-applied': __('looks like that change is not in your checkout any more'),
		moved: __('the code around it has changed')
	};
}

/**
 * One failing region, ready to render.
 *
 * @param {Object}  region
 * @param {boolean} [reversing] Whether the failed run was a revert.
 * @return {Object}
 */
function describeRegion(region, reversing = false) {
	const reasonFor = reversing ? revertReasons() : reasons();
	return {
		line: region.line,
		status: region.status,
		reason: reasonFor[region.status] || __('it no longer fits'),
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
	const files = conflicts.length;
	const allApplied = conflicts.every((c) => c.regions.every((r) => r.status === 'already-applied'));

	// The plural follows the number of changes, so a sentence that also says
	// how many files is written apart from the one that does not.
	if (allApplied) {
		if (failed === total) {
			if (files === 1) {
				// translators: %d: how many changes the patch has.
				return sprintf(_n('All %d of this patch\'s change look like they are already in your checkout.', 'All %d of this patch\'s changes look like they are already in your checkout.', total), total);
			}
			// translators: 1: how many changes the patch has. 2: how many files they are in, always more than one.
			return sprintf(_n('All %1$d of this patch\'s change across %2$d files look like they are already in your checkout.', 'All %1$d of this patch\'s changes across %2$d files look like they are already in your checkout.', total), total, files);
		}
		if (files === 1) {
			// translators: 1: how many of the patch's changes are already in the checkout. 2: how many changes the patch has. 3: how many of them still fit.
			return sprintf(_n('%1$d of this patch\'s %2$d change look like they are already in your checkout — the other %3$d still fit.', '%1$d of this patch\'s %2$d changes look like they are already in your checkout — the other %3$d still fit.', total), failed, total, total - failed);
		}
		// translators: 1: how many of the patch's changes are already in the checkout. 2: how many changes the patch has. 3: how many files they are in, always more than one. 4: how many of them still fit.
		return sprintf(_n('%1$d of this patch\'s %2$d change across %3$d files look like they are already in your checkout — the other %4$d still fit.', '%1$d of this patch\'s %2$d changes across %3$d files look like they are already in your checkout — the other %4$d still fit.', total), failed, total, files, total - failed);
	}
	if (failed === total) {
		if (files === 1) {
			// translators: %d: how many changes the patch has.
			return sprintf(_n('None of this patch\'s %d change still fit your checkout.', 'None of this patch\'s %d changes still fit your checkout.', total), total);
		}
		// translators: 1: how many changes the patch has. 2: how many files they are in, always more than one.
		return sprintf(_n('None of this patch\'s %1$d change across %2$d files still fit your checkout.', 'None of this patch\'s %1$d changes across %2$d files still fit your checkout.', total), total, files);
	}
	if (files === 1) {
		// translators: 1: how many of the patch's changes no longer fit. 2: how many changes the patch has. 3: how many of them still fit.
		return sprintf(_n('%1$d of this patch\'s %2$d change no longer fit — the other %3$d do.', '%1$d of this patch\'s %2$d changes no longer fit — the other %3$d do.', total), failed, total, total - failed);
	}
	// translators: 1: how many of the patch's changes no longer fit. 2: how many changes the patch has. 3: how many files they are in, always more than one. 4: how many of them still fit.
	return sprintf(_n('%1$d of this patch\'s %2$d change across %3$d files no longer fit — the other %4$d do.', '%1$d of this patch\'s %2$d changes across %3$d files no longer fit — the other %4$d do.', total), failed, total, files, total - failed);
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

// How many paths a sentence will name before it starts counting instead. The
// panel already lists every failing file underneath, so the headline's job is
// the attribution, not the inventory — and a pull request failing in a dozen
// files would otherwise open the notice with a paragraph of paths. Same reason
// `REGION_DETAIL_LIMIT` exists in patch-apply.js.
const PATH_NAME_LIMIT = 3;

/**
 * The files on one side of the failure, named for a sentence.
 *
 * Deduplicated because a concatenated patch can fail the same file twice — the
 * same reason `describeApplyFailure` consumes conflicts one by one instead of
 * keying them by path.
 *
 * @param {Array} rows Conflicts.
 * @return {{count: number, text: string}}
 */
function namePaths(rows) {
	const paths = [...new Set(rows.map((c) => c.path))];
	if (paths.length <= PATH_NAME_LIMIT) return { count: paths.length, text: paths.join(', ') };
	const rest = paths.length - PATH_NAME_LIMIT;
	return {
		count: paths.length,
		text: sprintf(
			// translators: 1: up to three file paths, separated by commas. 2: how many more files there are.
			_n('%1$s and %2$d more file', '%1$s and %2$d more files', rest),
			paths.slice(0, PATH_NAME_LIMIT).join(', '),
			rest
		)
	};
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
 * The pull request's state changes who that act is for. Asking a closed pull
 * request's author for a rebase asks for work on something they walked away
 * from — and in wordpress-develop "closed" is also what *landing* looks like,
 * since core commits go through SVN and the pull request is closed, never
 * merged. The regions tell those apart: a landed change reads back as already
 * in the checkout, an abandoned one as moved.
 *
 * "No longer fits today's trunk" rather than "has conflicts": the app matches
 * without the pull request's base, so its count can include a region a real
 * merge would settle — close enough to size the problem, not a claim GitHub
 * will show the identical number.
 *
 * That same missing base is why `ownWorkPaths` is here (#303). Matching two-way
 * cannot prove which side a single failed region belongs to, so the framing used
 * to answer from the pull request's state alone: open meant stale, always. On a
 * ticket someone has come back to, the ordinary reason a change will not fit is
 * the contributor's own work sitting in the same file — and sending them to ask
 * a stranger for a rebase that would not help is worse than saying nothing.
 *
 * The app cannot prove the region, but it knows the file: `ownWorkPaths` is the
 * preview's own collision list, the files this ticket has work in measured from
 * its base (#301). That is evidence the contributor's work may be involved, not
 * proof it caused the failed region. The safe route is to try the pull request
 * on a clean ticket before asking its author to update it.
 *
 * @param {Array}    conflicts
 * @param {?string}  prState        'open' | 'merged' | 'closed' | null when unknown.
 * @param {string[]} [ownWorkPaths] Files this ticket has its own work in.
 * @param {?Object}  [appliedPatch] Named layer whose files are part of that work.
 * @return {{headline: string, advice: string, prButton: ?string}}
 */
function prFraming(conflicts, prState, ownWorkPaths = [], appliedPatch = null) {
	const failed = conflicts.reduce((sum, c) => sum + c.regions.length, 0);
	const total = conflicts.reduce((sum, c) => sum + c.total, 0);
	const allApplied = conflicts.every((c) => c.regions.every((r) => r.status === 'already-applied'));
	const closed = prState === 'closed' || prState === 'merged';
	const ticketWork = new Set(ownWorkPaths);
	const alreadyPresentInTicketWork = conflicts.some((c) => ticketWork.has(c.path));

	// A pull request whose changes are all in trunk already needs no rebase and
	// no message — there is nothing left for anyone to do with it. When it is
	// also closed, that is core's own way of landing a change: committed via
	// SVN, pull request closed.
	if (allApplied && failed === total) {
		// Two-way matching only proves that these lines are in the checkout. If
		// the ticket also has work in the file, they may come from that work or
		// its named layer; claiming trunk would erase the provenance (#306).
		if (alreadyPresentInTicketWork) {
			return {
				// translators: %d: how many changes the pull request has.
				headline: sprintf(_n('All %d of this pull request\'s change look like they are already in your checkout — there is nothing left to apply.', 'All %d of this pull request\'s changes look like they are already in your checkout — there is nothing left to apply.', total), total),
				advice: '',
				prButton: __('Open the pull request')
			};
		}
		if (closed) {
			return {
				// translators: %d: how many changes the pull request has.
				headline: sprintf(_n('All %d of this pull request\'s change look like they are already in trunk — it was likely committed to core, which is why it is closed. There is nothing left to apply.', 'All %d of this pull request\'s changes look like they are already in trunk — it was likely committed to core, which is why it is closed. There is nothing left to apply.', total), total),
				advice: '',
				prButton: null
			};
		}
		return {
			// translators: %d: how many changes the pull request has.
			headline: sprintf(_n('All %d of this pull request\'s change look like they are already in trunk — there is nothing left to apply.', 'All %d of this pull request\'s changes look like they are already in trunk — there is nothing left to apply.', total), total),
			advice: '',
			prButton: null
		};
	}

	// Distinct files, not conflict rows: a concatenated patch can fail the same
	// file twice, and the sentences below go on to name the files, so counting
	// the rows would have the count disagreeing with the list beside it.
	const files = new Set(conflicts.map((c) => c.path)).size;

	// A closed pull request has no author coming back to it: asking for a
	// rebase would be a message into the void. The way forward is the ticket —
	// another patch, or redoing the change, which is a contribution in itself.
	if (closed) {
		let headline;
		if (files === 1) {
			// translators: 1: how many of the pull request's changes no longer fit. 2: how many changes it has. 3: how many files they are in, which is 1.
			headline = sprintf(_n('This pull request is closed and was written against an older trunk — it no longer fits: %1$d of its %2$d change, in %3$d file, would need rework.', 'This pull request is closed and was written against an older trunk — it no longer fits: %1$d of its %2$d changes, in %3$d file, would need rework.', total), failed, total, files);
		} else {
			// translators: 1: how many of the pull request's changes no longer fit. 2: how many changes it has. 3: how many files they are in, always more than one.
			headline = sprintf(_n('This pull request is closed and was written against an older trunk — it no longer fits: %1$d of its %2$d change, in %3$d files, would need rework.', 'This pull request is closed and was written against an older trunk — it no longer fits: %1$d of its %2$d changes, in %3$d files, would need rework.', total), failed, total, files);
		}
		return {
			headline,
			advice: __('Nobody is coming back to update a closed pull request — its discussion may say why it ended.'),
			prButton: __('See why it was closed')
		};
	}

	const own = new Set(ownWorkPaths);
	const layerFiles = new Set(appliedPatch && Array.isArray(appliedPatch.files) ? appliedPatch.files : []);
	const layered = namePaths(conflicts.filter((c) => own.has(c.path) && layerFiles.has(c.path)));
	const mine = namePaths(conflicts.filter((c) => own.has(c.path) && !layerFiles.has(c.path)));
	const theirs = namePaths(conflicts.filter((c) => !own.has(c.path)));
	// The first sentence of each headline below where the contributor's own
	// work is involved; what follows it differs by whose files failed.
	const doesNotFit = () => {
		if (files === 1) {
			// translators: 1: how many of the pull request's changes no longer fit. 2: how many changes it has. 3: how many files they are in, which is 1.
			return sprintf(_n('This pull request does not fit your checkout: %1$d of its %2$d change, in %3$d file, would need rework.', 'This pull request does not fit your checkout: %1$d of its %2$d changes, in %3$d file, would need rework.', total), failed, total, files);
		}
		// translators: 1: how many of the pull request's changes no longer fit. 2: how many changes it has. 3: how many files they are in, always more than one.
		return sprintf(_n('This pull request does not fit your checkout: %1$d of its %2$d change, in %3$d files, would need rework.', 'This pull request does not fit your checkout: %1$d of its %2$d changes, in %3$d files, would need rework.', total), failed, total, files);
	};
	// A ticket's changes are cheap to redo and expensive to untangle, so keeping
	// a copy and starting clean is a recommended way forward here, not a defeat.
	// What must never happen is work going quietly; going on purpose, with the
	// copy already saved, is a good outcome.
	const yourWorkWayOut = () => __('Save a patch of your work first to keep a copy, then try this pull request on a clean ticket. If it still does not fit there, open the pull request and let its author know it may need updating.');
	// translators: %s: one or more file paths, separated by commas.
	const mineToo = () => sprintf(__('Your own work is also in %s and may be part of the failure.'), mine.text);
	// translators: %s: one or more file paths, separated by commas.
	const otherFailures = () => sprintf(__('Other failures are in %s.'), theirs.text);

	// The ticket-base scan sees the named layer as ticket work too. It cannot
	// prove whether the contributor edited those files afterwards, so name the
	// provenance and preserve the same uncertainty as the preview (#306).
	if (layered.count) {
		const parts = [];
		if (appliedPatch.label) {
			// translators: 1: one or more file paths, separated by commas. 2: the name of the patch applied to the checkout, such as a file name.
			parts.push(sprintf(_n('%1$s includes changes from %2$s and may also contain your own edits.', '%1$s include changes from %2$s and may also contain your own edits.', layered.count), layered.text, appliedPatch.label));
		} else {
			// translators: %s: one or more file paths, separated by commas.
			parts.push(sprintf(_n('%s includes changes from the patch you applied and may also contain your own edits.', '%s include changes from the patch you applied and may also contain your own edits.', layered.count), layered.text));
		}
		if (mine.count) parts.push(mineToo());
		if (theirs.count) parts.push(otherFailures());
		return {
			headline: [doesNotFit(), ...parts].join(' '),
			advice: yourWorkWayOut(),
			prButton: __('Open the pull request')
		};
	}

	// File overlap cannot identify the failing region. Keep the pull request
	// reachable, but make the rebase advice conditional on it also failing in a
	// clean ticket.
	if (!theirs.count) {
		return {
			// translators: %s: one or more file paths, separated by commas.
			headline: [doesNotFit(), sprintf(__('Your own work is also in %s, so it may be part of why the pull request does not fit.'), mine.text)].join(' '),
			advice: yourWorkWayOut(),
			prButton: __('Open the pull request')
		};
	}

	if (mine.count) {
		return {
			headline: [doesNotFit(), mineToo(), otherFailures()].join(' '),
			advice: yourWorkWayOut(),
			prButton: __('Open the pull request')
		};
	}

	let headline;
	if (files === 1) {
		// translators: 1: how many of the pull request's changes no longer fit. 2: how many changes it has. 3: how many files they are in, which is 1.
		headline = sprintf(_n('This pull request was written against an older trunk and no longer fits it: %1$d of its %2$d change, in %3$d file, would need rework.', 'This pull request was written against an older trunk and no longer fits it: %1$d of its %2$d changes, in %3$d file, would need rework.', total), failed, total, files);
	} else {
		// translators: 1: how many of the pull request's changes no longer fit. 2: how many changes it has. 3: how many files they are in, always more than one.
		headline = sprintf(_n('This pull request was written against an older trunk and no longer fits it: %1$d of its %2$d change, in %3$d files, would need rework.', 'This pull request was written against an older trunk and no longer fits it: %1$d of its %2$d changes, in %3$d files, would need rework.', total), failed, total, files);
	}
	return {
		headline,
		advice: __('Bringing it up to date is its author\'s work — a rebase, or merging trunk in. Leaving a comment on the pull request to let them know is a real contribution in itself.'),
		prButton: __('Ask its author for a rebase')
	};
}

/**
 * The framing for a revert that would not come back out (#306).
 *
 * A revert fails for one reason: the contributor's own edits are on the lines
 * the patch brought. There is no third party here and no rebase to ask anyone
 * for — the patch and the edits are one body of work now, which is what
 * absorption means. So the sentence names that, and the two ways forward are
 * undoing the overlapping edits, or saving a copy and discarding the ticket to
 * its base, which on this project is a normal step rather than a defeat.
 *
 * Regions are kept, unlike the pull-request framing: these lines are the
 * contributor's own, so pointing at them is pointing at their work.
 *
 * @param {Array}  conflicts
 * @param {string} label     The patch's name, or '' when it has none.
 * @return {{headline: string, advice: string, prButton: ?string}}
 */
function revertFraming(conflicts, label) {
	const failed = conflicts.reduce((sum, c) => sum + c.regions.length, 0);
	const total = conflicts.reduce((sum, c) => sum + c.total, 0);
	const files = conflicts.length;
	let headline;
	if (label && files === 1) {
		// translators: 1: the name of the applied patch, such as a file name. 2: how many of its changes have the contributor's edits on them. 3: how many changes it has.
		headline = sprintf(_n('%1$s cannot be lifted back out on its own: your own edits are on %2$d of its %3$d change.', '%1$s cannot be lifted back out on its own: your own edits are on %2$d of its %3$d changes.', total), label, failed, total);
	} else if (label) {
		// translators: 1: the name of the applied patch, such as a file name. 2: how many of its changes have the contributor's edits on them. 3: how many changes it has. 4: how many files they are in, always more than one.
		headline = sprintf(_n('%1$s cannot be lifted back out on its own: your own edits are on %2$d of its %3$d change, across %4$d files.', '%1$s cannot be lifted back out on its own: your own edits are on %2$d of its %3$d changes, across %4$d files.', total), label, failed, total, files);
	} else if (files === 1) {
		// translators: 1: how many of the patch's changes have the contributor's edits on them. 2: how many changes it has.
		headline = sprintf(_n('That patch cannot be lifted back out on its own: your own edits are on %1$d of its %2$d change.', 'That patch cannot be lifted back out on its own: your own edits are on %1$d of its %2$d changes.', total), failed, total);
	} else {
		// translators: 1: how many of the patch's changes have the contributor's edits on them. 2: how many changes it has. 3: how many files they are in, always more than one.
		headline = sprintf(_n('That patch cannot be lifted back out on its own: your own edits are on %1$d of its %2$d change, across %3$d files.', 'That patch cannot be lifted back out on its own: your own edits are on %1$d of its %2$d changes, across %3$d files.', total), failed, total, files);
	}

	return {
		headline,
		advice: __('It is part of your changes now. Undoing your edits on those lines brings Revert back; otherwise save a copy of your work and discard the ticket to its base — on this project that is a normal way forward, not a lost afternoon.'),
		prButton: null
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
 * @param {Object}   result                    The apply payload from main.
 * @param {Object}   [options]
 * @param {number}   [options.otherPatchCount] Other patches on this ticket.
 * @param {?string}  [options.prUrl]           The failing patch's pull request.
 * @param {?string}  [options.prState]         Its state, when known.
 * @param {string[]} [options.ownWorkPaths]    Files this ticket has work in, from
 *                                             the preview's collision list (#303).
 * @param {?Object}  [options.appliedPatch]    Named layer within that work (#306).
 * @param {?string}  [options.reverting]       Label of the layer being reverted, '' when it has none; null when this was not a revert.
 * @return {?Object}
 */
function describeApplyFailure(result, { otherPatchCount: othersAvailable = 0, prUrl = null, prState = null, ownWorkPaths = [], appliedPatch = null, reverting = null } = {}) {
	if (!result || result.ok) return null;

	const failures = Array.isArray(result.failures) ? result.failures : [];
	const conflicts = Array.isArray(result.conflicts) ? result.conflicts : [];
	// Nothing structured to add: a parse failure, a write that was rolled back,
	// a refusal from main. The single sentence is already the whole story, and
	// the panel keeps rendering it exactly as it did before.
	if (!failures.length && !conflicts.length) return null;

	// A revert is never "someone else's patch does not fit": it is the
	// contributor's own edits sitting on lines they applied. The pull-request
	// framing would send them to an author who has nothing to do with it.
	const isRevert = typeof reverting === 'string';
	const fromPr = Boolean(prUrl) && !isRevert;

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
			regions: fromPr ? [] : conflict.regions.map((region) => describeRegion(region, isRevert))
		};
	});

	// With no conflicts to count there is nothing to summarise that the items
	// do not already say, so the headline stands down rather than padding.
	let headline = '';
	let advice = '';
	let prButton = fromPr ? __('Open the pull request') : null;
	if (conflicts.length) {
		// A failed revert is never the pull request having gone stale, so it is
		// asked first: the only thing that stops a layer coming back out is the
		// contributor's own work sitting on its lines (#306).
		let framing;
		if (isRevert) framing = revertFraming(conflicts, reverting);
		else if (fromPr) framing = prFraming(conflicts, prState, ownWorkPaths, appliedPatch);
		else framing = { headline: headlineFor(conflicts), advice: '', prButton: null };
		headline = framing.headline;
		advice = framing.advice;
		prButton = framing.prButton;
	}
	return {
		headline,
		advice,
		items,
		// The safe exit, for the panel to offer alongside the sentence. Only
		// a revert has one: every other failure left the checkout untouched, so
		// there is nothing to save a copy of that is not already safe.
		offerDiscardToBase: isRevert && conflicts.length > 0,
		// Both are offered only when they lead somewhere, the way open-failure.cjs
		// withholds its picker: a way out that returns to the same dead end is
		// worse than no button, because it costs a click to find that out.
		offerOtherPatches: !isRevert && othersAvailable > 0,
		prUrl: prUrl && prButton ? prUrl : null,
		prButton
	};
}

module.exports = { describeApplyFailure, headlineFor, otherPatchCount, revertFraming, reasons, revertReasons };
