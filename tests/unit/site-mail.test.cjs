'use strict';

// What the Email tray says (#558). The list is the hook's and the window's;
// the words are decided here.

const test = require('node:test');
const assert = require('node:assert/strict');

const { smtpNote, noMailNote, mailRow } = require('../../src/renderer/site-mail.cjs');

test('the mail server is said to be listening only while it has a port', () => {
	assert.strictEqual(smtpNote(2525), 'SMTP listening on 127.0.0.1:2525');
	assert.strictEqual(smtpNote(0), 'SMTP will start with the dev server.');
	assert.strictEqual(smtpNote(undefined), 'SMTP will start with the dev server.');
});

test('a list with nothing in it says what will be in it', () => {
	assert.strictEqual(noMailNote(), 'No mail yet. WordPress transactional email will appear here once the site sends any.');
});

test('a row is when the mail was sent, who from, and its subject', () => {
	const asIso = (date) => date.toISOString();
	assert.deepStrictEqual(
		mailRow({ sentAt: '2026-08-10T09:30:00.000Z', date: '2026-08-10T09:31:00.000Z', from: 'WordPress <wordpress@example.test>', subject: 'Password Reset' }, asIso),
		{ when: '2026-08-10T09:30:00.000Z', from: 'WordPress <wordpress@example.test>', subject: 'Password Reset' }
	);
});

test('a mail that does not say when it was sent is dated by when it was caught', () => {
	const asIso = (date) => date.toISOString();
	assert.strictEqual(mailRow({ date: '2026-08-10T09:31:00.000Z' }, asIso).when, '2026-08-10T09:31:00.000Z');
	assert.strictEqual(mailRow({}, asIso).when, '');
});

test('a mail with no subject says so, and one with no sender says nothing', () => {
	assert.deepStrictEqual(mailRow({}), { when: '', from: '', subject: '(no subject)' });
	assert.deepStrictEqual(mailRow(undefined), { when: '', from: '', subject: '(no subject)' });
});
