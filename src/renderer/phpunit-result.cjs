'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');

/**
 * What the Tests section says about the last PHP unit test run: the dot beside
 * its heading and the sentence under it.
 *
 * The run is read from two things: the code the run ended with, and PHPUnit's
 * own summary, the last lines it prints. The code alone says pass or fail but
 * not how many; the summary alone cannot tell a run that ended from one that
 * was cut short after printing one. A run stopped with Ctrl+C is neither.
 */

// Colour codes PHPUnit puts around its summary when it writes to a terminal.
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * PHPUnit's summary, from the end of what a run printed. PHPUnit 9 ends with
 * `OK (25 tests, 34 assertions)` when everything passed, and otherwise with a
 * line such as `Tests: 2133, Assertions: 1118406, Failures: 4, Skipped: 2.`
 * after a word that says why (FAILURES!, ERRORS!, OK, but incomplete…), or
 * with `No tests executed!` when nothing matched.
 *
 * @param {string} output What the run printed, or its last few thousand characters.
 * @return {?{tests: number, failures: number, errors: number, skipped: number}} Null when there is no summary.
 */
function phpunitSummary(output) {
	const text = String(output || '').replace(ANSI, '');
	const ok = [...text.matchAll(/^OK \((\d+) tests?, \d+ assertions?\)/gm)].pop();
	const counts = [...text.matchAll(/^Tests: (\d+), Assertions: \d+(.*)$/gm)].pop();
	const empty = text.lastIndexOf('No tests executed!');
	const last = Math.max(ok ? ok.index : -1, counts ? counts.index : -1, empty);
	if (last === -1) return null;
	if (last === empty) return { tests: 0, failures: 0, errors: 0, skipped: 0 };
	if (ok && last === ok.index) return { tests: Number(ok[1]), failures: 0, errors: 0, skipped: 0 };
	const count = (name) => {
		const match = new RegExp(`${name}: (\\d+)`).exec(counts[2]);
		return match ? Number(match[1]) : 0;
	};
	return { tests: Number(counts[1]), failures: count('Failures'), errors: count('Errors'), skipped: count('Skipped') };
}

/**
 * The dot and the sentence for the last run, or for none.
 *
 * @param {?{running: boolean, code?: ?number, stopped?: boolean, output?: string}} run The last run on this site, null before the first.
 * @return {{status: string, text: string}} `status` is the dot's: offline, busy, online or failed.
 */
function phpunitResult(run) {
	if (!run) return { status: 'offline', text: __('Not run yet.') };
	if (run.running) return { status: 'busy', text: __('Running…') };
	if (run.stopped) return { status: 'offline', text: __('Stopped before it finished.') };
	const summary = phpunitSummary(run.output);
	if (summary && summary.tests === 0) return { status: 'offline', text: __('No tests matched.') };
	if (summary && run.code === 0) {
		// translators: %d: how many tests passed.
		const passed = sprintf(_n('%d test passed.', '%d tests passed.', summary.tests), summary.tests);
		// translators: %d: how many tests were skipped.
		return { status: 'online', text: summary.skipped ? `${passed} ${sprintf(_n('%d skipped.', '%d skipped.', summary.skipped), summary.skipped)}` : passed };
	}
	if (summary && summary.failures + summary.errors > 0) {
		const failed = summary.failures + summary.errors;
		return {
			status: 'failed',
			// translators: 1: how many tests failed. 2: how many tests ran.
			text: sprintf(_n('%1$d of %2$d tests failed.', '%1$d of %2$d tests failed.', failed), failed, summary.tests)
		};
	}
	// translators: %s: the code the run exited with, a number.
	return { status: 'failed', text: sprintf(__('The run did not finish (exit code %s).'), String(run.code)) };
}

module.exports = { phpunitSummary, phpunitResult };
