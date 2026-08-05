'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { TRAC_HOST, MAX_TICKET_ID, ticketUrl, parseTicketRef } = require('../src/renderer/trac-ticket.cjs');

test('parseTicketRef: a bare number is a ticket (issue #109)', () => {
	const res = parseTicketRef('62281');
	assert.strictEqual(res.ok, true);
	assert.strictEqual(res.id, 62281);
	assert.strictEqual(res.url, 'https://core.trac.wordpress.org/ticket/62281');
});

test('parseTicketRef: the # a contributor types out of habit is not an error (issue #109)', () => {
	assert.strictEqual(parseTicketRef('#62281').id, 62281);
});

test('parseTicketRef: surrounding whitespace from a paste is trimmed (issue #109)', () => {
	assert.strictEqual(parseTicketRef('  62281  ').id, 62281);
	assert.strictEqual(parseTicketRef(' #62281 ').id, 62281);
});

test('parseTicketRef: a plain ticket URL resolves (issue #109)', () => {
	assert.strictEqual(parseTicketRef('https://core.trac.wordpress.org/ticket/62281').id, 62281);
});

// The three shapes an address bar actually produces: a comment anchor from
// clicking a comment permalink, a trailing slash, and the ?format= query the
// app itself would append.
test('parseTicketRef: a comment anchor, trailing slash and query are all dropped (issue #109)', () => {
	assert.strictEqual(parseTicketRef('https://core.trac.wordpress.org/ticket/62281#comment:3').id, 62281);
	assert.strictEqual(parseTicketRef('https://core.trac.wordpress.org/ticket/62281/').id, 62281);
	assert.strictEqual(parseTicketRef('https://core.trac.wordpress.org/ticket/62281?format=csv').id, 62281);
	assert.strictEqual(parseTicketRef('https://core.trac.wordpress.org/ticket/62281/?replyto=2#comment:3').id, 62281);
});

test('parseTicketRef: http and a missing scheme both resolve (issue #109)', () => {
	assert.strictEqual(parseTicketRef('http://core.trac.wordpress.org/ticket/62281').id, 62281);
	assert.strictEqual(parseTicketRef('core.trac.wordpress.org/ticket/62281').id, 62281);
});

test('parseTicketRef: every accepted form yields the same canonical https URL (issue #109)', () => {
	const forms = [
		'62281',
		'#62281',
		'core.trac.wordpress.org/ticket/62281',
		'http://core.trac.wordpress.org/ticket/62281/#comment:3'
	];
	for (const form of forms) {
		assert.strictEqual(parseTicketRef(form).url, ticketUrl(62281), `form: ${form}`);
	}
});

test('parseTicketRef: empty input asks for a ticket rather than reporting a parse failure (issue #109)', () => {
	for (const empty of ['', '   ', null, undefined, 62281]) {
		const res = parseTicketRef(empty);
		assert.strictEqual(res.ok, false);
		assert.strictEqual(res.error, 'Enter a ticket number or URL.');
	}
});

test('parseTicketRef: non-numeric and malformed input is rejected (issue #109)', () => {
	for (const bad of ['abc', '62281abc', '#', '#abc', '62281 62282', 'not a url', 'https://']) {
		assert.strictEqual(parseTicketRef(bad).ok, false, `should reject: ${bad}`);
	}
});

test('parseTicketRef: a non-Trac host is named as the reason (issue #109)', () => {
	const res = parseTicketRef('https://github.com/WordPress/wordpress-develop/pull/7990');
	assert.strictEqual(res.ok, false);
	assert.strictEqual(res.error, `Only ${TRAC_HOST} tickets are supported.`);
});

// A Trac URL that is not a ticket — the ticket lists the panel links to are the
// most likely paste.
test('parseTicketRef: a Trac URL that is not a ticket is rejected (issue #109)', () => {
	for (const bad of [
		'https://core.trac.wordpress.org/report/5',
		'https://core.trac.wordpress.org/query?status=new',
		'https://core.trac.wordpress.org/ticket/',
		'https://core.trac.wordpress.org/ticket/62281/attachment/patch.diff'
	]) {
		assert.strictEqual(parseTicketRef(bad).ok, false, `should reject: ${bad}`);
	}
});

test('parseTicketRef: ticket 0 and implausibly long numbers are rejected (issue #109)', () => {
	assert.strictEqual(parseTicketRef('0').ok, false);
	assert.strictEqual(parseTicketRef(String(MAX_TICKET_ID + 1)).ok, false);
	// A pasted millisecond timestamp is the realistic version of "too long".
	assert.strictEqual(parseTicketRef('1785947321000').ok, false);
	assert.strictEqual(parseTicketRef(String(MAX_TICKET_ID)).ok, true);
});

test('parseTicketRef: leading zeros resolve to the same ticket (issue #109)', () => {
	assert.strictEqual(parseTicketRef('0062281').id, 62281);
	assert.strictEqual(parseTicketRef('0062281').url, ticketUrl(62281));
});
