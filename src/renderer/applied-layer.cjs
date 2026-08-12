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
//   - `attributeConflicts` — whose changes are the ones a new patch would land
//     on. A file only the applied layer touched is named as the layer's; a file
//     the contributor has also edited over keeps naming their work, because that
//     is the one that decides what they do next.
//   - `describeAppliedLayer` — the banner's two faces. While the layer still
//     comes out cleanly, Revert is offered. Once the contributor's edits sit on
//     its lines it is **absorbed**: it has become their changes, and the honest
//     exits are saving a copy and discarding the ticket to its base.
//
// Absorption is measured, never tracked — the main process re-answers it on
// every status read, so undoing the overlapping edit brings Revert back on its
// own. And it never frees the one-patch slot: the record survives as provenance.
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

// The slot does not open when a patch is absorbed. Saying so is what stops the
// contributor reading "it is part of your changes now" as "so I can apply
// another one".
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
 * The paths of an applied layer whose lines the contributor has edited over.
 *
 * @param {?Object} appliedPatch
 * @return {string[]}
 */
function absorbedPaths(appliedPatch) {
	const list = appliedPatch && Array.isArray(appliedPatch.absorbed) ? appliedPatch.absorbed : [];
	return list.map((entry) => (typeof entry === 'string' ? entry : entry && entry.path)).filter(Boolean);
}

/**
 * Who owns each file a patch about to be applied would land on.
 *
 * The pre-apply warning exists to say "your work is here, and this could fail
 * without touching it". Counting the applied layer's files as the contributor's
 * own writing is the kind of wrong that teaches people to ignore the warning —
 * so both are named, separately, and neither is dropped.
 *
 * The measurement behind `absorbed` is per-region: a file is the layer's when
 * the layer's own lines are untouched. A contributor edit *elsewhere* in the
 * same file therefore reads as the layer's rather than as theirs. The file is
 * still named and the "fails without touching anything" caveat still covers it,
 * so the warning does not go quiet — it is the attribution that is coarse, and
 * only in that direction.
 *
 * @param {Object}   root0
 * @param {string[]} [root0.conflicts]    Paths from the preview's plan.
 * @param {?Object}  [root0.appliedPatch] The status record, or null.
 * @return {{yours: string[], fromLayer: string[], sentences: string[]}}
 */
function attributeConflicts({ conflicts = [], appliedPatch = null } = {}) {
	const paths = Array.isArray(conflicts) ? conflicts.filter(Boolean) : [];
	const layerFiles = new Set(appliedPatch && Array.isArray(appliedPatch.files) ? appliedPatch.files : []);
	const editedOver = new Set(absorbedPaths(appliedPatch));

	const fromLayer = appliedPatch ? paths.filter((p) => layerFiles.has(p) && !editedOver.has(p)) : [];
	const claimed = new Set(fromLayer);
	const yours = paths.filter((p) => !claimed.has(p));

	const sentences = [];
	if (yours.length) {
		sentences.push(`You have your own edits to ${listOf(yours)}. Save a patch of your work first if you want a copy.`);
	}
	if (fromLayer.length) {
		const label = appliedPatch.label || 'the patch you applied';
		sentences.push(`${listOf(fromLayer)} ${fromLayer.length === 1 ? 'was' : 'were'} changed by ${label}, which you applied — not by you.`);
	}
	if (sentences.length) {
		sentences.push('The patch is applied on top of those changes: it succeeds if they do not overlap, and fails without touching anything if they do.');
	}
	return { yours, fromLayer, sentences };
}

/**
 * The applied-layer banner, in whichever face the checkout has earned.
 *
 * Three, not two, because "cannot be reverted" has two different causes and
 * they need different sentences: a patch too large to keep a copy of was never
 * revertable, and a patch whose lines have been edited over stopped being.
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
	const absorbed = absorbedPaths(appliedPatch);
	const kept = appliedPatch.kept === undefined ? Boolean(appliedPatch.revertable) : Boolean(appliedPatch.kept);

	const summary = `is applied — ${files.length} file${files.length === 1 ? '' : 's'}${when ? `, ${when}` : ''}.`;

	if (kept && !absorbed.length) {
		return { label, summary, canRevert: true, absorbed: false, explanation: '', detail: [], note: '', offerCopy: false };
	}

	// Too large to have kept a copy of. Nothing about the tree changes this one,
	// so it says so plainly and goes straight to the exit that always works.
	if (!kept) {
		return {
			label,
			summary,
			canRevert: false,
			absorbed: false,
			explanation: `${label} was too large to keep a copy of for an undo, so it cannot be lifted back out on its own.`,
			detail: [],
			note: `${DISPOSABLE_EXIT} ${SLOT_HELD}`,
			offerCopy: true
		};
	}

	// Absorbed: the contributor's edits are on the patch's own lines, so there
	// is no longer a patch and an edit — there is one body of changes. Said as a
	// state of the work rather than as a failure, and with the way back named,
	// because undoing the overlapping edit really does bring Revert back.
	//
	// Not every file in the way was written over, though. One the contributor
	// deleted outright blocks the removal just as firmly, and calling that "your
	// edits are on its lines" would send them looking at lines that are not
	// there — so the two get their own sentence, and either alone is enough for
	// the revert to be off, because a revert is all or nothing.
	const entries = (appliedPatch.absorbed || []).filter((entry) => entry && entry.path);
	const written = entries.filter((entry) => entry.editedOver !== false).map((entry) => entry.path);
	const gone = entries.filter((entry) => entry.editedOver === false).map((entry) => entry.path);

	const reasons = [];
	if (written.length) reasons.push(`your own edits are on the lines it brought to ${listOf(written)}`);
	if (gone.length) reasons.push(`${listOf(gone)} ${gone.length === 1 ? 'is' : 'are'} no longer where it left ${gone.length === 1 ? 'it' : 'them'}`);

	return {
		label,
		summary,
		canRevert: false,
		absorbed: true,
		explanation: `${label} is part of your changes now and cannot be lifted back out on its own: ${listOf(reasons)}. Undo those edits and Revert comes back on its own.`,
		detail: entries
			.filter((entry) => entry.total)
			.map((entry) => `${entry.path} — you have edited ${entry.failed} of the ${entry.total} change${entry.total === 1 ? '' : 's'} it brought`),
		note: `${DISPOSABLE_EXIT} ${SLOT_HELD}`,
		offerCopy: true
	};
}

/**
 * Whichever of the two absorbed exits failed, said where they were offered.
 *
 * Both report through state that belongs to somewhere else on screen — the
 * changes note and the patch modal — and the absorbed banner is neither. A
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
function absorbedExitFailure({ patchSaveError = '', discardError = '' } = {}) {
	if (patchSaveError) return { message: `The copy could not be saved: ${patchSaveError}` };
	if (discardError) return { message: discardError };
	return { message: '' };
}

module.exports = { attributeConflicts, describeAppliedLayer, absorbedExitFailure, listOf, DISPOSABLE_EXIT, SLOT_HELD };
