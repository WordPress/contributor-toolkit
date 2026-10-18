'use strict';

const { __, _x, sprintf } = require('@wordpress/i18n');

// What a site with an incomplete build/ is told to do, wherever it is told:
// the sentence after the one that says the site still runs the old assets.
function rebuildAdvice() {
	// translators: %s: the command that builds the site, npm run build.
	return sprintf(__('Start the build watch, or run %s in the Terminal.'), 'npm run build');
}

/**
 * Whether the build watch is still compiling a change that was just handed
 * to it, so the screen can say so (#492).
 *
 * A patch or pull request applied while the watch runs gets no build of its
 * own: the checkout happens and the watch recompiles what changed (#262). On
 * Core that takes a second; Gutenberg's `npm run dev` takes seconds per
 * package. Neither watcher prints a line when it is done again (wp-build
 * prints one `✅ package (…ms)` per package and then nothing; grunt prints
 * `Waiting...`), so "done" is the watch's output going quiet: `quietMs` of
 * silence after the hand-off, or after the last line it printed, whichever
 * is later. A change the watch has nothing to compile (PHP only) clears
 * after the same `quietMs` with no output at all.
 *
 * The watch's first line can arrive late: chokidar waits for writes to
 * settle, and a large checkout on a slow disk takes a while to write. Output
 * within `graceMs` of the hand-off therefore reopens a window that the quiet
 * rule had already closed, so the banner does not say "done" as the rebuild
 * starts. Output later than that is some other rebuild's.
 *
 * Pure: the clock is injected so the suite can drive it.
 *
 * @param {{quietMs?: number, graceMs?: number}} [options]
 * @return {{handOff: (now: number) => void, output: (now: number) => void, clear: () => void, isCompiling: (now: number) => boolean, settlesAt: () => number|null}}
 */
function createWatchActivity({ quietMs = 3000, graceMs = 15000 } = {}) {
	let handOffAt = null;
	let lastActivity = null;
	return {
		// A change was just left to the watch.
		handOff(now) {
			handOffAt = now;
			lastActivity = now;
		},
		// The watch printed something. Counts while a hand-off is open, and
		// reopens one that the quiet rule closed within the grace period.
		output(now) {
			if (handOffAt === null) return;
			if (now - handOffAt >= graceMs && !(now - lastActivity < quietMs)) return;
			if (now > lastActivity) lastActivity = now;
		},
		// The watch stopped, paused or exited: nothing is compiling.
		clear() {
			handOffAt = null;
			lastActivity = null;
		},
		isCompiling(now) {
			return lastActivity !== null && now - lastActivity < quietMs;
		},
		// When the current hand-off counts as done if nothing else is printed,
		// or null when nothing is compiling.
		settlesAt() {
			return lastActivity === null ? null : lastActivity + quietMs;
		}
	};
}

/**
 * The line the applied banner shows while the watch compiles the change.
 *
 * @return {string}
 */
function compilingMessage() {
	return __('The build watch is still compiling this change. Wait for it to go quiet before trying the site.');
}

/**
 * What the applied banner says about the watch, or null when nothing needs
 * saying. Two stretches matter:
 *
 * - The watch is rebuilding from scratch ('building'): a pull-request checkout
 *   pauses it for the app's own build and resumes it after, and on Gutenberg
 *   the resumed `npm run dev` removes build/ and rebuilds for about 20 s,
 *   during which the site answers with the "requires files to be built"
 *   notice (#489). The banner is up by then, so it has to say so.
 * - The watch is compiling a change handed to it (`compiling`, above).
 *
 * @param {string}  watchState 'idle' | 'building' | 'watching' | 'paused' | 'exited'
 * @param {boolean} compiling  from createWatchActivity().isCompiling
 * @return {string|null}
 */
function watchBusyMessage(watchState, compiling) {
	if (watchState === 'building') return __('The build watch is rebuilding after this change. Wait for it to be watching again before trying the site.');
	if (watchState === 'watching' && compiling) return compilingMessage();
	return null;
}

/**
 * What the terminal says at each way an apply can end, for what was done:
 * one set of whole sentences for each of the five things the chain does, as
 * `applyDoneMessage` in confirmations.cjs has, since a translation cannot
 * splice a verb or a noun into the English order.
 *
 * - `tryIt`: done and built, "open the site to try it out".
 * - `settled`: done, and nothing more, for when the site is not ready yet.
 * - `compiling`: done, and the running watch is compiling it.
 * - `ready`: done, and the resumed watch has rebuilt.
 * - `installing`: what was done changes the lockfile, so an install runs.
 * - `buildFailed`, `installFailed`: the chain's own build or install failed.
 * - `watchStopped`, `watchFailed`: the watch the build was left to was
 *   stopped, or stopped before it finished; `rebuildAdvice` follows these.
 *
 * @param {string} verb 'Applied', 'Reverted', 'Checked out', 'Restored'
 * @param {string} noun 'patch', 'pull request', 'previous branch', 'saved work'
 * @return {{tryIt: string, settled: string, compiling: string, ready: string, installing: string, buildFailed: string, installFailed: string, watchStopped: string, watchFailed: string}}
 */
function applyLines(verb, noun) {
	switch (`${verb} ${noun}`) {
		case 'Reverted patch':
			return {
				tryIt: __('Reverted — open the site to try it out.'),
				settled: __('Reverted.'),
				compiling: __('Reverted — The build watch is still compiling this change. Wait for it to go quiet before trying the site.'),
				ready: __('Reverted — the build watch has rebuilt. Open the site to try it out.'),
				// translators: 1: the file dependencies are locked in, package-lock.json. 2: the command that installs them, npm install.
				installing: sprintf(__('The patch changes %1$s — running %2$s…'), 'package-lock.json', 'npm install'),
				buildFailed: __('The patch is reverted but the build failed, so the site still runs the old assets.'),
				// translators: %s: the command that installs dependencies, npm install.
				installFailed: sprintf(__('%s failed, so the build was skipped. The patch is reverted but dependencies are stale.'), 'npm install'),
				watchStopped: __('The patch is reverted but the build watch was stopped, so the site still runs the old assets.'),
				watchFailed: __('The patch is reverted but the build watch stopped before it finished rebuilding, so the site still runs the old assets.')
			};
		case 'Checked out pull request':
			return {
				tryIt: __('Checked out — open the site to try it out.'),
				settled: __('Checked out.'),
				compiling: __('Checked out — The build watch is still compiling this change. Wait for it to go quiet before trying the site.'),
				ready: __('Checked out — the build watch has rebuilt. Open the site to try it out.'),
				// translators: 1: the file dependencies are locked in, package-lock.json. 2: the command that installs them, npm install.
				installing: sprintf(__('The pull request changes %1$s — running %2$s…'), 'package-lock.json', 'npm install'),
				buildFailed: __('The pull request is checked out but the build failed, so the site still runs the old assets.'),
				// translators: %s: the command that installs dependencies, npm install.
				installFailed: sprintf(__('%s failed, so the build was skipped. The pull request is checked out but dependencies are stale.'), 'npm install'),
				watchStopped: __('The pull request is checked out but the build watch was stopped, so the site still runs the old assets.'),
				watchFailed: __('The pull request is checked out but the build watch stopped before it finished rebuilding, so the site still runs the old assets.')
			};
		case 'Restored previous branch':
			return {
				tryIt: _x('Restored — open the site to try it out.', 'the previous branch'),
				settled: _x('Restored.', 'the previous branch'),
				compiling: _x('Restored — The build watch is still compiling this change. Wait for it to go quiet before trying the site.', 'the previous branch'),
				ready: _x('Restored — the build watch has rebuilt. Open the site to try it out.', 'the previous branch'),
				// translators: 1: the file dependencies are locked in, package-lock.json. 2: the command that installs them, npm install.
				installing: sprintf(__('The previous branch changes %1$s — running %2$s…'), 'package-lock.json', 'npm install'),
				buildFailed: __('The previous branch is restored but the build failed, so the site still runs the old assets.'),
				// translators: %s: the command that installs dependencies, npm install.
				installFailed: sprintf(__('%s failed, so the build was skipped. The previous branch is restored but dependencies are stale.'), 'npm install'),
				watchStopped: __('The previous branch is restored but the build watch was stopped, so the site still runs the old assets.'),
				watchFailed: __('The previous branch is restored but the build watch stopped before it finished rebuilding, so the site still runs the old assets.')
			};
		case 'Restored saved work':
			return {
				tryIt: _x('Restored — open the site to try it out.', 'the saved work'),
				settled: _x('Restored.', 'the saved work'),
				compiling: _x('Restored — The build watch is still compiling this change. Wait for it to go quiet before trying the site.', 'the saved work'),
				ready: _x('Restored — the build watch has rebuilt. Open the site to try it out.', 'the saved work'),
				// translators: 1: the file dependencies are locked in, package-lock.json. 2: the command that installs them, npm install.
				installing: sprintf(__('The saved work changes %1$s — running %2$s…'), 'package-lock.json', 'npm install'),
				buildFailed: __('The saved work is restored but the build failed, so the site still runs the old assets.'),
				// translators: %s: the command that installs dependencies, npm install.
				installFailed: sprintf(__('%s failed, so the build was skipped. The saved work is restored but dependencies are stale.'), 'npm install'),
				watchStopped: __('The saved work is restored but the build watch was stopped, so the site still runs the old assets.'),
				watchFailed: __('The saved work is restored but the build watch stopped before it finished rebuilding, so the site still runs the old assets.')
			};
		case 'Applied patch':
		default:
			return {
				tryIt: __('Applied — open the site to try it out.'),
				settled: __('Applied.'),
				compiling: __('Applied — The build watch is still compiling this change. Wait for it to go quiet before trying the site.'),
				ready: __('Applied — the build watch has rebuilt. Open the site to try it out.'),
				// translators: 1: the file dependencies are locked in, package-lock.json. 2: the command that installs them, npm install.
				installing: sprintf(__('The patch changes %1$s — running %2$s…'), 'package-lock.json', 'npm install'),
				buildFailed: __('The patch is applied but the build failed, so the site still runs the old assets.'),
				// translators: %s: the command that installs dependencies, npm install.
				installFailed: sprintf(__('%s failed, so the build was skipped. The patch is applied but dependencies are stale.'), 'npm install'),
				watchStopped: __('The patch is applied but the build watch was stopped, so the site still runs the old assets.'),
				watchFailed: __('The patch is applied but the build watch stopped before it finished rebuilding, so the site still runs the old assets.')
			};
	}
}

/**
 * The terminal line that ends an apply, given what the watch is doing once it
 * has been resumed. An apply that ran the app's own build ends on "open the
 * site to try it out"; when the resumed watch is rebuilding from scratch that
 * is not yet true, so the line is swapped for `settled`, the same line without
 * the invitation, and the rebuilding line follows instead of contradicting it.
 *
 * @param {string} message    the line the apply would print on its own
 * @param {string} watchState the watch state after the resume
 * @param {string} [settled]  the line to print instead while the watch rebuilds
 * @return {string}
 */
function applyFinishMessage(message, watchState, settled = message) {
	const busy = watchBusyMessage(watchState, false);
	if (!busy) return message;
	return `${settled}${busy}\n`;
}

/**
 * What an apply says when it leaves the one build to the watch it paused
 * (#506): a watch that rebuilds build/ from scratch when it resumes makes a
 * build of the apply's own redundant, so the apply resumes it and waits for
 * its ready line before confirming. `waits` is false when there is no paused
 * watch to resume (stopped by hand while the apply ran), and then `stopped`
 * is the whole story; otherwise `ready` is the line for the ready pattern and
 * `failed` the line for a watch that exits before it.
 *
 * @param {string} verb       'Checked out', 'Restored', 'Applied', 'Reverted'
 * @param {string} noun       'pull request', 'previous branch', 'saved work', 'patch'
 * @param {string} watchState the watch state at the hand-off
 * @return {{waits: boolean, stopped?: string, ready?: string, failed?: string}}
 */
function resumedWatchHandOff(verb, noun, watchState) {
	const lines = applyLines(verb, noun);
	if (watchState !== 'paused') {
		return { waits: false, stopped: `\n${lines.watchStopped} ${rebuildAdvice()}\n` };
	}
	return {
		waits: true,
		ready: `\n${lines.ready}\n`,
		failed: `\n${lines.watchFailed} ${rebuildAdvice()}\n`
	};
}

/**
 * The trunk update's version of the hand-off above (#507). Same trigger: the
 * watch paused for the reset rebuilds build/ from scratch as it resumes, so the
 * update leaves the one build to it. The difference is what the outcome means:
 * an update is not complete until build/ matches the new source, so the ready
 * line is where "Update complete" and the persisted marker go, and a watch that
 * exits first leaves the update incomplete, with the same banner and retry the
 * chain's own failed build would leave. `waits` is false when no paused watch
 * will resume (stopped by hand during the install), and then `stopped` is the
 * whole story.
 *
 * @param {string} watchState the watch state at the hand-off
 * @return {{waits: boolean, stopped?: string, ready?: string, failed?: string}}
 */
function resumedWatchUpdateHandOff(watchState) {
	const retry = __('The code is new but the built assets are old; retry install & build from the banner above.');
	if (watchState !== 'paused') {
		return { waits: false, stopped: `\n${__('Update incomplete — the build watch was stopped, so nothing rebuilt.')} ${retry}\n` };
	}
	return {
		waits: true,
		ready: `\n${__('Update complete — the build watch has rebuilt, and this site is now on the latest trunk.')}\n`,
		failed: `\n${__('Update incomplete — the build watch stopped before it finished rebuilding.')} ${retry}\n`
	};
}

/**
 * The applied banner for a checked-out pull request, following the watch the
 * way the terminal line does (#509). Green said "ready to try" while the
 * resumed watch was still rebuilding build/ (eight minutes on Windows), so the
 * colour now waits for the ready line:
 *
 * - 'building': the watch is rebuilding from scratch. Amber, and Revert
 *   carries the same wait reason the ticket actions carry during a build.
 * - 'unbuilt': the watch stopped or exited before its ready line, so build/
 *   is incomplete (`buildInterrupted`, cleared by the next ready line or a
 *   successful build). Red; the way out is the one the terminal names.
 * - 'ready': the site is built. Green, with the #492 compiling line as the
 *   body while a hand-off is still open.
 *
 * `title` is the headline; `body` is null when nothing needs saying.
 * `revertReason` is why Revert waits, or null: the rebuild while the watch
 * is building, otherwise `actionsReason`, the gate every ticket action shares
 * (an install, a build of the app's own, a trunk update). The two never
 * hold at once, since each of those pauses the watch, so the first is not
 * hiding the second.
 *
 * @param {{number: number|string, watchState: string, compiling: boolean, buildInterrupted: boolean, actionsReason?: string|null}} input
 * @return {{tone: 'building'|'unbuilt'|'ready', title: string, body: string|null, revertReason: string|null}}
 */
function appliedBannerState({ number, watchState, compiling, buildInterrupted, actionsReason = null }) {
	if (watchState === 'building') {
		return {
			tone: 'building',
			// translators: %s: the number of the pull request.
			title: sprintf(__('PR #%s is applied. The site is rebuilding.'), number),
			body: watchBusyMessage('building', compiling),
			revertReason: __('Wait for the build to finish.')
		};
	}
	if (buildInterrupted) {
		return {
			tone: 'unbuilt',
			// translators: %s: the number of the pull request.
			title: sprintf(__('PR #%s is applied but not built.'), number),
			body: `${__('The build watch stopped before it finished rebuilding, so the site still runs the old assets.')} ${rebuildAdvice()}`,
			revertReason: actionsReason
		};
	}
	return {
		tone: 'ready',
		// translators: %s: the number of the pull request.
		title: sprintf(__('PR #%s is applied.'), number),
		body: watchBusyMessage(watchState, compiling),
		revertReason: actionsReason
	};
}

module.exports = { createWatchActivity, compilingMessage, watchBusyMessage, applyLines, applyFinishMessage, resumedWatchHandOff, resumedWatchUpdateHandOff, appliedBannerState };
