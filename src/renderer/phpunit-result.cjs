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
 * @param {?{running: boolean, code?: ?number, stopped?: boolean, notStarted?: boolean, output?: string}} run                The last run on this site, null before the first.
 * @param {Object}                                                                                        [options]
 * @param {boolean}                                                                                       [options.onTicket] Whether the checkout is a ticket's branch, where a failure may be the change's or the setup's, and comparing with trunk tells which. On trunk there is no change to compare with.
 * @return {{status: string, outcome: string, text: string}} `status` is the dot's: offline, busy, online or failed. `outcome` is what the Tests section shows the sentence as: none before a run, running, pass, fail when tests failed, or notice when the run gave no result to count (it did not start, was stopped, did not finish, or matched no tests).
 */
function phpunitResult(run, { onTicket = false } = {}) {
	// Before a run, what the first one costs: it is minutes, not seconds, and
	// nothing else says why.
	if (!run) return { status: 'offline', outcome: 'none', text: [__('Not run yet.'), __('The first run on a site installs PHPUnit, which takes a few minutes, and the whole suite takes about 10.')].join(' ') };
	if (run.running) return { status: 'busy', outcome: 'running', text: __('Running…') };
	if (run.notStarted) return { status: 'failed', outcome: 'notice', text: __('The tests could not be started.') };
	if (run.stopped) return { status: 'offline', outcome: 'notice', text: __('Stopped before it finished.') };
	const summary = phpunitSummary(run.output);
	if (!summary) {
		// translators: %s: the code the run exited with, a number.
		return { status: 'failed', outcome: 'notice', text: sprintf(__('The run did not finish (exit code %s).'), String(run.code)) };
	}
	if (summary.tests === 0) return { status: 'offline', outcome: 'notice', text: __('No tests matched.') };
	const failed = summary.failures + summary.errors;
	if (failed > 0) {
		// translators: 1: how many tests failed. 2: how many tests ran.
		const sentences = [sprintf(_n('%1$d of %2$d test failed.', '%1$d of %2$d tests failed.', summary.tests), failed, summary.tests)];
		// A red result reads as "this is broken", but this setup is not core's:
		// some tests fail here on trunk (SQLite, the bundled PHP). On a ticket's
		// branch, where it reads as "your change broke it", it also says how to
		// tell.
		sentences.push(__('These run on SQLite and the app\'s own PHP, not MySQL, so some of core\'s tests fail here even on trunk.'));
		if (onTicket) sentences.push(__('Run a failing test on trunk to compare.'));
		return { status: 'failed', outcome: 'fail', text: sentences.join(' ') };
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
	return { status: 'online', outcome: 'pass', text: sentences.join(' ') };
}

/**
 * The Tests section's last run: the dot and the sentence, and the command it
 * was, empty before the first. A run on another branch than the one checked
 * out is no run here: its result is the other branch's, not this one's.
 *
 * @param {?{command: string, branch?: ?string}} run              As phpunitResult takes it, with the branch it ran on.
 * @param {Object}                               [options]        As phpunitResult takes them.
 * @param {?string}                              [options.branch] The branch checked out now.
 * @return {{command: string, status: string, outcome: string, text: string}} The section's `lastRun`.
 */
function phpunitLastRun(run, { branch = null, ...options } = {}) {
	const current = run && (run.branch || null) === branch ? run : null;
	return { command: current ? current.command : '', ...phpunitResult(current, options) };
}

module.exports = { phpunitSummary, phpunitResult, phpunitLastRun };
