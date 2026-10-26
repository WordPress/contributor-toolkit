'use strict';

const { __, sprintf } = require('@wordpress/i18n');
const { filterArgs } = require('../phpunit-plan.cjs');

/**
 * The Tests section's decisions, apart from the JSX that draws them, so the
 * suite can reach them: whether the fields pick anything, what the Group
 * field's hint says, how a finished run is shown, and when the section asks
 * main for the checkout's test groups.
 */

/**
 * Whether the Filter and Group fields pick any tests. With both blank a run
 * would be "Run all" under another name, so the section starts none.
 *
 * @param {{filter?: string, group?: string}} fields The fields' values.
 * @return {boolean} True when "Run matching tests" has something to run.
 */
function picksTests(fields) {
	return filterArgs(fields).length > 0;
}

/**
 * The Group field's hint, which names the linked ticket's number when there
 * is one: a ticket's number is the group of the tests written for it.
 *
 * @param {?(string|number)} ticket The linked ticket's number, or null.
 * @return {string} The hint.
 */
function groupFieldHint(ticket) {
	if (!ticket) return __('A group such as ajax or restapi, or a ticket number.');
	// translators: %s: the number of the ticket linked to the site.
	return sprintf(__('A group such as ajax or restapi, or a ticket number, such as %s for this ticket.'), String(ticket));
}

/**
 * How a finished run is shown: the notice's intent and title. A run that
 * counted tests is a Pass or a Fail; one that gave nothing to count is a
 * Notice. Before a run, and while one runs, there is no notice, only a line
 * of text, and this is null.
 *
 * @param {string} outcome The run's outcome, from phpunitResult.
 * @return {?{intent: string, title: string}} The notice, or null.
 */
function outcomeNotice(outcome) {
	if (outcome === 'pass') return { intent: 'success', title: __('Pass') };
	if (outcome === 'fail') return { intent: 'error', title: __('Fail') };
	if (outcome === 'notice') return { intent: 'warning', title: __('Notice') };
	return null;
}

/**
 * Whether a site asks main for its test groups now. Every site's view stays
 * mounted, so only the one on screen asks, or a launch would read every core
 * site's tests; and only once its checked-out branch is known, which arrives
 * after the view does, or each would read them twice.
 *
 * @param {{showsTests: boolean, isActive: boolean, branch: ?string}} state The site's view.
 * @return {boolean} True when the groups should be listed.
 */
function listsTestGroups({ showsTests, isActive, branch }) {
	return Boolean(showsTests && isActive && branch);
}

/**
 * The groups in main's answer to `phpunit:groups`. A refusal, or an answer
 * of another shape, is a field with no suggestions, not an error to show.
 *
 * @param {*} answer Main's answer.
 * @return {string[]} The groups to suggest.
 */
function groupsFromAnswer(answer) {
	return answer && answer.ok && Array.isArray(answer.groups) ? answer.groups : [];
}

module.exports = { picksTests, groupFieldHint, outcomeNotice, listsTestGroups, groupsFromAnswer };
