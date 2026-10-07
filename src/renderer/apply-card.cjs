// What the apply card says (#557): the card a pull request or a patch file is
// brought into the checkout from, the dialog that shows what one would change
// before it is applied, and the notices that say what is applied now. The
// components draw; what they draw that is this card's own is decided here.
//
// Much of what the card shows is still written elsewhere and passed through
// as it is: what a pull request's preview and banner say (pr-checkout.cjs,
// watch-activity.cjs), what an applied patch says (applied-layer.cjs), why a
// patch did not fit (apply-conflict.cjs) and the steps of an apply
// (update-plan.cjs). Each is translated where it is written, not here; the
// banner's and the steps' words are still English until their own batches.
'use strict';

const { __, _n, _x, sprintf } = require('@wordpress/i18n');

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
		// translators: a noun, the name of a tab: a diff is a file of changes, also called a patch.
		fileTab: __('Diff'),
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
 * Which preview the dialog shows, if any. A patch that has been read is
 * shown until it is applied or dropped, with three exceptions, in each of
 * which it is kept and only not shown.
 *
 * A dialog is in front of the whole window, and every site's view is in the
 * window at once, so a preview is its own site's to show: one that arrives
 * after the contributor has gone to another site waits until they are back.
 * While its apply is under way there is nothing left to decide. And while
 * the app asks what should become of loose edits on trunk, the question is
 * on the page behind, and the answer that goes on with the checkout needs
 * the preview it was asked about.
 *
 * @param {Object}  root0
 * @param {Object}  [root0.preview]  The patch that was read, or null.
 * @param {boolean} [root0.active]   This site is the one on screen.
 * @param {boolean} [root0.applying] An apply is under way.
 * @param {boolean} [root0.asking]   The question about loose edits on trunk is on the page.
 * @return {Object|null} The preview to show, or null.
 */
function previewShown({ preview = null, active = false, applying = false, asking = false } = {}) {
	if (!preview || !active || applying || asking) return null;
	return preview;
}

/**
 * Why the preview's button cannot be pressed, or '' when it can.
 *
 * An apply runs through the terminal and is refused while anything else
 * holds it. The refusal is a line in the terminal, which a dialog is in
 * front of, so the button is held and says it instead. What holds the
 * terminal is not always something typed there, or shown there: a build the
 * watch runs before it starts prints in the watch's own tab, and a ticket
 * switch says its progress in the work-item card. So the sentence does not
 * say where to look, only that Ctrl+C in the terminal stops it, which is
 * true of all of them.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.terminalRunning] Something holds the site's terminal: a typed command, or a chain the app runs.
 * @return {string} The reason, or ''.
 */
function applyHeldReason({ terminalRunning = false } = {}) {
	return terminalRunning ? __('Another command is running on this site. Wait for it to finish, or stop it with Ctrl+C in the terminal.') : '';
}

/**
 * Whether the card is open. Whoever is using it can fold it away, and only
 * they can: with something to say besides its fields (a patch that is
 * applied, the steps of an apply, a failure, a notice) it is open whatever
 * they chose, and their choice is kept for when it has been said. `held`
 * says the fold is not theirs to change just now.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.folded]   What the contributor last chose.
 * @param {boolean} [root0.speaking] The card has something to say.
 * @return {{open: boolean, held: boolean}} How the card stands.
 */
function cardFold({ folded = false, speaking = false } = {}) {
	return { open: Boolean(speaking) || !folded, held: Boolean(speaking) };
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
 * full stop it may lack: Git's own line and a thrown error have none. The
 * full stop is the translator's, since not every language ends a sentence
 * with one, and a sentence already ended in any script's mark keeps it. A
 * patch file is applied all or nothing, so its failure also says that nothing
 * was changed; a pull request's does not, since a checkout that fails part-way
 * can leave the site on another branch.
 *
 * @param {Object} root0
 * @param {string} [root0.error]    What went wrong, as it was reported.
 * @param {Object} [root0.conflict] The breakdown, when there is one.
 * @param {string} [root0.kind]     'patch' or 'pr'.
 * @return {{headline: string, untouched: string}} The first sentence and, for a patch file, the reassurance.
 */
function applyFailureWords({ error = '', conflict = null, kind = '' } = {}) {
	const sentence = String(error || '').trim();
	const headline = (conflict && conflict.headline) || (/[\p{Sentence_Terminal}…]$/u.test(sentence) || !sentence ? sentence : sprintf(
		// translators: %s: a sentence that did not end in a full stop. Use the mark your language ends a sentence with, or none.
		_x('%s.', 'ends a sentence that lacks a full stop'),
		sentence
	));
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
 * A place found by its text is said as "Near" and the line, the line in a
 * code font: `near` is that sentence cut at the line, so that the component
 * can put the line in, and a translation can put it where its own word order
 * wants it.
 *
 * @param {Object} item One file of the breakdown: `{ path, failed, total, regions }`.
 * @return {{heading: string, regions: Array<{key: number, anchor: string, near: {before: string, after: string}, where: string, reason: string, lines: string, more: string}>}} The file's heading and its places.
 */
function conflictFileRows(item) {
	const regions = Array.isArray(item.regions) ? item.regions : [];
	return {
		// translators: 1: a file's path. 2: how many of its changes failed. 3: how many it has.
		heading: sprintf(_n('%1$s — %2$d of %3$d change', '%1$s — %2$d of %3$d changes', item.total), item.path, item.failed, item.total),
		// By position: the breakdown gives a place no name of its own, and a
		// patch made of several can carry two changes that start on one line.
		regions: regions.map((region, position) => {
			const lines = Array.isArray(region.lines) ? region.lines : [];
			// translators: %s: a line of code from a file, which is shown in a code font. Keep the %s.
			const [before = '', after = ''] = __('Near %s').split('%s');
			let more = '';
			// translators: %d: how many lines of a file are not shown.
			if (region.more) more = sprintf(_n('… %d more line', '… %d more lines', region.more), region.more);
			return {
				key: position,
				anchor: region.anchor || '',
				near: { before: before.trim(), after: after.trim() },
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

module.exports = { applyCardWords, previewShown, applyHeldReason, cardFold, previewWords, applyStepRows, applyFailureWords, conflictFileRows, checkoutNoticeIntent };
