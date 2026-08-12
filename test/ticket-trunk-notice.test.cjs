'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { ticketTrunkNotice } = require('../src/renderer/ticket-trunk-notice.cjs');

test('ticketTrunkNotice says what changed and gives the deliberately manual exit (#305)', () => {
	assert.deepStrictEqual(ticketTrunkNotice({ ticketId: 123, baseOid: 'old', trunkOid: 'new' }), {
		title: 'Trunk has moved since this ticket started.',
		body: 'Newer patches may not apply cleanly. Save a copy of your work, delete this ticket’s work from the site, then link #123 again to start from the current trunk.'
	});
});

test('ticketTrunkNotice stays silent without a recorded comparison (#305)', () => {
	for (const state of [
		{ ticketId: null, baseOid: 'old', trunkOid: 'new' },
		{ ticketId: 123, baseOid: null, trunkOid: 'new' },
		{ ticketId: 123, baseOid: 'old', trunkOid: null },
		{ ticketId: 123, baseOid: 'same', trunkOid: 'same' }
	]) assert.equal(ticketTrunkNotice(state), null);
});
