'use strict';

/**
 * What the card says while a pull request is being opened (#167). Each step is
 * named because they take visibly different amounts of time: forking is the
 * slow one, and an unlabelled spinner there reads as a hang.
 *
 * The forking line names the repository being forked, which is the site's
 * (#251): wordpress-develop on a Core site, gutenberg on a Gutenberg one. A
 * string chosen by a branch, so it lives here with a test rather than in
 * index.jsx.
 *
 * @param {string} stage 'forking' | 'syncing' | 'committing' | 'opening'.
 * @param {string} repo  The repository name the flow forks, e.g. 'gutenberg'.
 * @return {string}
 */
function prStageLabel(stage, repo) {
	switch (stage) {
		case 'forking': return `Creating your fork of ${repo}…`;
		case 'syncing': return 'Bringing your fork up to date…';
		case 'committing': return 'Uploading your changes…';
		case 'opening': return 'Opening the pull request…';
		default: return 'Working…';
	}
}

module.exports = { prStageLabel };
