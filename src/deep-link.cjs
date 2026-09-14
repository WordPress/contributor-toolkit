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

/**
 * Reads a ticket id out of a `wpct://` address, or says why it will not.
 *
 * Accepts `wpct://ticket/62281` and `wpct://ticket?id=62281`, with or without a
 * trailing slash. The host is read off the parsed URL rather than the raw
 * string so casing (`WPCT://TICKET/1`) is normalized before the comparison
 * instead of being a way around it, and an address Node cannot parse is refused
 * rather than guessed at.
 *
 * Note what a `/`-separated path buys an attacker here: nothing. The id is
 * matched as digits and nothing else, so `wpct://ticket/../../etc/passwd` fails
 * the pattern rather than being resolved as a path — this value never reaches
 * the filesystem, a shell, or `openExternal` in any case.
 *
 * @param {string} url
 * @return {{ok: true, ticket: number}|{ok: false, reason: string}}
 */
function parseDeepLink(url) {
	if (typeof url !== 'string' || url.trim() === '') {
		return { ok: false, reason: REFUSAL_REASONS.NOT_A_STRING };
	}

	let parsed;
	try {
		parsed = new URL(url);
	} catch {
		return { ok: false, reason: REFUSAL_REASONS.UNPARSEABLE };
	}

	if (parsed.protocol !== `${DEEP_LINK_SCHEME}:`) {
		return { ok: false, reason: REFUSAL_REASONS.WRONG_SCHEME };
	}

	// `wpct://ticket/1` parses with `ticket` as the host; `wpct:ticket/1`, which
	// an OS or a page could also produce, parses with an empty host and the
	// whole thing in the pathname. Only the first form is answered: one shape
	// to reason about is worth more than one more way to be reached.
	if (parsed.hostname.toLowerCase() !== TICKET_HOST) {
		return { ok: false, reason: REFUSAL_REASONS.UNKNOWN_HOST };
	}

	// A password or a username in the authority is not a ticket link. It is the
	// shape used to make an address read as one host while resolving to
	// another, and this app has no use for it.
	if (parsed.username || parsed.password) {
		return { ok: false, reason: REFUSAL_REASONS.UNKNOWN_HOST };
	}

	const fromPath = /^\/?(\d+)\/?$/.exec(parsed.pathname);
	const raw = fromPath ? fromPath[1] : parsed.searchParams.get('id');
	if (typeof raw !== 'string' || !/^\d+$/.test(raw)) {
		return { ok: false, reason: REFUSAL_REASONS.NOT_A_TICKET };
	}

	// The app's one definition of a valid ticket, which is also where the upper
	// bound on the id lives.
	const ref = parseTicketRef(raw);
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
 * `take()` clears the ticket, so it is delivered once. A page reloaded *after*
 * that and before the contributor answers has lost it — the app offers no
 * reload, so that costs a ticket only under devtools, and holding it until an
 * answer would mean a second channel for "answered" to keep the two sides in
 * step.
 *
 * @return {{hold: (ticket: number) => void, markReady: () => void, reset: () => void, take: () => number|null, waiting: () => number|null}}
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
		take() {
			if (!ready || pending === null) return null;
			const ticket = pending;
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
