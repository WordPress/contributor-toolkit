// Keeps the app window on its own page, and links opening in the contributor's
// browser (#284).
//
// Each link cancels its own navigation in its onClick handler. That covers a
// plain click, but a middle click fires `auxclick`, which a click handler never
// sees — so Chromium's "open in a new window" default ran and the site loaded
// inside a bare app window with no address bar. Cmd/Ctrl+click was fine, since
// that does arrive as a click the handler can cancel.
//
// Refusing once for the whole window fixes it for every link, including ones
// added later. The window refuses to go anywhere and refuses to open children;
// an http/https address goes out through external-url.js instead, the same gate
// the renderer's own openExternal calls use.
//
// The refusal is a default, not a list of cases: this window renders content the
// app does not author — captured email bodies among it — and a link in there can
// point anywhere, including at a path relative to the app's own file: origin.
// Only a reload is let through. `pinToTrac` in trac-view.js is the same idea for
// the window that shows Trac.

const { openExternalUrl } = require('./external-url');

/**
 * Holds a window on its current page and sends links out to the browser.
 *
 * @param {import('electron').WebContents} wc
 * @param {Object}                         [deps] Passed through to openExternalUrl: `openExternal`,
 *                                                `onRefused`, `onFailed`.
 */
function openLinksExternally(wc, deps = {}) {
	// These events are synchronous and ignore what the handler returns, so the
	// hand-off cannot be awaited. openExternalUrl reports its own refusals and
	// failures, so this catch is only there for a reporter that itself throws,
	// which must not surface as an unhandled rejection.
	const handOff = (url) => {
		Promise.resolve(openExternalUrl(url, deps)).catch(() => {});
	};

	// Middle click, Cmd/Ctrl+click, target="_blank", window.open. A child window
	// is never this app's UI, so it is denied whatever the address is.
	wc.setWindowOpenHandler(({ url }) => {
		handOff(url);
		return { action: 'deny' };
	});

	// A click no handler cancelled, or a script navigation. Everything is
	// refused except a reload, which asks to navigate to the page already
	// loaded — denying that one would stop the window reloading. The address is
	// then offered to the browser, where external-url.js refuses anything
	// outside http/https and logs it.
	const stayPut = (event, url) => {
		if (url === wc.getURL()) return;
		event.preventDefault();
		handOff(url);
	};
	// will-navigate is the click. will-redirect is the 3xx or <meta refresh>
	// that does not fire it, and would otherwise move the window.
	wc.on('will-navigate', stayPut);
	wc.on('will-redirect', stayPut);
}

module.exports = { openLinksExternally };
