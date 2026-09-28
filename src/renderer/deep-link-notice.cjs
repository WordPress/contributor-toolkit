// What the app says when a ticket arrives from a `wpct://` link (#464).
//
// The link carries a ticket and nothing else, so where it can land depends on
// what the window already has open: the site in front of the contributor, or no
// site at all. Kept here rather than inline in index.jsx for the reason
// legacy-site.cjs and open-failure.cjs give: the renderer bundle imports it and
// `node --test` requires it, so the wording is testable without a window.
//
// There is deliberately no "sites exist but none is open" state. The window
// always has one selected when there is one to select — `activeSite` falls back
// to the first site and nothing deselects it — so a sentence for that case
// would be wording no contributor can reach, and a paragraph in the guide
// promising behaviour the app does not have.
//
// Every state asks, none of them acts. Linking a ticket parks the current
// branch and checks out another, which is the app's most far-reaching ordinary
// write; a click in a browser is not consent to it. The confirmation is what
// turns an address someone else chose into something the contributor did.
'use strict';

/**
 * The banner for a ticket that arrived from a link, or null when none has.
 *
 * `siteLabel` is the active site's display name. There is no fallback wording
 * for a missing one: a site the contributor cannot name in the sentence is not
 * a site they can consent to a checkout in, so an active site with no label is
 * treated as no active site at all.
 *
 * `currentTicket` is the ticket the active site is on. A link for that same
 * ticket is not a question — the contributor is already looking at it — so it
 * comes back as the `settled` state: nothing to render, and the ticket is done
 * with. That is a state and not a `null` because the caller has to tell it from
 * "no link has arrived", which is the only thing `null` means here. Reading a
 * missing notice as an instruction to discard the ticket is exactly the kind of
 * decision this module exists to keep out of index.jsx.
 *
 * @param {Object}             [root0]
 * @param {number}             [root0.ticket]        The ticket the link carried.
 * @param {string}             [root0.siteLabel]     The active site's name, if one is open.
 * @param {number|string|null} [root0.currentTicket] The ticket the active site is already on.
 * @param {string}             [root0.provider]      The active site's work-item provider (#251): 'trac' (default) or 'github-issue'.
 * @return {{state: string, title: string|null, body: string|null, confirmLabel: string|null}|null} Null only when no link has arrived.
 */
function deepLinkNotice({ ticket = null, siteLabel = '', currentTicket = null, provider = 'trac' } = {}) {
	if (!ticket) return null;

	if (currentTicket !== null && String(ticket) === String(currentTicket)) {
		return { state: 'settled', title: null, body: null, confirmLabel: null };
	}

	// A Trac ticket has no place on a site whose work item is not a Trac
	// ticket (#251): linking it would park the site on a ticket branch that
	// no card on that page names. There is nothing to confirm, so the caller
	// shows this without an action that consumes the ticket: hiding the note
	// is that site's business, and a Core site opened next still asks.
	if (siteLabel && provider !== 'trac') {
		return {
			state: 'unsupported',
			title: `Ticket #${ticket} cannot be linked to ${siteLabel}.`,
			body: 'A Trac ticket belongs on a WordPress Core site. Open one and the app will offer the ticket there.',
			confirmLabel: null
		};
	}

	if (siteLabel) {
		return {
			state: 'confirm',
			title: `Link ticket #${ticket} to ${siteLabel}?`,
			body: 'The ticket number came from a link. Linking it parks whatever the site is on now and checks out this ticket’s branch, so the app asks first.',
			confirmLabel: 'Link ticket'
		};
	}

	return {
		state: 'no-sites',
		title: `Ticket #${ticket} is ready to link.`,
		body: 'There is no site to work on it in yet. Create one from the sidebar and the app will offer this ticket when it is ready.',
		confirmLabel: null
	};
}

module.exports = { deepLinkNotice };
