'use strict';

/**
 * Keeps the app's main window on the app's own page.
 *
 * The main window is the one window with the preload bridge, and a preload
 * runs on whatever page its window loads. So where this window may go is a
 * security boundary and not a matter of taste: the bridge is for the app's
 * own page and for no other. The rule here is therefore the narrow one. The
 * window never leaves the page the app loaded into it, and never opens a
 * second one.
 *
 * It is also what #284 asks for. A link the contributor follows belongs in
 * their browser, where there is an address bar and a back button, so an
 * address this window refuses to go to is handed to `openInBrowser`, which is
 * the external-url.js gate in the app: http and https reach the browser, and
 * anything else is refused and logged there.
 *
 * trac-view.js pins its window the same way, to the Trac origin.
 */

function withoutFragment(url) {
	const hash = url.indexOf('#');
	return hash === -1 ? url : url.slice(0, hash);
}

/**
 * Whether an address is the page the window is already showing. A page that
 * reloads itself asks to navigate to its own address, and that is staying.
 * Both strings come from Chromium, so they are compared as it wrote them.
 *
 * @param {string} url
 * @param {string} current
 * @return {boolean}
 */
function isCurrentPage(url, current) {
	// Anything that is not an address is not this page: an event this function
	// cannot read is one the window does not follow.
	if (typeof url !== 'string' || typeof current !== 'string') return false;
	return withoutFragment(url) === withoutFragment(current);
}

/**
 * Pins a window's webContents to the page loaded into it: no navigating away,
 * no redirect away, no new windows.
 *
 * @param {import('electron').WebContents} wc
 * @param {Object}                         deps
 * @param {(url: string) => void}          deps.openInBrowser Offers a refused address to the system browser. It
 *                                                            decides what may be opened and reports its own failures:
 *                                                            the events below cannot wait for an answer.
 */
function pinToOwnPage(wc, { openInBrowser }) {
	// Middle click, Shift or Cmd/Ctrl+click, target="_blank", window.open. A
	// second window is never this app's interface, whatever the address is.
	wc.setWindowOpenHandler(({ url }) => {
		openInBrowser(url);
		return { action: 'deny' };
	});

	const stayOnOwnPage = (event) => {
		if (isCurrentPage(event.url, wc.getURL())) return;
		event.preventDefault();
		openInBrowser(event.url);
	};
	// A link, a form or a <meta refresh> in the page.
	wc.on('will-navigate', stayOnOwnPage);
	// The HTTP 3xx a navigation can turn into on the way. Unlike will-navigate
	// it is also sent for a frame inside the page, and a frame redirecting is
	// not the window leaving: what a frame may load is the content security
	// policy's to say, and its address is not one to hand to the browser.
	wc.on('will-redirect', (event) => {
		if (event.isMainFrame) stayOnOwnPage(event);
	});
}

module.exports = { pinToOwnPage };
