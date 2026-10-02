// What the apply card says (#557): the card a pull request or a patch file is
// brought into the checkout from, the dialog that shows what one would change
// before it is applied, and the notices that say what is applied now. The
// components draw; what they draw that is this card's own is decided here.
//
// Much of what the card shows is still written elsewhere and passed through
// as it is: what a pull request's preview and banner say (pr-checkout.cjs,
// watch-activity.cjs), what an applied patch says (applied-layer.cjs), why a
// patch did not fit (apply-conflict.cjs) and the steps of an apply
// (update-plan.cjs). Those are not translated yet. What is here is.
'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');

/**
 * The card's own words. A project that takes patch files (Core) is offered
 * both ways in; one that does not (Gutenberg) is offered pull requests only,
 * and is worded for that.
 *
 * @param {boolean} patchFiles Whether the project takes .diff and .patch files.
 * @return {Object} The words, by what they are for.
 */
function applyCardWords(patchFiles) {
	const shared = {
		prLabel: __('Pull request URL or number'),
		prAction: __('Apply PR'),
		prHelp: __('A pull request is checked out with its author’s commits.')
	};
	if (!patchFiles) {
		return {
			...shared,
			title: __('Check out a pull request'),
			description: __('Test a pull request in this checkout. Your own changes are preserved.')
		};
	}
	return {
		...shared,
		title: __('Apply a patch or PR'),
		description: __('Test changes in this checkout. Your own changes are preserved.'),
		prTab: __('Pull request'),
		fileTab: __('Diff'),
		fileLabel: __('Patch file'),
		fileAction: __('Choose a .diff or .patch file…'),
		fileHelp: __('A .diff or .patch file is applied to the current branch as a removable layer.')
	};
}

/**
 * What the preview's dialog says of a patch before it is applied: its title,
 * the sentence under it, what the button does, and the notes that change
 * what applying it means.
 *
 * A pull request's sentence, its button and two of its notes come from
 * `describePrPreview`, which knows whether the site already has a copy of it
 * and whether that copy has moved. A patch file's are written here.
 *
 * @param {Object} root0
 * @param {Object} [root0.preview] What the main process read: `{ kind, label, number, paths, unsupported, needsInstall }`.
 * @param {Object} [root0.pr]      What `describePrPreview` said, for a pull request; null for a patch file.
 * @return {{title: string, headline: string, action: string, closedNote: string, skipped: string, installNote: string}|null} Null with nothing to preview.
 */
function previewWords({ preview = null, pr = null } = {}) {
	if (!preview) return null;
	const paths = Array.isArray(preview.paths) ? preview.paths : [];
	if (pr) {
		return {
			// translators: %d: the number of a pull request.
			title: sprintf(__('Apply PR #%d'), preview.number),
			headline: pr.headline,
			action: pr.actionLabel,
			closedNote: pr.closedNote || '',
			skipped: '',
			installNote: pr.installNote || ''
		};
	}
	const unsupported = Array.isArray(preview.unsupported) ? preview.unsupported : [];
	let skipped = '';
	if (unsupported.length) {
		// translators: %s: the name of a file, or several separated by commas.
		skipped = sprintf(_n('%s is a binary file and will be skipped.', '%s are binary files and will be skipped.', unsupported.length), unsupported.join(', '));
	}
	return {
		// translators: %s: the name of a patch file, such as 65933.diff.
		title: sprintf(__('Apply %s'), preview.label),
		// translators: 1: the name of a patch file. 2: how many files it changes.
		headline: sprintf(_n('%1$s changes %2$d file.', '%1$s changes %2$d files.', paths.length), preview.label, paths.length),
		action: __('Apply and rebuild'),
		closedNote: '',
		skipped,
		installNote: preview.needsInstall ? __('It changes package-lock.json, so dependencies will be installed before the rebuild.') : ''
	};
}

/**
 * The steps of an apply, as rows: what each says and how it stands. A step
 * that was skipped says why in place of its name.
 *
 * @param {Array} steps  The plan, `{ key, label, skipMessage }` each.
 * @param {Array} states How each stands, `{ status }` each, in the plan's order.
 * @return {Array<{key: string, label: string, status: string}>} One per step; `status` is 'complete', 'current', 'pending' or 'skipped'.
 */
function applyStepRows(steps = [], states = []) {
	return (Array.isArray(steps) ? steps : []).map((step, index) => {
		const status = (states[index] && states[index].status) || 'pending';
		return {
			key: step.key,
			label: status === 'skipped' && step.skipMessage ? step.skipMessage : step.label,
			status
		};
	});
}

/**
 * What a failed apply says first. Where the patch's failure was broken down,
 * the breakdown's headline says the same as the error in counts, which is the
 * part that decides whether the patch is worth rescuing, so it replaces the
 * sentence; without one the sentence is the whole story, and is given the
 * full stop it may lack. A patch file is applied all or nothing, so its
 * failure also says that nothing was changed; a pull request's does not,
 * since a checkout that fails part-way can leave the site on another branch.
 *
 * @param {Object} root0
 * @param {string} [root0.error]    What went wrong, as it was reported.
 * @param {Object} [root0.conflict] The breakdown, when there is one.
 * @param {string} [root0.kind]     'patch' or 'pr'.
 * @return {{headline: string, untouched: string}} The first sentence and, for a patch file, the reassurance.
 */
function applyFailureWords({ error = '', conflict = null, kind = '' } = {}) {
	const sentence = String(error || '').trim();
	const headline = (conflict && conflict.headline) || (/[.!?]$/.test(sentence) || !sentence ? sentence : `${sentence}.`);
	return {
		headline,
		untouched: kind === 'patch' ? __('The checkout was not changed.') : ''
	};
}

/**
 * How much of a file a patch could not change, and where in the file each
 * of those changes is.
 *
 * A place is said as a line of the file's own text where the patch gave one,
 * and as a line number of the patch otherwise: the patch's numbers are
 * coordinates in the file as its author had it, and on an old patch they miss
 * by dozens. Text survives the drift.
 *
 * @param {Object} item One file of the breakdown: `{ path, failed, total, regions }`.
 * @return {{heading: string, regions: Array<{key: number, anchor: string, where: string, reason: string, lines: string, more: string}>}} The file's heading and its places.
 */
function conflictFileRows(item) {
	const regions = Array.isArray(item.regions) ? item.regions : [];
	return {
		// translators: 1: a file's path. 2: how many of its changes failed. 3: how many it has.
		heading: sprintf(_n('%1$s — %2$d of %3$d change', '%1$s — %2$d of %3$d changes', item.total), item.path, item.failed, item.total),
		regions: regions.map((region) => {
			const lines = Array.isArray(region.lines) ? region.lines : [];
			let more = '';
			// translators: %d: how many lines of a file are not shown.
			if (region.more) more = sprintf(_n('… %d more line', '… %d more lines', region.more), region.more);
			return {
				key: region.index,
				anchor: region.anchor || '',
				// translators: %d: a line number in a patch file.
				where: region.anchor ? '' : sprintf(__('line %d of the patch'), region.line),
				reason: region.reason || '',
				lines: lines.join('\n'),
				more
			};
		})
	};
}

/**
 * The colour a checked-out pull request's notice has, by what its banner
 * says of the site (#509): green only once the site is built around the
 * checkout, amber while the watch rebuilds it, red when the rebuild was cut
 * short and the site is running what was built before.
 *
 * @param {string} tone 'ready', 'building' or 'unbuilt'.
 * @return {string} A notice's intent.
 */
function checkoutNoticeIntent(tone) {
	if (tone === 'building') return 'warning';
	if (tone === 'unbuilt') return 'error';
	return 'success';
}

module.exports = { applyCardWords, previewWords, applyStepRows, applyFailureWords, conflictFileRows, checkoutNoticeIntent };
