'use strict';

const test = require('node:test');
const assert = require('node:assert');

// Requiring the module does not load electron-store: its import starts on
// first use of the store, so the fold can be tested on its own.
const { liftUpdateIncomplete } = require('../../src/settings-store.js');

// The shape 2.0.0 left after an update run from a ticket whose build never
// finished: the live flag on the branch, and the site copy the #419 code
// cleared. Read from the site alone, that site has no banner.
test('a flag a ticket branch held is lifted onto the site, and the branch copy removed (issue #475)', () => {
	const stored = {
		'/sites/wp': {
			updateIncomplete: false,
			currentBranch: 'ticket/60002',
			branches: { 'ticket/60002': { tracTicket: 60002, baseOid: 'abc', updateIncomplete: true } }
		}
	};

	const lifted = liftUpdateIncomplete(stored);

	assert.equal(lifted['/sites/wp'].updateIncomplete, true, 'the build is still behind, so the site says so');
	assert.deepEqual(lifted['/sites/wp'].branches['ticket/60002'], { tracTicket: 60002, baseOid: 'abc' }, 'and the branch keeps everything but the flag');
});

test('a cleared branch copy is removed without clearing a real site flag (issue #475)', () => {
	const stored = {
		'/sites/wp': {
			updateIncomplete: true,
			branches: { 'ticket/60002': { baseOid: 'abc', updateIncomplete: false } }
		}
	};

	const lifted = liftUpdateIncomplete(stored);

	assert.equal(lifted['/sites/wp'].updateIncomplete, true);
	assert.equal('updateIncomplete' in lifted['/sites/wp'].branches['ticket/60002'], false);
});

test('a store with nothing to lift comes back as the same object, so nothing is written (issue #475)', () => {
	const stored = {
		'/sites/wp': { updateIncomplete: true, branches: { 'ticket/60002': { baseOid: 'abc' } } },
		'/sites/old': { label: 'predates #108' }
	};

	assert.strictEqual(liftUpdateIncomplete(stored), stored);
	assert.deepStrictEqual(liftUpdateIncomplete(undefined), undefined);
});
