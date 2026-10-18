'use strict';

/**
 * The logic behind the debug.log panel: the buffer it keeps, and which of its
 * lines count as not yet seen.
 *
 * Kept as a pure module so it can be unit tested without a DOM: the renderer
 * bundle imports it, `node --test` requires it directly (same convention as
 * dev-server-command.cjs and setup-steps.cjs).
 */

const { _n, sprintf } = require('@wordpress/i18n');

// The most the footer's badge counts to. Past it the badge says there are
// more, and the words beside it still say how many.
const MAX_BADGE_COUNT = 99;

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

/**
 * Whether debug.log's pane is in front of someone, so that a line arriving in
 * it is seen as it arrives. It is while the Logs are what the tray shows for
 * the open site and Debug.log is the tab selected in them (#558). A tab left
 * selected in a tray that is closed, or showing the terminal, or belonging to
 * a site that is not the open one, is not being read.
 *
 * @param {Object}  root0
 * @param {boolean} [root0.shown]     The site's Logs are on screen.
 * @param {string}  [root0.activeTab] The tab selected in them.
 * @return {boolean} A line arriving now is seen.
 */
function debugLogOnScreen({ shown = false, activeTab = '' } = {}) {
	return Boolean(shown) && activeTab === 'debug';
}

/**
 * How many unseen lines a chunk adds to the count. None while its pane is in
 * front of someone, and none for the backlog: what the file already held when
 * the tail started is shown, and is not news, or every start of the server
 * would report the last run's notices as unseen.
 *
 * @param {string}  chunk            What arrived.
 * @param {Object}  root0
 * @param {boolean} [root0.backlog]  The main process says the file held it before the tail started.
 * @param {boolean} [root0.onScreen] debug.log's pane is in front of someone (`debugLogOnScreen`).
 * @return {number} Lines to add.
 */
function unseenIn(chunk, { backlog = false, onScreen = false } = {}) {
	if (backlog || onScreen) return 0;
	return countLines(chunk);
}

/**
 * What the footer's Logs button says of lines not yet seen: a number to draw
 * on it, and the words that say what the number counts, which are the
 * button's description. Nothing when every line has been seen.
 *
 * @param {number} count The lines that arrived unseen.
 * @return {?{badge: string, note: string}} What to show, or null.
 */
function unseenLinesNote(count) {
	if (!Number.isInteger(count) || count <= 0) return null;
	return {
		badge: count > MAX_BADGE_COUNT ? `${MAX_BADGE_COUNT}+` : String(count),
		// translators: %d: a number of lines. "Debug.log" is the name of a tab and of the file it shows, and stays as it is.
		note: sprintf(_n('%d unseen line in Debug.log', '%d unseen lines in Debug.log', count), count)
	};
}

module.exports = { MAX_LOG_CHARACTERS, MAX_BADGE_COUNT, appendBounded, countLines, debugLogOnScreen, unseenIn, unseenLinesNote };
