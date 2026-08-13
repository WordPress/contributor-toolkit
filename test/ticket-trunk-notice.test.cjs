'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { ticketTrunkNotice } = require('../src/renderer/ticket-trunk-notice.cjs');

test('ticketTrunkNotice says what changed and gives the deliberately manual exit (#305)', () => {
	assert.deepStrictEqual(ticketTrunkNotice({ ticketId: 123, behind: true }), {
		title: 'Trunk has moved since this ticket started.',
		body: 'Newer patches may not apply cleanly. Save a copy of your work, unlink the ticket, delete its work from the site, then link #123 again to start from the current trunk.'
	});
});

test('ticketTrunkNotice stays silent without a ticket or a known move (#305)', () => {
	for (const state of [
		{ ticketId: null, behind: true },
		{ ticketId: 123, behind: false },
		{ ticketId: 123 }
	]) assert.equal(ticketTrunkNotice(state), null);
});

test('the ticket card renders the stale-ticket notice returned by status (#305)', () => {
	const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'index.jsx'), 'utf8');
	assert.match(source, /setTicketBehindTrunk\(Boolean\(s\?\.ticketBehindTrunk\)\)/);
	assert.match(source, /ticketTrunkNotice\(\{ ticketId: tracTicket, behind: ticketBehindTrunk \}\)/);
	assert.match(source, /staleTicketNotice\.title/);
	assert.match(source, /staleTicketNotice\.body/);
	assert.match(
		source,
		/setTicketBehindTrunk\(false\);\s+setTracTicket\(res\.ticket\);/,
		'a switched ticket must not render with the previous ticket\'s stale flag'
	);
});
