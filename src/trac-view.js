'use strict';

/**
 * The embedded Trac ticket view (issue #109 / #11).
 *
 * Trac answers non-browser clients with a proof-of-work interstitial, so the
 * only way to read a ticket's attachment list is a real Chromium window where
 * the user clears the challenge once. This opens such a window, waits for the
 * real ticket page, scrapes the `#attachments` block, and closes — the window
 * is a means, not the UI. The scraped list is parsed by the pure
 * trac-attachments.cjs module and shown natively in the app.
 *
 * Security: the window renders remote, untrusted content, so it gets no preload
 * (the page cannot reach the app), runs sandboxed with context isolation, and
 * is pinned to core.trac.wordpress.org. The only thing that crosses back is the
 * `#attachments` HTML, read by the main process via executeJavaScript. A
 * downloaded attachment is likewise untrusted and flows through the same apply
 * engine (#11), which defends against path traversal.
 */

const { BrowserWindow, session } = require('electron');
const { parseAttachments, secureTracUrl } = require('./trac-attachments.cjs');
const { parseTicketInfo } = require('./trac-ticket-info.cjs');
const { httpGet } = require('./github-prs');

const TRAC_HOST = 'core.trac.wordpress.org';
const TRAC_PARTITION = 'persist:trac';
const USER_AGENT = 'WordPress-Contributor-Toolkit (+https://github.com/WordPress/experimental-wp-dev-env)';
// How long to wait for the ticket page to appear. The hashcash runs
// automatically in a few seconds; the extra headroom covers the escalated
// "I am human" checkbox, which needs a human click.
const READY_TIMEOUT_MS = 90000;
const POLL_MS = 800;

function ticketUrl(id) {
	return `https://${TRAC_HOST}/ticket/${id}`;
}

/**
 * Locks a window's webContents to the Trac host: no popups, no navigating away.
 *
 * @param {import('electron').WebContents} wc
 */
function pinToTrac(wc) {
	wc.setWindowOpenHandler(() => ({ action: 'deny' }));
	const stayOnTrac = (event, url) => {
		// Pinned to the exact https Trac origin, not just the host: a redirect or
		// <meta refresh> to http://core.trac.wordpress.org would otherwise keep
		// this window — and its session cookie — on a plaintext origin.
		if (!secureTracUrl(url)) event.preventDefault();
	};
	// will-navigate covers link clicks and script navigation; will-redirect
	// covers HTTP 3xx and <meta refresh>, which do not fire will-navigate and
	// would otherwise move this pinned window off the Trac origin.
	wc.on('will-navigate', stayOnTrac);
	wc.on('will-redirect', stayOnTrac);
}

/**
 * Opens the ticket, waits for the real page (showing the window only if the
 * challenge needs the user), scrapes the attachment list, and closes.
 *
 * @param {number|string} ticketId
 * @return {Promise<{status: string, items: Array, error?: string}>}
 */
async function openAndScrape(ticketId) {
	const id = String(ticketId).replace(/[^0-9]/g, '');
	if (!id) return { status: 'error', items: [], error: 'No ticket number' };

	const tracSession = session.fromPartition(TRAC_PARTITION);
	const win = new BrowserWindow({
		width: 1000,
		height: 800,
		show: false,
		title: `Trac #${id}`,
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			partition: TRAC_PARTITION
		}
	});
	pinToTrac(win.webContents);
	// A persistent User-Agent that identifies the app, on this session only.
	tracSession.setUserAgent(USER_AGENT);

	let shown = false;
	const showOnce = () => {
		// Once the challenge needs interaction, the window has to be visible.
		if (!shown && !win.isDestroyed()) { shown = true; win.show(); }
	};

	try {
		await win.loadURL(ticketUrl(id));

		// Poll until the real ticket page is present. The challenge page has no
		// #ticket; when the hashcash (or the user) clears it, Trac reloads to
		// the real page and #ticket appears.
		const deadline = Date.now() + READY_TIMEOUT_MS;
		let ready = false;
		while (Date.now() < deadline) {
			if (win.isDestroyed()) return { status: 'closed', items: [] };
			const hasTicket = await win.webContents.executeJavaScript('!!document.querySelector("#ticket")').catch(() => false);
			if (hasTicket) { ready = true; break; }
			showOnce();
			await new Promise((r) => setTimeout(r, POLL_MS));
		}

		if (!ready) {
			return { status: 'challenge-timeout', items: [] };
		}

		const html = await win.webContents
			.executeJavaScript('(document.querySelector("#attachments") || {}).outerHTML || ""')
			.catch(() => '');
		const items = parseAttachments(html, id);
		// The ticket's own facts ride the same visit (#292): the page is already
		// loaded and the challenge already cleared, so reading them costs
		// nothing. The description is cut before the HTML crosses out of the
		// page — it is the bulk of the block and nothing in it is parsed.
		const ticketHtml = await win.webContents
			.executeJavaScript(`(() => {
				const t = document.querySelector('#ticket');
				if (!t) return '';
				const copy = t.cloneNode(true);
				for (const el of copy.querySelectorAll('.description, form, script')) el.remove();
				return copy.outerHTML;
			})()`)
			.catch(() => '');
		const ticket = parseTicketInfo(ticketHtml);
		return { status: items.length ? 'ok' : 'no-attachments', items, ticket };
	} catch (e) {
		return { status: 'error', items: [], error: String(e && e.message ? e.message : e) };
	} finally {
		if (!win.isDestroyed()) win.destroy();
	}
}

/**
 * Downloads one attachment through the challenge-passing session, so its cookie
 * authorises the request.
 *
 * @param {string} url A raw-attachment URL on the Trac host.
 * @return {Promise<{ok: true, text: string}|{ok: false, error: string}>}
 */
async function fetchAttachment(url) {
	// Validate to the exact https Trac origin and send the normalized address,
	// not the caller's string: the request rides the session cookie, so the URL
	// fetched has to be the one that passed the check.
	const safe = secureTracUrl(url);
	if (!safe) return { ok: false, error: 'Only https core.trac.wordpress.org attachments are allowed' };

	let res;
	try {
		res = await httpGet(safe, { Accept: 'text/plain' }, { partition: TRAC_PARTITION, useSessionCookies: true });
	} catch (e) {
		return { ok: false, error: String(e && e.message ? e.message : e) };
	}
	if (res.status !== 200) {
		return { ok: false, error: `Trac returned ${res.status} — try opening the ticket again to pass the check.` };
	}
	return { ok: true, text: res.body };
}

module.exports = { openAndScrape, fetchAttachment, ticketUrl };
