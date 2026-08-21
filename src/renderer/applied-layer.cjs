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
// Pure and dependency-free like update-plan.cjs and apply-conflict.cjs, for the
// same reason: the renderer bundle imports it, `node --test` requires it
// directly, and neither needs a DOM.
'use strict';

// Saving a copy and then discarding is a recommendable way forward on this
// project, not a defeat: a ticket's changes are one afternoon's work on a
// checkout that gets thrown away, and redoing them is cheaper than untangling
// them. Said once, here, so both faces that offer it say it the same way.
const DISPOSABLE_EXIT = 'Save a copy of your work first and the ticket is safe to discard back to its base — on this project that is a normal way forward, not a lost afternoon.';

// A patch that cannot be reverted still holds the slot until the ticket is
// discarded; keeping that explicit prevents the banner implying otherwise.
const SLOT_HELD = 'It still counts as this ticket\'s one applied patch, so another cannot be applied until this ticket is reverted or discarded.';

/**
 * `a`, `a and b`, `a, b and c` — a list a person reads rather than a join.
 *
 * @param {string[]} items
 * @return {string}
 */
function listOf(items) {
	if (items.length <= 1) return items[0] || '';
	return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
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
		sentences.push(`You have your own edits to ${listOf(yours)}. Save a patch of your work first if you want a copy.`);
	}
	if (fromLayer.length) {
		const label = appliedPatch.label || 'the patch you applied';
		sentences.push(`${listOf(fromLayer)} ${fromLayer.length === 1 ? 'includes' : 'include'} changes from ${label}, which you applied. The ${fromLayer.length === 1 ? 'file may' : 'files may'} also contain your own edits.`);
	}
	if (sentences.length) {
		sentences.push('The patch is applied on top of those changes: it succeeds if they do not overlap, and fails without touching anything if they do.');
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

	const label = appliedPatch.label || 'A patch';
	const files = Array.isArray(appliedPatch.files) ? appliedPatch.files : [];
	const kept = appliedPatch.kept === undefined ? Boolean(appliedPatch.revertable) : Boolean(appliedPatch.kept);

	const summary = `is applied — ${files.length} file${files.length === 1 ? '' : 's'}${when ? `, ${when}` : ''}.`;

	if (kept) {
		return { label, summary, canRevert: true, explanation: '', detail: [], note: '', offerCopy: false };
	}

	// Too large to have kept a copy of. Nothing about the tree changes this one,
	// so it says so plainly and goes straight to the exit that always works.
	return {
		label,
		summary,
		canRevert: false,
		explanation: `${label} was too large to keep a copy of for an undo, so it cannot be lifted back out on its own.`,
		detail: [],
		note: `${DISPOSABLE_EXIT} ${SLOT_HELD}`,
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
	if (patchSaveError) return { message: `The copy could not be saved: ${patchSaveError}` };
	if (discardError) return { message: discardError };
	return { message: '' };
}

module.exports = { attributeConflicts, describeAppliedLayer, layerExitFailure, listOf, DISPOSABLE_EXIT, SLOT_HELD };
