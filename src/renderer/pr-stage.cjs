'use strict';

const { __, sprintf } = require('@wordpress/i18n');

/**
 * What the card says while a pull request is being opened (#167). Each step is
 * named because they take visibly different amounts of time: forking is the
 * slow one, and an unlabelled spinner there reads as a hang.
 *
 * The forking line names the repository being forked (#251): the site's own
 * (WordPress/wordpress-develop on a Core site, WordPress/gutenberg on a
 * Gutenberg one), or the sandbox when the override redirects the run, which
 * is why the caller passes the effective target rather than the site's. A
 * string chosen by a branch, so it lives here with a test rather than in
 * index.jsx.
 *
 * @param {string} stage    'forking' | 'syncing' | 'committing' | 'opening'.
 * @param {string} repoPath `owner/repo` the flow actually forks.
 * @return {string}
 */
function prStageLabel(stage, repoPath) {
	switch (stage) {
		case 'forking':
			// translators: %s: the repository being forked, such as WordPress/gutenberg.
			return sprintf(__('Creating your fork of %s…'), repoPath);
		case 'syncing': return __('Bringing your fork up to date…');
		case 'committing': return __('Uploading your changes…');
		case 'opening': return __('Opening the pull request…');
		default: return __('Working…');
	}
}

module.exports = { prStageLabel };
