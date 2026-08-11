'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { splitStamp, classifyLogLine, highlightLog } = require('../src/renderer/log-highlight.cjs');

const STAMP = '[11-Aug-2026 10:02:11 UTC]';

test('classifyLogLine: each PHP level keeps its own severity through the timestamp', () => {
	assert.strictEqual(classifyLogLine(`${STAMP} PHP Fatal error:  Uncaught Error: Call to a member function get() on null`), 'fatal');
	assert.strictEqual(classifyLogLine(`${STAMP} PHP Parse error:  syntax error, unexpected ';'`), 'fatal');
	assert.strictEqual(classifyLogLine(`${STAMP} PHP Warning:  Undefined variable $x`), 'warning');
	assert.strictEqual(classifyLogLine(`${STAMP} PHP Deprecated:  Creation of dynamic property`), 'deprecated');
	assert.strictEqual(classifyLogLine(`${STAMP} PHP Notice:  Function _load_textdomain_just_in_time was called incorrectly`), 'notice');
	assert.strictEqual(classifyLogLine(`${STAMP} a bare error_log() call`), 'plain');
});

// A frame quotes the line that raised the error, so matching severities first
// would turn one fatal into a pane full of them.
test('classifyLogLine: the lines belonging to the entry above recede', () => {
	// An uncaught error's own trace is introduced by a bare `Stack trace:` on the
	// line after the fatal — the spelling a real WordPress debug.log carries.
	assert.strictEqual(classifyLogLine('Stack trace:'), 'trace');
	assert.strictEqual(classifyLogLine('PHP Stack trace:'), 'trace');
	assert.strictEqual(classifyLogLine('#0 /wp/src/wp-includes/class-wp-hook.php(324): my_fn()'), 'trace');
	assert.strictEqual(classifyLogLine('#3 {main}'), 'trace');
	// The reason the trace checks come first: a frame quotes the call that raised
	// the error, so matching severity first would turn one fatal into a pane
	// full of them.
	assert.strictEqual(classifyLogLine('#0 /wp/src/wp-includes/class-wp-hook.php(324): trigger(): Uncaught Error: x'), 'trace');
	assert.strictEqual(classifyLogLine('  thrown in /wp/src/wp-content/themes/x/functions.php on line 42'), 'trace');
	assert.strictEqual(classifyLogLine('(Use `WordPress Contributor Toolkit --trace-deprecation ...` to show where the warning was created)'), 'trace');
});

// PHP drops the `PHP ` prefix when the same message goes to stdout instead of
// through error_log(), and a pane that colours the fatals but not the
// deprecations is worse than one that colours neither.
test('classifyLogLine: a level is a level with or without the PHP prefix', () => {
	assert.strictEqual(classifyLogLine('Fatal error: Uncaught Error: x in /wp/src/x.php:3'), 'fatal');
	assert.strictEqual(classifyLogLine('Warning: Undefined variable $x in /wp/src/x.php on line 3'), 'warning');
	assert.strictEqual(classifyLogLine('Deprecated: Creation of dynamic property in /wp/src/x.php on line 3'), 'deprecated');
	assert.strictEqual(classifyLogLine('Notice: Function was called incorrectly in /wp/src/x.php on line 3'), 'notice');
});

// The one thing colour must not do is claim a severity the line does not have.
test('classifyLogLine: a line that merely mentions a level is not that level', () => {
	assert.strictEqual(classifyLogLine(`${STAMP} checking for Warning: in the response body`), 'plain');
	assert.strictEqual(classifyLogLine('wrote /wp/src/wp-content/plugins/Fatal error: handler.php'), 'plain');
});

test('classifyLogLine: the server pane speaks npm and node, not PHP', () => {
	assert.strictEqual(classifyLogLine('(node:55626) [DEP0180] DeprecationWarning: fs.Stats constructor is deprecated.'), 'warning');
	assert.strictEqual(classifyLogLine('npm error code EBADENGINE'), 'fatal');
	assert.strictEqual(classifyLogLine('npm warn deprecated glob@7.2.3'), 'warning');
	assert.strictEqual(classifyLogLine('added 733 packages in 41s'), 'plain');
});

test('classifyLogLine: the line the contributor is waiting for is the one that stands out', () => {
	assert.strictEqual(classifyLogLine('Ready! WordPress is running on http://127.0.0.1:9400 (6 workers)'), 'ready');
	assert.strictEqual(classifyLogLine('SERVER_URL:http://127.0.0.1:9400/'), 'ready');
});

test('classifyLogLine: a CRLF line ending does not change what a line is', () => {
	assert.strictEqual(classifyLogLine(`${STAMP} PHP Warning:  Undefined variable $x\r`), 'warning');
	assert.strictEqual(classifyLogLine('Ready! WordPress is running on http://127.0.0.1:9400\r'), 'ready');
});

// Not cosmetic: each line is rendered as its own block under `white-space:
// pre-wrap`, where a lone CR left on the end is a second line break — so a
// Windows log would come out double-spaced.
test('highlightLog: a Windows line ending does not survive into the text', () => {
	const painted = highlightLog('one\r\ntwo\r\n');
	assert.deepStrictEqual(painted.lines.map((l) => l.text), ['one', 'two', '']);
});

test('splitStamp: only an actual error_log() timestamp is dimmed away', () => {
	assert.deepStrictEqual(splitStamp(`${STAMP} PHP Warning:  x`), { stamp: STAMP, rest: ' PHP Warning:  x' });
	// Server output carries none, and a line that merely opens with a bracket —
	// a var_dump, a tool prefixing its own tag — is not one.
	assert.deepStrictEqual(splitStamp('Ready! WordPress is running'), { stamp: '', rest: 'Ready! WordPress is running' });
	assert.deepStrictEqual(splitStamp('[info] building'), { stamp: '', rest: '[info] building' });
	assert.deepStrictEqual(splitStamp('[0] => wp-login.php'), { stamp: '', rest: '[0] => wp-login.php' });
});

test('highlightLog: nothing to paint is the caller\'s own empty state', () => {
	assert.strictEqual(highlightLog(''), null);
	assert.strictEqual(highlightLog(undefined), null);
});

test('highlightLog: a short log is classified whole, with no plain head', () => {
	const painted = highlightLog(`Ready! WordPress is running\n${STAMP} PHP Notice:  x\n`);
	assert.strictEqual(painted.head, '');
	// The trailing newline makes a final empty line, which still occupies one.
	assert.deepStrictEqual(painted.lines.map((l) => l.kind), ['ready', 'notice', 'plain']);
	assert.strictEqual(painted.lines[1].stamp, STAMP);
});

// The colour has to survive a long session: a server running all afternoon must
// not end up with a pane that has quietly stopped highlighting.
test('highlightLog: past the cap only the head goes plain, and the tail is what is kept', () => {
	const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
	lines.push('Ready! WordPress is running');
	const painted = highlightLog(lines.join('\n'), 10);

	assert.strictEqual(painted.lines.length, 10);
	assert.strictEqual(painted.lines.at(-1).kind, 'ready');
	assert.ok(painted.head.startsWith('line 0\n'));
	// No trailing newline on the head: the first classified line is a block of
	// its own, and a preserved one would show as a blank line at the seam.
	assert.ok(painted.head.endsWith('line 20'));
	// Nothing is dropped and nothing is duplicated: head, a newline, then the
	// lines, is the log exactly.
	assert.strictEqual(`${painted.head}\n${painted.lines.map((l) => l.stamp + l.text).join('\n')}`, lines.join('\n'));
});
