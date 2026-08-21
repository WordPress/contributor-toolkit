'use strict';

/**
 * Reading a log pane as coloured lines.
 *
 * The Server and debug.log panes are where a contributor finds out why the site
 * is broken, and both arrive as one undifferentiated wall: a fatal, a notice and
 * the line saying the server is up all weigh exactly the same. Severity is the
 * one thing worth answering at a glance, so that is all this classifies.
 *
 * Same shape as diff-highlight.cjs, and for the same reason: the first words of
 * a line are the whole grammar here. There is no PHP parser and no dependency —
 * what is being read is the severity and the file that raised it, not the
 * language. Pure and DOM-free so `node --test` can require it; the renderer
 * turns the classified lines into spans and owns every colour.
 */

// The prefix error_log() writes, e.g. `[11-Aug-2026 10:02:11 UTC]`. Anchored and
// specific about its shape so a log line that merely opens with a bracket — a
// var_dump of an array, a tool that prefixes `[info]` — is not mistaken for one
// and dimmed away.
const LOG_TIMESTAMP = /^\[\d{1,2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2}[^\]]*\]/;

// Past this many lines, only the tail is classified and everything older is
// returned as one plain string. A log grows for as long as the server runs, so
// the diff pane's answer — stop colouring entirely once it is large — would mean
// the colour disappears exactly when a session gets long enough to need it. The
// element count React reconciles per chunk is what has to stay bounded, not the
// text, and the tail is the part anyone is looking at.
const MAX_HIGHLIGHTED_LINES = 2000;

/**
 * The `[timestamp]` prefix and the rest of the line, so the pane can dim one
 * without dimming the other. `stamp` is empty when the line carries none, which
 * is every line of the server's own output.
 *
 * @param {string} line
 * @return {{stamp: string, rest: string}}
 */
function splitStamp(line) {
	// The `\r` of a CRLF stream is dropped here rather than at the point of
	// comparison, because the pane renders `rest` inside a block-level span under
	// `white-space: pre-wrap` — where a lone CR is a second segment break, and
	// every line on Windows would gain a blank one after it. It survived the old
	// pane only because a single text node normalises CRLF to one break.
	const text = String(line ?? '').replace(/\r$/, '');
	const match = text.match(LOG_TIMESTAMP);
	if (!match) return { stamp: '', rest: text };
	return { stamp: match[0], rest: text.slice(match[0].length) };
}

/**
 * What a single log line is.
 *
 * Classified on the text after the timestamp, so `[…] PHP Warning: …` is a
 * warning rather than something starting with a bracket. `trace` covers the
 * continuation lines that belong to the entry above — the stack frames, the
 * `thrown in`, node's `(Use \`…\` to show where the warning was created)` —
 * which are the bulk of the noise in a full pane and say nothing on their own.
 *
 * @param {string} line
 * @return {'fatal'|'warning'|'deprecated'|'notice'|'trace'|'ready'|'plain'}
 */
function classifyLogLine(line) {
	const { rest } = splitStamp(line);
	const text = rest.trim();
	if (text === '') return 'plain';

	// Before the severity checks: a stack frame quotes the line that raised the
	// error, so `#3 … Uncaught Error` would read as a second fatal and a pane
	// full of one error would look like a pane full of many.
	if (/^#\d+\s/.test(text)) return 'trace';
	// Both spellings: an uncaught error's own trace is introduced by a bare
	// `Stack trace:` on the line after the fatal, and PHP's own trace logging
	// prefixes it like every other line it writes.
	if (text.startsWith('Stack trace:') || text.startsWith('PHP Stack trace:')) return 'trace';
	if (text.startsWith('thrown in ')) return 'trace';
	if (text.startsWith('(Use `')) return 'trace';

	// Both spellings of every level, and all four levels either way. PHP writes
	// the `PHP ` prefix through error_log() and drops it when the same message
	// goes to stdout — so matching the prefixed form only for some levels would
	// colour a server pane's fatals while leaving its deprecations plain, which
	// are the ones a contributor is usually there to read.
	if (/^(PHP )?(Fatal error|Parse error)\b/.test(text)) return 'fatal';
	if (/^(PHP )?Warning\b/.test(text)) return 'warning';
	if (/^(PHP )?Deprecated\b/.test(text)) return 'deprecated';
	if (/^(PHP )?Notice\b/.test(text)) return 'notice';
	// Node's own throw, and the second line of a PHP fatal that wrapped.
	if (/^(Uncaught |Error: )/.test(text)) return 'fatal';

	// The server pane, where the output is npm's and node's rather than PHP's.
	// `DeprecationWarning` is named rather than matched loosely: it arrives
	// behind node's own `(node:123) [DEP0180] ` prefix, and the general rules
	// above stay anchored so a line that merely mentions a warning is not
	// painted as one. A pane that states a severity the line does not have is
	// worse than a pane with no colour.
	if (text.startsWith('npm error') || text.startsWith('npm ERR!')) return 'fatal';
	if (text.startsWith('npm warn') || text.startsWith('npm WARN')) return 'warning';
	if (/\bDeprecationWarning:/.test(text)) return 'warning';

	// The one line in a server log anybody is waiting for.
	if (text.startsWith('Ready!') || text.startsWith('SERVER_URL:')) return 'ready';
	if (text.includes('WordPress is running on')) return 'ready';

	return 'plain';
}

/**
 * The log, line by line, each with its severity and its timestamp split off.
 *
 * Returns null when there is nothing to paint, so the caller can render its own
 * empty state. `head` holds the lines older than `limit` as a single string: no
 * colour, but no per-line element either, which is what keeps a long-running
 * pane cheap to re-render on every arriving chunk.
 *
 * The tail is found by walking back over `limit` newlines rather than splitting
 * the whole buffer, so the work per arriving chunk is proportional to what gets
 * painted and not to how long the server has been running. Splitting first cost
 * two passes over the entire log — one string allocated per line, then the head
 * joined back into a copy — on every chunk of a buffer that only grows.
 *
 * `head` carries no trailing newline: the first classified line is rendered as
 * a block, which starts its own line, and a preserved `\n` under `pre-wrap`
 * would put a blank one at the seam. So the log is `head`, a newline, then the
 * lines joined — not a plain concatenation.
 *
 * @param {string} text
 * @param {number} limit Lines to classify, counted from the end.
 * @return {{head: string, lines: Array<{stamp: string, text: string, kind: string}>}|null}
 */
function highlightLog(text, limit = MAX_HIGHLIGHTED_LINES) {
	if (typeof text !== 'string' || text === '') return null;

	// Where the last `limit` lines begin, or -1 when the log is shorter than that
	// and there is no head at all.
	let cut = text.length;
	for (let seen = 0; seen < limit; seen++) {
		const boundary = text.lastIndexOf('\n', cut - 1);
		if (boundary === -1) {
			cut = -1;
			break;
		}
		cut = boundary;
	}

	const head = cut === -1 ? '' : text.slice(0, cut);
	const tail = cut === -1 ? text : text.slice(cut + 1);

	const lines = tail.split('\n').map((line) => {
		const { stamp, rest } = splitStamp(line);
		return { stamp, text: rest, kind: classifyLogLine(line) };
	});

	return { head, lines };
}

module.exports = { LOG_TIMESTAMP, MAX_HIGHLIGHTED_LINES, splitStamp, classifyLogLine, highlightLog };
