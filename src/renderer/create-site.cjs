// What the create-site dialog decides (#557): which projects it offers, what
// it says of the one that is chosen, and which answer is missing. The
// component draws; where a new site goes and what its folder is called are
// site-folder.cjs's.
'use strict';

const { __ } = require('@wordpress/i18n');
const { PROJECT_TYPES, DEFAULT_PROJECT_TYPE } = require('../project-type.cjs');

/**
 * The projects a site can be a checkout of, in the registry's order: Core
 * first, which is also the one chosen when the dialog opens. A project's name
 * is its own and is the same in every language.
 *
 * @return {Array<{value: string, label: string}>} One per project.
 */
function projectChoices() {
	return Object.values(PROJECT_TYPES).map((project) => ({ value: project.id, label: project.wizardLabel }));
}

/**
 * What is said under the choice of project: what the chosen one is, and that
 * the choice is for good. The two are sentences of their own, and are drawn
 * as two.
 *
 * The first is read off the registry each time, and not kept: it is
 * translated when it is read, which has to be after the locale has loaded.
 *
 * @param {string} type The chosen project's id. Anything unknown is Core.
 * @return {{about: string, lasting: string}} The two sentences.
 */
function projectHelp(type) {
	const project = PROJECT_TYPES[type] || PROJECT_TYPES[DEFAULT_PROJECT_TYPE];
	return {
		about: project.description,
		lasting: __('A site’s project cannot be changed later.')
	};
}

/**
 * Which answer is missing, as the sentence that says so, or '' when the site
 * can be created. One at a time, the name first: a name of spaces is no name.
 *
 * @param {Object} root0
 * @param {string} [root0.name] The name as typed.
 * @param {string} [root0.dir]  The folder that was chosen, or ''.
 * @return {string} The complaint, or ''.
 */
function createSiteProblem({ name = '', dir = '' } = {}) {
	if (!String(name).trim()) return __('Please provide a site name.');
	if (!dir) return __('Please choose where to create the site.');
	return '';
}

module.exports = { projectChoices, projectHelp, createSiteProblem };
