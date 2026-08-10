// The one `electron-store` instance the app has, behind a seam tests can reach.
//
// `electron-store` is ESM-only, so main.js loaded it with a dynamic `import()`.
// That import is invisible to `Module._load`, which is what test/ipc-wiring.test.cjs
// uses to stand in for a module — so every handler that read the store was
// unreachable from that suite, and the delete handler's registry gate could be cut
// without failing anything (#145). Keeping the import in a module of its own means
// the harness replaces this file instead of trying to intercept the ESM loader.
//
// The import starts on first use rather than at require time. Deferring it costs
// nothing — no handler can run before a window exists — and it keeps a rejected
// promise nobody is awaiting yet out of module load, where the app has no way to
// report it. It also keeps the ESM loader from pulling in `electron` behind
// `Module._load`'s back, which is what lets that suite require main.js outside an
// Electron process at all.

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
			});
		}
		await storeReady;
	}
	return store;
}

module.exports = { getStore };
