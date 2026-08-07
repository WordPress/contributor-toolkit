'use strict';

/**
 * Reading a unified diff as coloured lines (issue #166).
 *
 * The patch pane is where a first-time contributor checks their own work before
 * sending it anywhere, and a wall of monospace makes the two questions that
 * matter — what did I add, what did I remove — into a character-by-character
 * hunt. Colour answers both at a glance.
 *
 * A diff needs no language parsing for this: the first character of each line
 * is the whole grammar. So there is no syntax highlighter here and no
 * dependency; PHP inside the patch stays uncoloured, which is the right
 * trade — what is being reviewed is the change, not the language.
 *
 * Pure and DOM-free so `node --test` can require it: the renderer turns the
 * classified lines into spans, and this file decides nothing about colour.
 */

// Lines that describe the patch rather than the code: the separator and file
// names jsdiff emits, and the git forms a downloaded PR or Trac attachment
// arrives with.
const META_PREFIXES = [
	'diff --git ',
	'index ',
	'Index:',
	'new file mode',
	'deleted file mode',
	'old mode',
	'new mode',
	'rename from',
	'rename to',
	'similarity index',
	'GIT binary patch',
	'Binary files'
];

// Past this, colouring stops and the pane renders as plain text. One element
// per line is cheap until it is thousands of them, and a patch that large is
// not being read line by line anyway.
const MAX_HIGHLIGHTED_LINES = 4000;

/**
 * What a single line of a patch is.
 *
 * `header` is this app's own provenance block (#166) — the only lines that
 * start with `#` at column 0, since every line of the diff proper starts with a
 * space, a `+`, a `-`, a `@` or one of the meta prefixes.
 *
 * @param {string} line
 * @return {'header'|'hunk'|'meta'|'add'|'del'|'context'}
 */
function classifyLine(line) {
	if (line.startsWith('#')) return 'header';
	if (line.startsWith('@@')) return 'hunk';
	// Before the add/delete check: `---` and `+++` are file names, not a removed
	// and an added line, and colouring them as changes is the classic way a diff
	// view lies about its first two rows.
	if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('===')) return 'meta';
	if (META_PREFIXES.some((prefix) => line.startsWith(prefix))) return 'meta';
	if (line.startsWith('+')) return 'add';
	if (line.startsWith('-')) return 'del';
	return 'context';
}

/**
 * The patch, line by line, each with what it is. Returns null when the text is
 * too long to be worth painting — the caller renders it as-is.
 *
 * @param {string} text
 * @return {Array<{text: string, kind: string}>|null}
 */
function highlightDiff(text) {
	if (typeof text !== 'string' || text === '') return null;

	const lines = text.split('\n');
	if (lines.length > MAX_HIGHLIGHTED_LINES) return null;

	return lines.map((line) => ({ text: line, kind: classifyLine(line) }));
}

module.exports = {
	META_PREFIXES,
	MAX_HIGHLIGHTED_LINES,
	classifyLine,
	highlightDiff
};
