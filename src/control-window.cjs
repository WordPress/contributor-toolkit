'use strict';

// How the main process asks the window to do something a tool asked for
// (#764).
//
// A tool that changes a site does not call the handlers the window calls. The
// work a button starts is sequenced in the window: it takes the terminal's
// lock, pauses the build watch, installs and rebuilds after a change, and
// then says on the page what happened. A second caller in the main process
// would do the Git or the spawn and none of that, and the window would not
// know. So the request is handed to the window, which does what a press of
// its own button does and answers when that has ended, the way the window is
// already handed the list of sites to start again at launch (`sites:resume`).
//
// This module is the waiting: which request is out, whether a page is there
// to hear one, and what becomes of a request when the page goes away. No
// Electron import; `send` is `webContents.send` in the app.

const REFUSALS = {
	NOT_READY: { ok: false, code: 'window-not-ready', error: 'The WordPress Contributor Toolkit window did not open in time. Open it and try again.' },
	GONE: { ok: false, code: 'window-closed', error: 'The WordPress Contributor Toolkit window was closed or reloaded before it answered.' },
	UNREADABLE: { ok: false, code: 'invalid-reply', error: 'The WordPress Contributor Toolkit window gave an answer that could not be read.' }
};

// How long a page that is loading has to say it is listening.
const READY_TIMEOUT_MS = 30000;

/**
 * @param {Object}                    root0
 * @param {(request: Object) => void} root0.send         Delivers a request to the window's page; throws if there is no page.
 * @param {() => string}              root0.newId        An id no other request out has.
 * @param {Function}                  [root0.setTimer]
 * @param {Function}                  [root0.clearTimer]
 * @return {{markReady: () => void, reset: () => void, ask: (request: Object, options?: Object) => Promise<Object>, answer: (id: string, reply: *) => boolean, pending: () => number}}
 */
function createWindowRequests({ send, newId, setTimer = setTimeout, clearTimer = clearTimeout }) {
	let ready = false;
	const waitingForReady = new Set();
	const out = new Map();

	return {
		// The page has subscribed. Called once per load.
		markReady() {
			ready = true;
			for (const proceed of [...waitingForReady]) proceed(true);
		},
		// A new page is loading, or the window is gone: nobody is listening,
		// and whoever was asked will not answer.
		reset() {
			ready = false;
			for (const [id, resolve] of [...out]) {
				out.delete(id);
				resolve(REFUSALS.GONE);
			}
		},
		/**
		 * Asks the window and resolves with its reply. Never rejects: a window
		 * that is not there is a reply too. There is no limit on how long the
		 * window takes to answer, since what it was asked for may be a build;
		 * the limit is on how long a page takes to be there at all.
		 *
		 * @param {Object} request                  `{ action, sitePath, params }`.
		 * @param {Object} [options]
		 * @param {number} [options.readyTimeoutMs]
		 * @return {Promise<Object>} `{ok: true, result}` or `{ok: false, code, error}`.
		 */
		async ask(request, { readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
			if (!ready) {
				const listening = await new Promise((resolve) => {
					const proceed = (answer) => {
						clearTimer(timer);
						waitingForReady.delete(proceed);
						resolve(answer);
					};
					const timer = setTimer(() => proceed(false), readyTimeoutMs);
					waitingForReady.add(proceed);
				});
				if (!listening) return REFUSALS.NOT_READY;
			}
			const id = newId();
			const reply = new Promise((resolve) => out.set(id, resolve));
			try {
				send({ id, ...request });
			} catch {
				out.delete(id);
				return REFUSALS.GONE;
			}
			return reply;
		},
		/**
		 * The window's answer to request `id`. One answer per request: an id
		 * that is not out, or was answered already, changes nothing.
		 *
		 * @param {string} id
		 * @param {*}      reply
		 * @return {boolean} Whether a request was waiting for it.
		 */
		answer(id, reply) {
			const resolve = out.get(id);
			if (!resolve) return false;
			out.delete(id);
			const readable = reply && typeof reply === 'object' && typeof reply.ok === 'boolean' && (reply.ok || typeof reply.code === 'string');
			resolve(readable ? reply : REFUSALS.UNREADABLE);
			return true;
		},
		pending: () => out.size
	};
}

module.exports = { REFUSALS, READY_TIMEOUT_MS, createWindowRequests };
