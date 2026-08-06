'use strict';

/**
 * Reading what a contributor typed when asked which Trac ticket they are
 * working on (issue #109). They arrive from a browser, so the input is as
 * likely to be a pasted URL — with a comment anchor, a trailing slash or a
 * ?format= query still attached — as it is a bare number.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly
 * (same convention as setup-steps.cjs and update-plan.cjs).
 */

const TRAC_HOST = 'core.trac.wordpress.org';

// Core is in the 60,000s and climbing slowly. Seven digits is far past any
// real ticket, so it rejects a pasted timestamp or phone number while leaving
// decades of headroom.
const MAX_TICKET_ID = 9999999;

const NOT_A_TICKET = 'Enter a ticket number like 62281, or a core.trac.wordpress.org ticket URL.';

/**
 * Canonical URL for a ticket id.
 *
 * @param {number|string} id
 */
function ticketUrl(id) {
	return `https://${TRAC_HOST}/ticket/${id}`;
}

/**
 * @param {string} digits
 */
function fromDigits(digits) {
	const id = Number(digits);
	if (!Number.isSafeInteger(id) || id < 1 || id > MAX_TICKET_ID) {
		return { ok: false, error: NOT_A_TICKET };
	}
	return { ok: true, id, url: ticketUrl(id) };
}

/**
 * Resolves free-form input to a ticket id. Accepts `62281`, `#62281` and any
 * core Trac ticket URL; rejects everything else with a message meant for the
 * contributor, not for a log.
 *
 * @param {string} input
 * @return {{ok: true, id: number, url: string}|{ok: false, error: string}}
 */
function parseTicketRef(input) {
	const raw = typeof input === 'string' ? input.trim() : '';
	if (!raw) return { ok: false, error: 'Enter a ticket number or URL.' };

	const bare = raw.replace(/^#/, '');
	if (/^\d+$/.test(bare)) return fromDigits(bare);

	// Anything else has to be a ticket URL. Accept it without a scheme too —
	// copying the host out of an address bar often drops it. But `new URL` is
	// lenient: `new URL('https://abc')` succeeds because `abc` is a legal
	// hostname, so a bare word would reach the host check and be reported as a
	// wrong *host* rather than as not-a-ticket. Only take the URL branch when
	// the input actually looks like one — a scheme, a path or a dotted host.
	const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw);
	if (!hasScheme && !raw.includes('/') && !raw.includes('.')) {
		return { ok: false, error: NOT_A_TICKET };
	}

	let parsed;
	try {
		parsed = new URL(hasScheme ? raw : `https://${raw}`);
	} catch {
		return { ok: false, error: NOT_A_TICKET };
	}

	if (parsed.hostname.toLowerCase() !== TRAC_HOST) {
		return { ok: false, error: `Only ${TRAC_HOST} tickets are supported.` };
	}

	// Reading the id off the path drops ?format= and #comment: for free.
	const match = /^\/ticket\/(\d+)\/?$/.exec(parsed.pathname);
	if (!match) return { ok: false, error: NOT_A_TICKET };
	return fromDigits(match[1]);
}

module.exports = {
	TRAC_HOST,
	MAX_TICKET_ID,
	ticketUrl,
	parseTicketRef
};
