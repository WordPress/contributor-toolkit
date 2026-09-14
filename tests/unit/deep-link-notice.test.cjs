'use strict';

// The three states a ticket from a `wpct://` link can land in (#464), and the
// one thing none of them does: link it. What is asserted here is not the
// wording but the shape — that only the state with a named site offers an
// action, and that the site is named in the sentence that asks.

const test = require('node:test');
const assert = require('node:assert/strict');

const { deepLinkNotice } = require('../../src/renderer/deep-link-notice.cjs');

test('no ticket, no notice — and null means only that', () => {
	assert.equal(deepLinkNotice(), null);
	assert.equal(deepLinkNotice({ ticket: null, siteLabel: 'My site', siteCount: 3 }), null);
	// Every other case a ticket can be in comes back as a state, so a caller can
	// treat null as "no link has arrived" and nothing else.
	assert.equal(deepLinkNotice({ ticket: 62281, siteLabel: 'My site', currentTicket: 62281 }) === null, false);
});

test('a site is open: the question names the ticket and the site', () => {
	const notice = deepLinkNotice({ ticket: 62281, siteLabel: 'My site', siteCount: 3 });
	assert.equal(notice.state, 'confirm');
	assert.ok(notice.title.includes('62281'));
	assert.ok(notice.title.includes('My site'), 'a checkout is being offered; say where');
	assert.ok(notice.confirmLabel, 'this is the one state with an action');
});

test('no site to put it in: the ticket waits on one being created', () => {
	// There is deliberately no "sites exist but none is open" state. The window
	// always has one selected when there is one to select, so a sentence for
	// that case would be wording no contributor can reach.
	const notice = deepLinkNotice({ ticket: 62281 });
	assert.equal(notice.state, 'no-sites');
	assert.ok(notice.title.includes('62281'));
	assert.equal(notice.confirmLabel, null, 'there is no site to link it to yet');
});

test('a link for the ticket the site is already on is not a question', () => {
	// The contributor is looking at that ticket. `settled` and not null, because
	// the caller has to tell it from "no link has arrived" — reading a missing
	// notice as an instruction to discard the ticket is the decision this state
	// exists to make explicit. Discarded rather than merely hidden, or the
	// question resurfaces on the next site they open.
	assert.equal(deepLinkNotice({ ticket: 62281, siteLabel: 'My site', currentTicket: 62281 }).state, 'settled');
	// The panel holds the ticket as a string in some paths and a number in
	// others, so the comparison must not care which.
	assert.equal(deepLinkNotice({ ticket: 62281, siteLabel: 'My site', currentTicket: '62281' }).state, 'settled');
	// Nothing to render in that state.
	assert.equal(deepLinkNotice({ ticket: 62281, siteLabel: 'My site', currentTicket: 62281 }).confirmLabel, null);
	// A different ticket in the same site is still a question, and answering it
	// means leaving the one the site is on.
	assert.equal(deepLinkNotice({ ticket: 49215, siteLabel: 'My site', currentTicket: 62281 }).state, 'confirm');
	// No ticket linked yet is not a match.
	assert.equal(deepLinkNotice({ ticket: 62281, siteLabel: 'My site', currentTicket: null }).state, 'confirm');
});

test('an unnamed active site is not an active site', () => {
	// The confirmation is consent to a checkout in a particular site. A sentence
	// that cannot name it is not a question worth asking, so it falls back to
	// the state that offers nothing.
	const notice = deepLinkNotice({ ticket: 62281, siteLabel: '' });
	assert.equal(notice.state, 'no-sites');
	assert.equal(notice.confirmLabel, null);
});
