'use strict';

const { __ } = require('@wordpress/i18n');

/**
 * What main's answer to `phpunit:run` means for the terminal: the run to
 * track, or the sentence to show when nothing was started. Main refuses with
 * `{ ok: false, error }` (a site it does not know, a project with no PHP
 * tests) and the invoke rejects when the runner could not be spawned at all;
 * either way no done event is coming, so the caller settles the run itself.
 * An answer that names no reason still gets a sentence, never `undefined`.
 *
 * @param {*} answer What the invoke resolved with, or the error it rejected with.
 * @return {{runId: string|null, error: string}} A run id, or the reason there is none.
 */
function phpunitStart(answer) {
	if (answer && answer.ok && typeof answer.runId === 'string') return { runId: answer.runId, error: '' };
	const reason = answer && (typeof answer.error === 'string' ? answer.error : answer.message);
	return { runId: null, error: typeof reason === 'string' && reason ? reason : __('The PHP unit tests could not be started.') };
}

module.exports = { phpunitStart };
