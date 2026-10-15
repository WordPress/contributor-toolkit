'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');
const { applyHeldReason } = require('./apply-card.cjs');

/**
 * Why a ticket action is unavailable, and what the dirty-trunk question says
 * (#409). Every ticket action on the card (link, switch, unlink, delete work,
 * move onto trunk, the four answers to the dirty-trunk question) shares one
 * gate; the move onto trunk rewrites the checked-out tree, so it adds the
 * discard's guards on top. Each branch that disables a control has a sentence
 * here, because a disabled control carrying its reason as `title` explains
 * nothing: Chromium shows no tooltip on a disabled element and assistive
 * technology skips one with the real `disabled` attribute. `ReasonedButton`
 * in `index.jsx` renders the sentence, and is the only sanctioned way to
 * disable a ticket action: a bare `disabled=` on one of these controls is
 * the bug this module exists to close.
 *
 * Ordered like `discardDisabledReason` in `changes-note.cjs`: the action
 * already underway first, then the processes the contributor can wait for or
 * stop, so a state with several guards true reports the one that will clear
 * on its own.
 *
 * `noun` is what the site calls its work item (#251), `ticket` unless told
 * otherwise; the two sibling functions below take it the same way.
 *
 * @param {{ticketSaving?: boolean, deletingBranch?: string|null, updateState?: string,
 *          installing?: boolean, building?: boolean, applyState?: string, noun?: string}} state
 * @return {string|null} Null when nothing blocks the action.
 */
function ticketActionDisabledReason({ ticketSaving, deletingBranch, updateState = 'idle', installing, building, applyState = 'idle', noun = 'ticket' } = {}) {
	if (ticketSaving) return noun === 'issue' ? __('Wait for the current issue change to finish.') : __('Wait for the current ticket change to finish.');
	if (deletingBranch) return noun === 'issue' ? __("Wait for the issue's work to finish deleting.") : __("Wait for the ticket's work to finish deleting.");
	if (updateState !== 'idle') return __('Wait for the trunk update to finish.');
	if (applyState !== 'idle') return __('Wait for the PR or patch operation to finish.');
	if (installing) return __('Wait for the installation to finish.');
	if (building) return __('Wait for the build to finish.');
	return null;
}

/**
 * Why "Update this ticket to the current trunk" is unavailable: the shared
 * gate, then the guards a tree rewrite needs (a running dev server, a discard
 * in flight), the same ones the discard action checks.
 *
 * @param {{ticketSaving?: boolean, deletingBranch?: string|null, updateState?: string,
 *          installing?: boolean, building?: boolean, devServerActive?: boolean,
 *          discarding?: boolean, noun?: string}} state
 * @return {string|null}
 */
function rebaseDisabledReason(state = {}) {
	const issue = state.noun === 'issue';
	// `discarding` leads, as it does in `discardDisabledReason`: a discard is
	// already rewriting the tree, and reporting an install the contributor
	// could wait out would name the wrong thing. The rest of the shared gate
	// follows, then the dev server, which is the one the contributor has to
	// act on rather than wait for.
	if (state.discarding) return issue ? __('Wait for the discard to finish before updating the issue.') : __('Wait for the discard to finish before updating the ticket.');
	const shared = ticketActionDisabledReason(state);
	if (shared) return shared;
	if (state.devServerActive) return issue ? __('Stop the dev server before updating the issue.') : __('Stop the dev server before updating the ticket.');
	return null;
}

/**
 * The dirty-trunk question (#234): trunk has uncommitted edits and the
 * contributor picked a ticket. The three answers change with `canCarry`: a
 * new ticket can take the edits along and otherwise starts clean, but an
 * existing ticket has parked work that the switch restores, so nothing
 * starts clean there and the answers say "continue on #N" instead.
 *
 * Every sentence is whole and written once per kind of work item; the
 * question is the count's sentence, then the one that says why the edits
 * cannot come along, when there is one.
 *
 * @param {Object}             root0
 * @param {number}             [root0.files]       How many files are dirty, 0 when unknown.
 * @param {boolean}            [root0.canCarry]    Whether the edits can ride into the ticket.
 * @param {string|number|null} [root0.ticket]      Ticket being picked, for the labels.
 * @param {number|null}        [root0.pullRequest] PR being checked out instead of a ticket.
 * @param {string}             [root0.noun]        What the site calls its work item (#251).
 * @return {{question: string, carry: string|null, save: string, discard: string, cancel: string}}
 */
function dirtyTrunkQuestion({ files = 0, canCarry = false, ticket = null, pullRequest = null, noun = 'ticket' } = {}) {
	const issue = noun === 'issue';
	let asked;
	if (files && issue) {
		asked = sprintf(
			// translators: %d: how many files have uncommitted changes.
			_n(
				'You have %d uncommitted change on this site, not on any issue yet. What should happen to them?',
				'You have %d uncommitted changes on this site, not on any issue yet. What should happen to them?',
				files
			),
			files
		);
	} else if (files) {
		asked = sprintf(
			// translators: %d: how many files have uncommitted changes.
			_n(
				'You have %d uncommitted change on this site, not on any ticket yet. What should happen to them?',
				'You have %d uncommitted changes on this site, not on any ticket yet. What should happen to them?',
				files
			),
			files
		);
	} else {
		asked = issue
			? __('You have uncommitted changes on this site, not on any issue yet. What should happen to them?')
			: __('You have uncommitted changes on this site, not on any ticket yet. What should happen to them?');
	}
	if (Number.isInteger(pullRequest)) {
		const separate = sprintf(
			// translators: %d: a pull request number.
			__('PR #%d is a separate checkout, so these edits cannot come along into it.'),
			pullRequest
		);
		return {
			question: `${asked} ${separate}`,
			carry: null,
			// translators: %d: a pull request number.
			save: sprintf(__('Save them as a patch, then check out PR #%d…'), pullRequest),
			// translators: %d: a pull request number.
			discard: sprintf(__('Discard them and check out PR #%d'), pullRequest),
			cancel: __('Cancel')
		};
	}
	if (canCarry) {
		let carry;
		if (ticket) {
			// translators: %s: the number of the ticket or issue being linked.
			carry = sprintf(__('Take these edits into #%s'), ticket);
		} else {
			carry = issue ? __('Take these edits into the issue') : __('Take these edits into the ticket');
		}
		return {
			question: asked,
			carry,
			save: __('Save them as a patch, then start clean…'),
			discard: __('Discard them and start clean'),
			cancel: __('Cancel')
		};
	}
	let save;
	let discard;
	if (ticket) {
		// translators: %s: the number of the ticket or issue being switched to.
		save = sprintf(__('Save them as a patch, then continue on #%s…'), ticket);
		// translators: %s: the number of the ticket or issue being switched to.
		discard = sprintf(__('Discard them and continue on #%s'), ticket);
	} else if (issue) {
		save = __('Save them as a patch, then continue on the issue…');
		discard = __('Discard them and continue on the issue');
	} else {
		save = __('Save them as a patch, then continue on the ticket…');
		discard = __('Discard them and continue on the ticket');
	}
	const ownWork = issue
		? __('This issue already has its own work here, so these edits cannot come along into it.')
		: __('This ticket already has its own work here, so these edits cannot come along into it.');
	return {
		question: `${asked} ${ownWork}`,
		carry: null,
		save,
		discard,
		cancel: __('Cancel')
	};
}

/**
 * What is asked before the edits on trunk are discarded, on the answer to
 * the dirty-trunk question that throws them away.
 *
 * @return {{title: string, description: string, confirm: string}} The question, and what its button says.
 */
function discardTrunkEditsQuestion() {
	return {
		title: __('Discard the uncommitted edits on trunk?'),
		description: __('This can’t be undone.'),
		confirm: __('Discard edits')
	};
}

/**
 * Why the Tests section's buttons are unavailable: the shared gate, because
 * the tests read the checked-out tree and every action it waits for rewrites it,
 * then a discard in flight, which does too, then the terminal, which the run
 * is printed in and which holds one command at a time. Some actions above
 * release the terminal while they still rewrite the tree, so the terminal is
 * not enough on its own.
 *
 * @param {{terminalRunning?: boolean, discarding?: boolean, ticketSaving?: boolean,
 *          deletingBranch?: string|null, updateState?: string, installing?: boolean,
 *          building?: boolean, applyState?: string, noun?: string}} state
 * @return {string} The reason, or '' when the tests can run.
 */
function testsDisabledReason({ terminalRunning = false, discarding = false, ...state } = {}) {
	return ticketActionDisabledReason(state)
		|| (discarding ? __('Wait for the discard to finish.') : '')
		|| applyHeldReason({ terminalRunning });
}

module.exports = { ticketActionDisabledReason, rebaseDisabledReason, testsDisabledReason, dirtyTrunkQuestion, discardTrunkEditsQuestion };
