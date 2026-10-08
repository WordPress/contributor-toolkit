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
 * after a word that says why (FAILURES!, ERRORS!, WARNINGS!, OK, but
 * incomplete…), or with `No tests executed!` when nothing matched.
 *
 * @param {string} output What the run printed, or its last few thousand characters.
 * @return {?{tests: number, failures: number, errors: number, warnings: number, skipped: number, incomplete: number}} Null when there is no summary.
 */
function phpunitSummary(output) {
	const text = String(output || '').replace(ANSI, '');
	const ok = [...text.matchAll(/^OK \((\d+) tests?, \d+ assertions?\)/gm)].pop();
	const counts = [...text.matchAll(/^Tests: (\d+), Assertions: \d+(.*)$/gm)].pop();
	const empty = text.lastIndexOf('No tests executed!');
	const last = Math.max(ok ? ok.index : -1, counts ? counts.index : -1, empty);
	const none = { tests: 0, failures: 0, errors: 0, warnings: 0, skipped: 0, incomplete: 0 };
	if (last === -1) return null;
	if (last === empty) return none;
	if (ok && last === ok.index) return { ...none, tests: Number(ok[1]) };
	const count = (name) => {
		const match = new RegExp(`${name}: (\\d+)`).exec(counts[2]);
		return match ? Number(match[1]) : 0;
	};
	return {
		tests: Number(counts[1]),
		failures: count('Failures'),
		errors: count('Errors'),
		warnings: count('Warnings'),
		skipped: count('Skipped'),
		incomplete: count('Incomplete')
	};
}

/**
 * The dot and the sentence for the last run, or for none.
 *
 * A run with failures or errors is red. One where nothing failed is green,
 * even when PHPUnit exited non-zero over a warning, and the sentence says how
 * many tests passed out of how many, and why the rest did not: skipped or
 * incomplete, or warned about. A run that never started, or was stopped, says
 * so rather than reading as a result.
 *
 * @param {?{running: boolean, code?: ?number, stopped?: boolean, notStarted?: boolean, output?: string}} run The last run on this site, null before the first.
 * @return {{status: string, text: string}} `status` is the dot's: offline, busy, online or failed.
 */
function phpunitResult(run) {
	if (!run) return { status: 'offline', text: __('Not run yet.') };
	if (run.running) return { status: 'busy', text: __('Running…') };
	if (run.notStarted) return { status: 'failed', text: __('The tests could not be started.') };
	if (run.stopped) return { status: 'offline', text: __('Stopped before it finished.') };
	const summary = phpunitSummary(run.output);
	if (!summary) {
		// translators: %s: the code the run exited with, a number.
		return { status: 'failed', text: sprintf(__('The run did not finish (exit code %s).'), String(run.code)) };
	}
	if (summary.tests === 0) return { status: 'offline', text: __('No tests matched.') };
	const failed = summary.failures + summary.errors;
	if (failed > 0) {
		return {
			status: 'failed',
			// translators: 1: how many tests failed. 2: how many tests ran.
			text: sprintf(_n('%1$d of %2$d tests failed.', '%1$d of %2$d tests failed.', failed), failed, summary.tests)
		};
	}
	const notRun = summary.skipped + summary.incomplete;
	const passed = summary.tests - notRun - summary.warnings;
	const sentences = [];
	if (passed === summary.tests) {
		// translators: %d: how many tests passed.
		sentences.push(sprintf(_n('%d test passed.', '%d tests passed.', passed), passed));
	} else {
		// translators: 1: how many tests passed. 2: how many tests ran.
		sentences.push(sprintf(_n('%1$d of %2$d test passed.', '%1$d of %2$d tests passed.', summary.tests), passed, summary.tests));
	}
	// translators: %d: how many tests were skipped or left incomplete.
	if (notRun) sentences.push(sprintf(_n('%d skipped.', '%d skipped.', notRun), notRun));
	// translators: %d: how many tests PHPUnit warned about.
	if (summary.warnings) sentences.push(sprintf(_n('%d had a warning.', '%d had warnings.', summary.warnings), summary.warnings));
	return { status: 'online', text: sentences.join(' ') };
}

module.exports = { phpunitSummary, phpunitResult };
