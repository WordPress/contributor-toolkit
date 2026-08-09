'use strict';

/**
 * The two rules behind the command hints under the Terminal (#182): whether to
 * offer them at all, and whether the prompt is free to take one.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as setup-steps.cjs and dev-server-command.cjs).
 */

/**
 * Whether the hints belong on screen yet.
 *
 * Both commands they name are things you do *again*, after a site is built and
 * you have started changing it. Before that they are not merely premature but
 * wrong: during the clone the terminal is streaming `Updating workdir n/6987`,
 * `npm install` has not run a first time, and there is no checkout to have
 * changed files in. A completed build is the point where re-running either one
 * becomes the normal thing to do, so it is the point where they appear.
 *
 * The checklist owns the first run of both commands and says so in its own
 * steps; these hints exist for everything after it.
 *
 * @param {Object}  flags
 * @param {boolean} [flags.hasBuilt] The site has a completed build on disk.
 * @return {boolean} True when the hints should be rendered.
 */
function shouldShowTerminalHints(flags = {}) {
	return Boolean(flags.hasBuilt);
}

/**
 * Whether the Terminal is occupied, and so cannot take a prefilled command.
 *
 * The hints offer to type `npm run build` / `npm install` at the prompt, which
 * is only honest while the prompt is free. Getting this predicate wrong in the
 * permissive direction is what makes them dead controls: the click is refused
 * by the prompt's own guard, so a link that looks enabled does nothing at all.
 *
 * Two independent families of flag have to be consulted, which is the whole
 * reason this is not a one-liner at the call site:
 *
 * - `terminalRunning` mirrors the terminal state machine's own `running` flag.
 *   That flag lives in a ref, so React never re-renders on it; the renderer
 *   keeps a state copy in step with every write. It is the only thing that
 *   covers a command the contributor typed themselves — and `npm run watch`,
 *   `dev` and `grunt` never exit, so a gap here persists for the session.
 * - `installing` / `building` are set by the setup checklist's buttons, which
 *   stream into the terminal without ever claiming the prompt. Nothing in
 *   `terminalRunning` sees them.
 *
 * The remaining flags name flows that do set `terminalRunning` today. They are
 * listed anyway rather than trusted transitively: a future path that sets one
 * without claiming the prompt would otherwise reopen exactly the hole this
 * module exists to close.
 *
 * @param {Object}  flags
 * @param {boolean} [flags.terminalRunning] A command typed at the prompt, or any
 *                                          flow that claimed it, is running.
 * @param {boolean} [flags.installing]      The checklist's npm install is running.
 * @param {boolean} [flags.building]        The checklist's npm run build is running.
 * @param {boolean} [flags.starting]        The dev server is starting.
 * @param {boolean} [flags.running]         The dev server and its watcher are up.
 * @param {boolean} [flags.isUpdating]      The trunk-update chain owns the terminal.
 * @param {boolean} [flags.isApplying]      The apply-patch chain owns the terminal.
 * @return {boolean} True when the prompt is not free.
 */
function computeTerminalBusy(flags = {}) {
	return Boolean(
		flags.terminalRunning
		|| flags.installing
		|| flags.building
		|| flags.starting
		|| flags.running
		|| flags.isUpdating
		|| flags.isApplying
	);
}

module.exports = { shouldShowTerminalHints, computeTerminalBusy };
