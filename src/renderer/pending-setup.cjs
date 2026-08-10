// The row for a site that is being created, while it is being created.
//
// The window has to draw one before it can know where the site will be. The
// contributor picked a parent directory and typed a name; the main process is
// the one that turns those into a directory, and it may not use the name it was
// given — `findAvailableDirName` appends `-2` when the folder already exists.
// So the row starts on a guess.
//
// A guess was harmless while it was only a label. It stopped being harmless
// when the guards started keying on the directory the app actually created
// (#180): the row hands its path to `dir:show` and `editor:open`, so on a
// collision it was asking about a folder the app had never made, and being
// refused for it. Worse, when the guessed name belongs to a *different*
// registered site, it is asking about that one.
//
// Main reports the real path on its first status event, minutes before the
// clone ends. Adopting it there makes the row honest for the whole clone — the
// path under the title included, which until now simply read wrong.
//
// The three moves are here, and pure, because there were three divergent copies
// of them in the component and because adopting earlier is what makes the third
// one dangerous: the discard branch used to filter the guessed path, which was
// only ever safe because the swap could not have happened yet.
//
// Every function returns new state and leaves its argument alone — these feed
// React setState updaters, which may run more than once.
'use strict';

/**
 * The optimistic row, before the main process has answered.
 *
 * @param {{sites: string[], siteMeta: Object}}              state
 * @param {{path: string, label: string, createdAt: string}} site
 * @return {{sites: string[], siteMeta: Object}}
 */
function beginSetup({ sites, siteMeta }, { path, label, createdAt }) {
	return {
		sites: sites.includes(path) ? sites : [...sites, path],
		siteMeta: {
			...siteMeta,
			[path]: {
				...(siteMeta[path] || {}),
				label,
				createdAt: siteMeta[path]?.createdAt || createdAt,
				initialized: false
			}
		}
	};
}

/**
 * Moves the row from the guessed path to the one the app created.
 *
 * Everything the contributor supplied moves with it, `createdAt` included:
 * losing that would drop the row to the bottom of a sidebar sorted by it, in
 * the middle of watching the site being made.
 *
 * @param {{sites: string[], siteMeta: Object}} state
 * @param {{from: string, to: string}}          move
 * @return {{sites: string[], siteMeta: Object}} The same state when there is
 *   nothing to move — main reports the path more than once per setup.
 */
function adoptSetupPath(state, { from, to }) {
	if (from === to) return state;
	if (!state.sites.includes(from)) return state;

	const kept = state.siteMeta[from];
	const siteMeta = { ...state.siteMeta };
	delete siteMeta[from];

	const withoutGuess = state.sites.filter((p) => p !== from);
	return {
		sites: withoutGuess.includes(to) ? withoutGuess : [...withoutGuess, to],
		siteMeta: { ...siteMeta, [to]: { ...(siteMeta[to] || {}), ...kept } }
	};
}

/**
 * Drops the row for a setup that failed.
 *
 * The caller passes the path the row currently has, not the one it started
 * with. That distinction is the whole reason this is not a one-liner at the
 * call site: after an adoption the guess no longer exists, and filtering it
 * would leave the real row behind for a directory whose setup just failed.
 *
 * @param {{sites: string[], siteMeta: Object}} state
 * @param {string}                              path
 * @return {{sites: string[], siteMeta: Object}}
 */
function discardSetup(state, path) {
	const siteMeta = { ...state.siteMeta };
	delete siteMeta[path];
	return { sites: state.sites.filter((p) => p !== path), siteMeta };
}

/**
 * The path the in-flight row should move to for a status event, or null when it
 * should stay where it is.
 *
 * Extracted from the subscription because the decision, not the reducer, is
 * where this went wrong. The reducer is new code that no old test could have
 * failed on; what #180's collision case actually needed was *which* event to
 * believe, and a first version that believed any event whose target differed
 * let a finishing setup's `done` drag a second setup's row onto its own path.
 *
 * `cloning` is the one event that announces the directory and arrives exactly
 * once per setup, so it is the only one that moves a row. Everything else — no
 * setup in flight, a later phase, a target that is already the row's — is "stay
 * put", returned as null rather than as a path equal to the current one, so the
 * caller cannot accidentally treat it as a move.
 *
 * @param {?string} currentPath Where the in-flight row is now, or null.
 * @param {?Object} status      A download:status payload from the main process.
 * @return {?string}
 */
function rowPathAfterStatus(currentPath, status) {
	if (typeof currentPath !== 'string' || currentPath === '') return null;
	if (!status || status.phase !== 'cloning') return null;
	if (typeof status.target !== 'string' || status.target === '') return null;
	return status.target === currentPath ? null : status.target;
}

module.exports = { beginSetup, adoptSetupPath, discardSetup, rowPathAfterStatus };
