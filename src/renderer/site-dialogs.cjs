// What the two dialogs of a site's menu say (#557): the one that renames it,
// and the question asked before it is deleted. The components draw.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');

/**
 * Why a name cannot be given to a site, as the sentence that says so, or ''
 * when it can. A name of spaces is no name.
 *
 * @param {string} name The name as typed.
 * @return {string} The complaint, or ''.
 */
function renameProblem(name) {
	return String(name ?? '').trim() ? '' : __('Site name cannot be empty.');
}

/**
 * What is asked before a site is deleted. The folder and everything in it
 * go, and nothing brings them back, so the question names the site: the
 * button is the last thing between a contributor and their checkout.
 *
 * @param {string} name The site's name.
 * @return {{title: string, description: string, confirm: string}} The question, and what its button says.
 */
function deleteSiteQuestion(name) {
	return {
		// translators: %s: the name a site was given.
		title: sprintf(__('Delete %s?'), name),
		description: __('This will permanently delete the site and all of its files from your computer. This can’t be undone.'),
		confirm: __('Delete site')
	};
}

module.exports = { renameProblem, deleteSiteQuestion };
