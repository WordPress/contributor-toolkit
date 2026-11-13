// The one `electron-store` instance the app has, behind a seam tests can reach.
//
// `electron-store` is ESM-only, so main.js loaded it with a dynamic `import()`.
// That import is invisible to `Module._load`, which is what tests/unit/ipc-wiring.test.cjs
// uses to stand in for a module — so every handler that read the store was
// unreachable from that suite, and the delete handler's registry gate could be cut
// without failing anything (#145). Keeping the import in a module of its own means
// the harness replaces this file instead of trying to intercept the ESM loader.
//
// The import starts on first use rather than at require time. Deferring it costs
// nothing — the first use is after the app is ready, when main reads the
// language chosen (#559) — and it keeps a rejected promise nobody is awaiting
// yet out of module load, where the app has no way to report it. It also keeps
// the ESM loader from pulling in `electron` behind `Module._load`'s back, which
// is what lets that suite require main.js outside an Electron process at all.

let store;
let storeReady = null;

async function getStore() {
	if (!store) {
		if (!storeReady) {
			storeReady = import('electron-store').then((m) => {
				const Store = m.default || m;
				store = new Store({
					name: 'settings',
					// `preferences` is app-wide rather than per-site: who the
					// contributor is and where they are contributing from are facts
					// about them, asked once, not properties of each checkout.
					defaults: { sites: [], siteMeta: {}, preferences: {} }
				});
				// Before anyone else holds the store, so no handler can read
				// the old shape and nothing yields between this read and write.
				const siteMeta = store.get('siteMeta');
				const lifted = liftUpdateIncomplete(siteMeta);
				if (lifted !== siteMeta) store.set('siteMeta', lifted);
			});
		}
		await storeReady;
	}
	return store;
}

/**
 * Moves the incomplete-update flag that versions up to 2.0.0 kept per branch
 * onto the site, where it lives now (#475). It describes the one node_modules
 * and build/ every branch of a site shares, so a `true` on any branch means
 * the site's build is behind. Lifting one that was stale costs at most one
 * extra rebuild prompt; dropping one that was real leaves new code over old
 * assets with nothing saying so.
 *
 * @param {Object} siteMeta The stored `siteMeta` map, keyed by site path.
 * @return {Object} The same object when nothing needed moving, a new one otherwise.
 */
function liftUpdateIncomplete(siteMeta) {
	let changed = false;
	const next = {};
	for (const [sitePath, record] of Object.entries(siteMeta || {})) {
		const branches = (record && record.branches) || {};
		const carrying = Object.keys(branches).filter((ref) => branches[ref] && 'updateIncomplete' in branches[ref]);
		if (carrying.length === 0) {
			next[sitePath] = record;
			continue;
		}
		changed = true;
		const cleaned = { ...branches };
		for (const ref of carrying) {
			cleaned[ref] = { ...cleaned[ref] };
			delete cleaned[ref].updateIncomplete;
		}
		next[sitePath] = {
			...record,
			branches: cleaned,
			updateIncomplete: Boolean(record.updateIncomplete) || carrying.some((ref) => branches[ref].updateIncomplete === true)
		};
	}
	return changed ? next : siteMeta;
}

/**
 * The store, where it has already been made, or null: for the one caller
 * that cannot wait, the quit, which runs in a handler that is not awaited
 * (#559). By then the store has been read for the locale at startup.
 *
 * @return {?Object}
 */
function peekStore() {
	return store || null;
}

module.exports = { getStore, peekStore, liftUpdateIncomplete };
