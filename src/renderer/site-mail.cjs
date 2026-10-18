'use strict';

/**
 * What the Email tray says (#558): of the mail server, of each mail in the
 * list, and of a list with nothing in it.
 *
 * The list itself, and when it is live, are the hook's (use-site-mail.jsx).
 * What is here is pure, so that `node --test` can ask it.
 */

const { __, sprintf } = require('@wordpress/i18n');

/**
 * Where the mail server is listening, or that it is not yet. It runs with
 * the dev server and has a port only while that does.
 *
 * @param {number} port The port, or 0 while nothing is listening.
 * @return {string} The sentence under the list.
 */
function smtpNote(port) {
	if (!port) return __('SMTP will start with the dev server.');
	// translators: %d: a port number. "127.0.0.1" is an address and stays as it is.
	return sprintf(__('SMTP listening on 127.0.0.1:%d'), port);
}

/**
 * What a list with no mail in it says in its place.
 *
 * @return {string} The sentence.
 */
function noMailNote() {
	return __('No mail yet. WordPress transactional email will appear here once the site sends any.');
}

/**
 * A mail's row in the list: when it was sent, who from, and its subject. A
 * mail is dated by when it was sent, and by when it was caught only where it
 * does not say; one with no subject says so, since the subject is what the
 * row is known by.
 *
 * @param {Object}   email        A mail as the main process caught it.
 * @param {Function} [formatDate] Turns a date into what is shown; the window's own by default.
 * @return {{when: string, from: string, subject: string}} What the row shows.
 */
function mailRow(email, formatDate = (date) => date.toLocaleString()) {
	const sent = email?.sentAt || email?.date;
	return {
		when: sent ? formatDate(new Date(sent)) : '',
		from: email?.from || '',
		subject: email?.subject || __('(no subject)')
	};
}

module.exports = { smtpNote, noMailNote, mailRow };
