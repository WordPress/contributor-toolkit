'use strict';

/**
 * The two pieces of logic behind the debug.log panel.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as dev-server-command.cjs and setup-steps.cjs).
 */

/**
 * How much of the log the panel keeps in memory.
 *
 * The existing runtime log grows without any bound at all
 * (`setRuntimeLogs((v) => v + chunk)`), which is survivable only because a dev
 * server is comparatively quiet. This one is not: the tail opens by sending up
 * to 256KB of backlog (startWpDebugTail in main.js), and a site looping a
 * notice inside a template writes a line per request. Unbounded, a long session
 * ends as a multi-megabyte string the renderer re-renders on every chunk.
 *
 * 512KB is far more scrollback than anyone reads and small enough that holding
 * it costs nothing.
 */
const MAX_LOG_CHARACTERS = 512 * 1024;

/**
 * Appends a chunk, dropping the oldest content once the result exceeds `limit`.
 *
 * Drops at a line boundary rather than mid-character-count: the first thing
 * anyone does with this panel is read a PHP error, and a half line at the top
 * of a scrollback reads as corruption.
 *
 * Some lines have no boundary to drop to — a var_dump or a serialized object
 * longer than the whole limit. There the tail is kept instead, because the end
 * of such a line is where the file and line number are. Note that the boundary
 * search can land on the line's own terminator and leave nothing behind, which
 * is the same case reached by a different route: the result is checked for
 * empty rather than the input for a trailing newline, since a log line that
 * ends in one is the normal shape, not the exception.
 *
 * @param {string} previous Text already held by the panel.
 * @param {string} chunk    Newly received text.
 * @param {number} limit    Maximum characters to retain.
 * @return {string} The text the panel should now hold.
 */
function appendBounded(previous, chunk, limit = MAX_LOG_CHARACTERS) {
	const text = `${previous ?? ''}${chunk ?? ''}`;
	if (text.length <= limit) return text;

	// Everything up to this index has to go for the result to fit; the cut then
	// moves forward to the next line boundary. Searching from one before it so a
	// boundary that already lands exactly right does not cost an extra line.
	const excess = text.length - limit;
	const boundary = text.indexOf('\n', excess - 1);
	const dropped = boundary === -1 ? '' : text.slice(boundary + 1);

	// Dropping whole lines left nothing: there is one line here and it is longer
	// than the buffer. Keep its end.
	return dropped === '' ? text.slice(text.length - limit) : dropped;
}

/**
 * How many complete lines a chunk carries, for the unread count on the tab.
 *
 * Counts terminators rather than split() parts, so a chunk that ends mid-line
 * contributes that line only once — when the rest of it arrives. Every line
 * WordPress writes through error_log() is terminated, so in practice nothing is
 * missed; the alternative over-counts a line split across two reads.
 *
 * @param {string} chunk
 * @return {number}
 */
function countLines(chunk) {
	const text = String(chunk ?? '');
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\n') count++;
	}
	return count;
}

module.exports = { MAX_LOG_CHARACTERS, appendBounded, countLines };
