'use strict';

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
		case 'forking': return `Creating your fork of ${repoPath}…`;
		case 'syncing': return 'Bringing your fork up to date…';
		case 'committing': return 'Uploading your changes…';
		case 'opening': return 'Opening the pull request…';
		default: return 'Working…';
	}
}

module.exports = { prStageLabel };
