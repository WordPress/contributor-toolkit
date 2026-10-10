// What the app says about the one patch a ticket has applied (#306).
//
// A ticket is a branch (#108): trunk, plus at most one applied patch or pull
// request, plus the contributor's own edits. The branch holds that faithfully.
// What the app *said* about it did not — the applied patch was remembered as an
// undo blob, so every file it brought was announced as the contributor's own
// writing, and "can this be reverted" meant no more than "we kept the text".
//
// Two answers live here, both pure:
//
//   - `attributeConflicts` names files that include the applied layer without
//     claiming the contributor could not also have edited them.
//   - `describeAppliedLayer` offers Revert when the text was retained, and the
//     copy-and-discard exit when it was too large to keep.
//
// DOM-free like apply-conflict.cjs and update-plan.cjs, for the same reason:
// the renderer bundle imports it, `node --test` requires it directly, and
// neither needs a DOM. Its one import is `@wordpress/i18n`; update-plan.cjs
// takes one from a sibling, which is allowed for the same reason — a decision
// with a single definition belongs beside it, not copied.
'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');

// Saving a copy and then discarding is a recommendable way forward on this
// project, not a defeat: a ticket's changes are one afternoon's work on a
// checkout that gets thrown away, and redoing them is cheaper than untangling
// them. Said once, here, so both faces that offer it say it the same way.
// Functions rather than constants, so that each is translated when it is shown.
function disposableExit() {
	return __('Save a copy of your work first and the ticket is safe to discard back to its base — on this project that is a normal way forward, not a lost afternoon.');
}

// A patch that cannot be reverted still holds the slot until the ticket is
// discarded; keeping that explicit prevents the banner implying otherwise.
function slotHeld() {
	return __('It still counts as this ticket\'s one applied patch, so another cannot be applied until this ticket is reverted or discarded.');
}

/**
 * `a`, `a and b`, `a, b and c` — a list a person reads rather than a join.
 *
 * @param {string[]} items
 * @return {string}
 */
function listOf(items) {
	if (items.length <= 1) return items[0] || '';
	// translators: 1: file paths, separated by commas. 2: the last file path in the list.
	return sprintf(__('%1$s and %2$s'), items.slice(0, -1).join(', '), items[items.length - 1]);
}

/**
 * Who owns each file a patch about to be applied would land on.
 *
 * The pre-apply warning exists to say "your work is here, and this could fail
 * without touching it". Counting the applied layer's files as the contributor's
 * own writing is the kind of wrong that teaches people to ignore the warning —
 * so both are named, separately, and neither is dropped.
 *
 * This is provenance, not exclusive ownership. A routine status read does not
 * inspect every line, so a layer file may also contain contributor edits and
 * the copy says that explicitly.
 *
 * @param {Object}   root0
 * @param {string[]} [root0.conflicts]    Paths from the preview's plan.
 * @param {?Object}  [root0.appliedPatch] The status record, or null.
 * @return {{yours: string[], fromLayer: string[], sentences: string[]}}
 */
function attributeConflicts({ conflicts = [], appliedPatch = null } = {}) {
	const paths = Array.isArray(conflicts) ? conflicts.filter(Boolean) : [];
	const layerFiles = new Set(appliedPatch && Array.isArray(appliedPatch.files) ? appliedPatch.files : []);
	const fromLayer = appliedPatch ? paths.filter((p) => layerFiles.has(p)) : [];
	const claimed = new Set(fromLayer);
	const yours = paths.filter((p) => !claimed.has(p));

	const sentences = [];
	if (yours.length) {
		// translators: %s: one or more file paths, as a list.
		sentences.push(sprintf(__('You have your own edits to %s. Save a patch of your work first if you want a copy.'), listOf(yours)));
	}
	if (fromLayer.length) {
		if (appliedPatch.label) {
			// translators: 1: one or more file paths, as a list. 2: the name of the patch applied to the checkout, such as a file name.
			sentences.push(sprintf(_n('%1$s includes changes from %2$s, which you applied. The file may also contain your own edits.', '%1$s include changes from %2$s, which you applied. The files may also contain your own edits.', fromLayer.length), listOf(fromLayer), appliedPatch.label));
		} else {
			// translators: %s: one or more file paths, as a list.
			sentences.push(sprintf(_n('%s includes changes from the patch you applied, which you applied. The file may also contain your own edits.', '%s include changes from the patch you applied, which you applied. The files may also contain your own edits.', fromLayer.length), listOf(fromLayer)));
		}
	}
	if (sentences.length) {
		sentences.push(__('The patch is applied on top of those changes: it succeeds if they do not overlap, and fails without touching anything if they do.'));
	}
	return { yours, fromLayer, sentences };
}

/**
 * The applied-layer banner, in whichever face the checkout has earned.
 *
 * The banner only promises an undo when the app retained the patch text.
 *
 * `when` is passed in already formatted — the locale-dependent part is the
 * component's, and keeping it out of here is what lets this be asserted on.
 *
 * @param {?Object} appliedPatch   The `site:status` record, or null.
 * @param {Object}  [options]
 * @param {string}  [options.when] Formatted apply time, or '' when unknown.
 * @return {?Object}
 */
function describeAppliedLayer(appliedPatch, { when = '' } = {}) {
	if (!appliedPatch) return null;

	const label = appliedPatch.label || '';
	const files = Array.isArray(appliedPatch.files) ? appliedPatch.files : [];
	const count = files.length;
	const kept = appliedPatch.kept === undefined ? Boolean(appliedPatch.revertable) : Boolean(appliedPatch.kept);

	// The whole sentence, the patch's name in it: one per combination of a
	// name and a time, since either can be missing.
	let summary;
	if (label && when) {
		// translators: 1: the name of the applied patch, such as a file name. 2: how many files it changed. 3: when it was applied, as a date and time.
		summary = sprintf(_n('%1$s is applied — %2$d file, %3$s.', '%1$s is applied — %2$d files, %3$s.', count), label, count, when);
	} else if (label) {
		// translators: 1: the name of the applied patch, such as a file name. 2: how many files it changed.
		summary = sprintf(_n('%1$s is applied — %2$d file.', '%1$s is applied — %2$d files.', count), label, count);
	} else if (when) {
		// translators: 1: how many files the patch changed. 2: when it was applied, as a date and time.
		summary = sprintf(_n('A patch is applied — %1$d file, %2$s.', 'A patch is applied — %1$d files, %2$s.', count), count, when);
	} else {
		// translators: %d: how many files the patch changed.
		summary = sprintf(_n('A patch is applied — %d file.', 'A patch is applied — %d files.', count), count);
	}

	if (kept) {
		return { label, summary, canRevert: true, explanation: '', detail: [], note: '', offerCopy: false };
	}

	// Too large to have kept a copy of. Nothing about the tree changes this one,
	// so it says so plainly and goes straight to the exit that always works.
	let explanation = __('A patch was too large to keep a copy of for an undo, so it cannot be lifted back out on its own.');
	if (label) {
		// translators: %s: the name of the applied patch, such as a file name.
		explanation = sprintf(__('%s was too large to keep a copy of for an undo, so it cannot be lifted back out on its own.'), label);
	}
	return {
		label,
		summary,
		canRevert: false,
		explanation,
		detail: [],
		note: `${disposableExit()} ${slotHeld()}`,
		offerCopy: true
	};
}

/**
 * Whichever of the layer's two safe exits failed, said where they were offered.
 *
 * Both report through state that belongs to somewhere else on screen — the
 * changes note and the patch modal — and the layer banner is neither. A
 * refusal that lands there is a button that did nothing, on the one way out
 * this banner recommends, so it is repeated here rather than left behind.
 *
 * The save goes first: it is the step that makes discarding safe, and its
 * failure is the one that must not be missed.
 *
 * @param {Object} root0
 * @param {string} [root0.patchSaveError]
 * @param {string} [root0.discardError]
 * @return {{message: string}}
 */
function layerExitFailure({ patchSaveError = '', discardError = '' } = {}) {
	// translators: %s: why the copy could not be saved.
	if (patchSaveError) return { message: sprintf(__('The copy could not be saved: %s'), patchSaveError) };
	if (discardError) return { message: discardError };
	return { message: '' };
}

module.exports = { attributeConflicts, describeAppliedLayer, layerExitFailure, listOf, disposableExit, slotHeld };
