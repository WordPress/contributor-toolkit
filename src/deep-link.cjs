// The gate in front of the one address the outside world can send this app.
//
// Registering a URL scheme opens a door that nothing else in this app has: a
// string chosen by a web page, handed to the app by the operating system, with
// no user gesture the app can see and no origin it can check. Any page the
// contributor visits can navigate to `wpct://…`, and on Windows and Linux the
// string arrives as a command-line argument, in the same argv the app reads its
// own switches from.
//
// So the rule here is the narrowest one that still does the job: exactly one
// host, `ticket`, and exactly one payload, a ticket id. Not a path, not a site,
// not a file. Everything else is refused and logged through describeRefused,
// the same shape as external-url.js and site-registry.js — a pure parser with
// no Electron import, so both branches are testable without an Electron
// process.
//
// The id itself is not validated here. `parseTicketRef` in
// renderer/trac-ticket.cjs is the app's one answer to "is this a ticket", used
// by the ticket panel and by `sites:set-ticket`; a second definition living
// here is how the two would come to disagree.

const { parseTicketRef } = require('./renderer/trac-ticket.cjs');
const { describeRefused } = require('./safe-log');

const DEEP_LINK_SCHEME = 'wpct';
const DEEP_LINK_PREFIX = `${DEEP_LINK_SCHEME}://`;

// The only host this app answers. A second verb (open a site, apply a patch)
// would be a second entry here, and each one is a new thing a web page can ask
// for — add one only after asking what a hostile page does with it.
const TICKET_HOST = 'ticket';

// Every `reason` a refusal can carry. Same convention as REVEAL_REASONS in
// site-registry.js: these are for the log and for tests, never for a
// contributor, who sees the app do nothing at all.
const REFUSAL_REASONS = {
	NOT_A_STRING: 'not-a-string',
	WRONG_SCHEME: 'wrong-scheme',
	UNPARSEABLE: 'unparseable',
	UNKNOWN_HOST: 'unknown-host',
	NOT_A_TICKET: 'not-a-ticket'
};

// The whole grammar, matched against the address exactly as it arrived.
//
// Anchored and literal on purpose. Reading the parts off `new URL()` instead
// means the accepted address and the address that was checked are two different
// strings: the URL parser resolves `..` before anything here sees the path, so
// `wpct://ticket/62281/../9` becomes ticket 9, and it strips tabs and newlines
// from the middle of a scheme, so `wp<TAB>ct://ticket/1` validates as this one.
// Neither is dangerous — a ticket id is all that ever comes out — but each is
// an address the app answers and does not document, and the point of a boundary
// is that it is exactly as wide as it says.
//
// Case-insensitive because an OS may hand the scheme or the host back in any
// case. A trailing slash because an address bar tends to add one.
const DEEP_LINK_PATTERN = new RegExp(`^${DEEP_LINK_SCHEME}://${TICKET_HOST}/(\\d+)/?$`, 'i');

/**
 * Why an address that is not a ticket link is not one — for the log line, never
 * for a contributor. Best-effort and after the fact: the accept decision is
 * `DEEP_LINK_PATTERN` above and nothing else, so this only has to name which
 * way the address missed.
 *
 * @param {string} url
 * @return {string} One of REFUSAL_REASONS.
 */
function refusalReason(url) {
	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return REFUSAL_REASONS.UNPARSEABLE;
	}
	if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) return REFUSAL_REASONS.WRONG_SCHEME;
	// Userinfo is the shape used to make an address read as one host while
	// resolving to another, so it is named as a host problem rather than as a
	// malformed ticket.
	if (parsed.username || parsed.password) return REFUSAL_REASONS.UNKNOWN_HOST;
	if (parsed.hostname.toLowerCase() !== TICKET_HOST) return REFUSAL_REASONS.UNKNOWN_HOST;
	return REFUSAL_REASONS.NOT_A_TICKET;
}

/**
 * Reads a ticket id out of a `wpct://` address, or says why it will not.
 *
 * The one accepted form is `wpct://ticket/62281`, with or without a trailing
 * slash. There is deliberately no `?id=` form: nothing produces one, and a
 * second spelling is a second thing to be sure about.
 *
 * The id is checked against the app's own `parseTicketRef` rather than a second
 * definition of what a ticket is — which is also where the upper bound lives.
 *
 * @param {string} url
 * @return {{ok: true, ticket: number}|{ok: false, reason: string}}
 */
function parseDeepLink(url) {
	if (typeof url !== 'string' || url.trim() === '') {
		return { ok: false, reason: REFUSAL_REASONS.NOT_A_STRING };
	}

	const match = DEEP_LINK_PATTERN.exec(url);
	if (!match) return { ok: false, reason: refusalReason(url) };

	const ref = parseTicketRef(match[1]);
	if (!ref.ok) return { ok: false, reason: REFUSAL_REASONS.NOT_A_TICKET };

	return { ok: true, ticket: ref.id };
}

/**
 * The `wpct://` member of a command line, or null.
 *
 * This is how the address arrives on Windows and Linux — appended to argv, next
 * to Electron's own switches and, on a cold start, next to the path of the app
 * itself. The first match wins: a second one is not a second request to honour,
 * it is someone trying their luck.
 *
 * @param {string[]} argv
 * @return {string|null}
 */
function pickDeepLinkArg(argv) {
	if (!Array.isArray(argv)) return null;
	for (const arg of argv) {
		if (typeof arg !== 'string') continue;
		if (arg.toLowerCase().startsWith(DEEP_LINK_PREFIX)) return arg;
	}
	return null;
}

/**
 * The whole intake, kept out of main.js so both branches can be tested without
 * an Electron process: `onTicket` is the send to the renderer in the app and a
 * recording stub in the tests, `onRefused` the log line.
 *
 * A refusal is logged rather than shown. The contributor did not type this
 * address, so there is nothing for them to correct, and an app that pops a
 * dialog on demand from any page is its own small nuisance.
 *
 * @param {string}                                                                      url
 * @param {{onTicket: (ticket: number) => void, onRefused?: (message: string) => void}} effects
 * @return {boolean} True when a ticket was delivered.
 */
function handleDeepLink(url, { onTicket, onRefused } = {}) {
	const result = parseDeepLink(url);
	if (!result.ok) {
		if (typeof onRefused === 'function') {
			onRefused(`${result.reason}: ${describeRefused(url)}`);
		}
		return false;
	}
	onTicket(result.ticket);
	return true;
}

/**
 * The one slot a ticket waits in between arriving and being delivered.
 *
 * On a cold start the address is in hand before there is a renderer to hear it,
 * and `webContents.send` to a page that has not finished loading is dropped
 * without a sound — silently losing the link, which is the failure this whole
 * flow is most likely to have. So the ticket is held until the renderer says it
 * has subscribed, and the two facts that decide delivery, "is one waiting" and
 * "is anyone listening", live here rather than as a pair of `let`s in main.js
 * where no test can reach them.
 *
 * One slot, not a queue of many: two links clicked before the app is up are one
 * contributor changing their mind, and the last one is the answer.
 *
 * `deliver` clears the ticket only once the send has actually returned, so a
 * window that closes mid-flight leaves the ticket where it was rather than
 * consuming it into a failed send. Taking first and sending after is the same
 * class of bug as the loading-page one above, in a narrower window.
 *
 * What it deliberately does not survive is a page reloaded *after* a successful
 * delivery and before the contributor answers. The app offers no reload, so
 * that costs a ticket only under devtools, and holding it until an answer would
 * mean a second channel for "answered" to keep the two sides in step.
 *
 * @return {{hold: (ticket: number) => void, markReady: () => void, reset: () => void, deliver: (send: (ticket: number) => void) => number|null, waiting: () => number|null}}
 */
function createDeepLinkQueue() {
	let pending = null;
	let ready = false;

	return {
		hold(ticket) { pending = ticket; },
		// The renderer has subscribed. Called once per load.
		markReady() { ready = true; },
		// A new page is loading: whatever is waiting keeps waiting, but there is
		// nobody to send it to until that page subscribes in its turn.
		reset() { ready = false; },
		/**
		 * Hands the waiting ticket to `send`, and forgets it only if that
		 * returns. A `send` that throws leaves the ticket here, for the next
		 * window or the next `markReady`, and the throw goes to the caller to
		 * log — losing a ticket quietly is the one outcome this whole module
		 * exists to prevent.
		 *
		 * @param {(ticket: number) => void} send
		 * @return {number|null} The ticket delivered, or null if there was none.
		 */
		deliver(send) {
			if (!ready || pending === null) return null;
			const ticket = pending;
			send(ticket);
			pending = null;
			return ticket;
		},
		waiting() { return pending; }
	};
}

module.exports = {
	DEEP_LINK_SCHEME,
	REFUSAL_REASONS,
	parseDeepLink,
	pickDeepLinkArg,
	handleDeepLink,
	createDeepLinkQueue
};
