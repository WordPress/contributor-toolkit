'use strict';

/**
 * Decides the one thing the contributor should do next, anywhere in a site's
 * detail view.
 *
 * The view is a stack of panels — a setup checklist, then (once the wizard is
 * skipped) banners for an incomplete or stale update, a dev-server bar, a
 * ticket panel, a patch panel. Each panel already knows whether it has
 * something to offer, but nothing looked across them to say which one is *the*
 * next step. A contributor lands on the screen and the relevant control may be
 * scrolled out of view, or sit among several with nothing to say "start here"
 * (#252).
 *
 * This is that decision, and only the decision. It returns the `id` of the
 * block to point at — a stable string the render tags onto that block with
 * `data-next-action` — or `null` when nothing is pending. Pure and
 * dependency-free so it can be unit tested without a DOM: the renderer imports
 * it, `node --test` requires it directly, exactly like `setup-steps.cjs`.
 *
 * The order below is a priority ladder, most urgent first. It is deliberate,
 * not incidental: an incomplete update (the code moved but the built assets did
 * not, so the site may not run) outranks everything, because ignoring it wastes
 * the rest of the session. A stale tree outranks routine work because a patch
 * made against old code may not apply on Trac. Only then do the routine steps
 * come — get the server up, review pending changes, link a ticket — and a site
 * that is running, clean and linked has no next action at all.
 *
 * @param {Object}  state
 * @param {boolean} state.skipInit         Init wizard skipped; post-init view shown.
 * @param {?string} state.currentSetupStep The checklist's current step key, or null.
 * @param {boolean} state.isApplying       A patch is being applied or reverted now.
 * @param {boolean} state.applyPreview     A patch is staged, awaiting apply or cancel.
 * @param {boolean} state.updateIncomplete Code updated but built assets are stale.
 * @param {boolean} state.isUpdating       A trunk update is running now.
 * @param {boolean} state.stale            The trunk snapshot is old (#94).
 * @param {boolean} state.running          The dev server is up.
 * @param {boolean} state.hasChanges       The working tree has uncommitted edits.
 * @param {boolean} state.ticketLinked     A Trac ticket is linked.
 * @return {?{id: string, reason: string}} The block to point at, or null.
 */
function deriveNextAction(state = {}) {
	const skipInit = Boolean(state.skipInit);

	// Before the wizard is skipped the checklist is the whole story, and it has
	// already worked out its own next step (exactly one row is `current`). Reuse
	// that rather than re-deriving it from the raw flags — there is one source of
	// truth for the checklist, and it is the checklist.
	if (!skipInit) {
		if (typeof state.currentSetupStep === 'string' && state.currentSetupStep) {
			return {
				id: `setup-${state.currentSetupStep}`,
				reason: 'The next step in the setup checklist.'
			};
		}
		return null;
	}

	// An operation in flight is the thing happening, not an action to take — but
	// it is still where attention belongs, so a contributor who looked away can
	// find where the work is (and see it is not stuck). It outranks the
	// stale-state warnings below, which are only warnings; an applying or
	// reverting patch is live. `isApplying` covers both — a revert runs through
	// the same apply machinery — and the two operations that own the working tree
	// (this and a trunk update) never run at once.
	if (Boolean(state.isApplying)) {
		return { id: 'applying-patch', reason: 'A patch is being applied or reverted.' };
	}

	if (Boolean(state.isUpdating)) {
		return { id: 'updating', reason: 'The trunk update in progress.' };
	}

	// A staged patch preview is not work in flight, but it is the one thing the
	// contributor just set up and is looking at: they pasted a PR, it previewed,
	// and the decision to apply or cancel is now theirs. It outranks the
	// stale-state warnings and routine steps below — an explicit, waiting choice
	// beats a standing suggestion.
	if (Boolean(state.applyPreview)) {
		return { id: 'apply-preview', reason: 'A patch is staged — apply and rebuild, or cancel.' };
	}

	if (Boolean(state.updateIncomplete)) {
		return {
			id: 'retry-install-build',
			reason: 'The update left the build stale; install and build to recover.'
		};
	}

	if (Boolean(state.stale)) {
		return {
			id: 'update-trunk',
			reason: 'The trunk snapshot is old; update before making a patch.'
		};
	}

	if (!Boolean(state.running)) {
		return { id: 'start-dev', reason: 'Start the dev server to work on the site.' };
	}

	if (Boolean(state.hasChanges)) {
		return {
			id: 'review-changes',
			reason: 'You have uncommitted changes ready to review and submit.'
		};
	}

	if (!Boolean(state.ticketLinked)) {
		return { id: 'link-ticket', reason: 'Link a Trac ticket to give your work a home.' };
	}

	return null;
}

module.exports = { deriveNextAction };
