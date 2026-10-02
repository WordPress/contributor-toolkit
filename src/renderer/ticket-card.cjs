// What the work-item card says (#557): the card a site links its Trac ticket
// or its GitHub issue in, and reads that ticket's pull requests and
// attachments from. The component draws; what is drawn is decided here.
//
// The two kinds of work item get whole sentences each, never a noun put into
// a shared one: a sentence with a hole in it cannot be translated.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');
const { statusBadge } = require('../trac-ticket-info.cjs');
const { prDateLabel } = require('./pr-date-label.cjs');
const { prStateBadge } = require('./pr-state.cjs');

/**
 * The card's own words, for the kind of work item the site's project uses.
 * Anything that is not a GitHub issue is a Trac ticket, the default the
 * work-item provider follows too.
 *
 * @param {string} provider 'trac' or 'github-issue'.
 * @return {Object} The words, by what they are for.
 */
function ticketCardWords(provider) {
	if (provider === 'github-issue') {
		return {
			title: __('GitHub issue'),
			linkPrompt: __('Link the issue you’re working on.'),
			fieldLabel: __('Issue number or URL'),
			// translators: an example of what to type; the number stays as it is.
			fieldExample: __('e.g. 71234'),
			linkAction: __('Link issue'),
			linking: __('Linking issue'),
			browse: __('Browse good first issues on GitHub'),
			open: __('Open on GitHub'),
			pullRequestsLead: __('See the work that already exists on this issue before adding your own.'),
			noPullRequests: __('No pull requests cite this issue yet.')
		};
	}
	return {
		title: __('Trac ticket'),
		linkPrompt: __('Link the ticket you’re working on.'),
		fieldLabel: __('Ticket number or URL'),
		// translators: an example of what to type; the number stays as it is.
		fieldExample: __('e.g. 62281'),
		linkAction: __('Link ticket'),
		linking: __('Linking ticket'),
		browse: __('Browse good first bugs on Trac'),
		open: __('Open in Trac'),
		pullRequestsLead: __('See the work that already exists on this ticket before adding your own.'),
		noPullRequests: __('No pull requests cite this ticket yet.')
	};
}

/**
 * What Trac said of the ticket, as the card shows it under the ticket's
 * number: its status as a badge, and a line of facts. The values are Trac's
 * own words and stay as Trac wrote them; only what the app adds around them
 * is translated.
 *
 * A closed ticket is not an error, so its badge has no colour; any other
 * status is the ticket being worked on.
 *
 * @param {Object|null} info What `parseTicketInfo` read, or null before the ticket has been read.
 * @return {{summary: string, status: ({label: string, intent: string}|null), facts: Array<{id: string, text: string, url?: string, title?: string}>, keywords: Array<{label: string, url?: string}>}|null} Null before the ticket has been read.
 */
function ticketFacts(info) {
	if (!info) return null;
	const badge = statusBadge(info);
	const facts = [];
	if (info.type) facts.push({ id: 'type', text: info.type });
	if (info.component && info.component.label) facts.push({ id: 'component', text: info.component.label, url: info.component.url || '' });
	// translators: %s: the milestone a ticket is set for, such as "7.2" or "Awaiting Review".
	if (info.milestone) facts.push({ id: 'milestone', text: sprintf(__('Milestone: %s'), info.milestone) });
	// translators: %s: how long ago, as Trac says it, such as "4 weeks ago".
	if (info.opened && info.opened.relative) facts.push({ id: 'opened', text: sprintf(__('Opened %s'), info.opened.relative), title: info.opened.absolute || '' });
	return {
		summary: info.summary || '',
		status: badge ? { label: badge.label, intent: badge.tone === 'closed' ? 'none' : 'informational' } : null,
		facts,
		keywords: Array.isArray(info.keywords) ? info.keywords : []
	};
}

/**
 * A pull request's state, as a badge.
 *
 * The colour goes with the word and never stands in for it. A closed pull
 * request is not a failure, so it has no colour, where red in this window
 * means that something went wrong (#227). Which of the three a state is, an
 * unrecognised one included, is pr-state.cjs's to say: the apply's preview
 * still draws its pill from there, and the two must agree.
 *
 * @param {string} state 'open', 'merged' or 'closed', in any case.
 * @return {{label: string, intent: string}} The badge.
 */
function pullRequestState(state) {
	const key = prStateBadge(state).label;
	if (key === 'merged') return { label: __('Merged'), intent: 'informational' };
	if (key === 'closed') return { label: __('Closed'), intent: 'none' };
	return { label: __('Open'), intent: 'stable' };
}

const localDate = (iso) => new Date(iso).toLocaleDateString();

/**
 * The linked pull requests, as rows.
 *
 * @param {Object}   root0
 * @param {Array}    [root0.items]         The pull requests, as the main process lists them.
 * @param {Object}   [root0.latest]        The ticket's most recent patch, `{ kind, key }`, or null.
 * @param {number}   [root0.appliedNumber] The pull request the site has checked out, if any.
 * @param {Function} [root0.formatDate]    Writes an ISO date the way the reader's locale does.
 * @return {Array<{key: number, id: string, url: string, title: string, state: {label: string, intent: string}, latest: boolean, applied: boolean, date: string}>} One per pull request.
 */
function pullRequestRows({ items = [], latest = null, appliedNumber = null, formatDate = localDate } = {}) {
	return (Array.isArray(items) ? items : []).map((pr) => {
		const dated = prDateLabel(pr);
		let date = '';
		if (dated && dated.prefix === 'last commit') {
			// translators: %s: a date.
			date = sprintf(__('Last commit %s'), formatDate(dated.when));
		} else if (dated) {
			// translators: %s: a date.
			date = sprintf(__('Updated %s'), formatDate(dated.when));
		}
		return {
			key: pr.number,
			id: `#${pr.number}`,
			url: pr.url,
			title: pr.title || '',
			state: pullRequestState(pr.state),
			latest: Boolean(latest && latest.kind === 'pr' && latest.key === pr.number),
			applied: appliedNumber !== null && appliedNumber === pr.number,
			date
		};
	});
}

const localDateTime = (when) => new Date(when).toLocaleString();

/**
 * What the pull requests' section says besides its rows: that it is asking
 * GitHub for the first time, that GitHub knows of none, or why the list could
 * not be read and what is shown in its place.
 *
 * A list that could not be read keeps the rows it was last read with, so
 * `failure` and rows can be on screen together. `no-ticket` is the answer for
 * a site with nothing linked, and is not a failure.
 *
 * @param {Object}   root0
 * @param {Object}   [root0.list]           What the main process answered, `{ status, items, cachedAt }`, or null before it has.
 * @param {boolean}  [root0.loading]        A read is under way.
 * @param {Function} [root0.formatDateTime] Writes a time the way the reader's locale does.
 * @return {{checking: boolean, empty: boolean, failure: string}} What to say.
 */
function pullRequestsStatus({ list = null, loading = false, formatDateTime = localDateTime } = {}) {
	const items = list && Array.isArray(list.items) ? list.items : [];
	let failure = '';
	if (list && list.status !== 'ok' && list.status !== 'no-ticket') {
		let reason = __('Could not read the pull requests from GitHub.');
		if (list.status === 'rate-limited') reason = __('GitHub is rate-limiting this connection.');
		if (list.status === 'offline') reason = __('Could not reach GitHub.');
		let fallback = __('No cached list to fall back on.');
		if (items.length && list.cachedAt) {
			// translators: %s: a date and a time.
			fallback = sprintf(__('Showing what was last seen %s.'), formatDateTime(list.cachedAt));
		}
		failure = `${reason} ${fallback}`;
	}
	return {
		checking: Boolean(loading && !list),
		empty: Boolean(list && list.status === 'ok' && items.length === 0),
		failure
	};
}

/**
 * The ticket's patch files on Trac, as rows. The date and the size are
 * Trac's own words.
 *
 * @param {Object} root0
 * @param {Array}  [root0.items]  The attachments that are patches.
 * @param {Object} [root0.latest] The ticket's most recent patch, `{ kind, key }`, or null.
 * @return {Array<{key: string, name: string, url: string, latest: boolean, meta: string}>} One per file.
 */
function attachmentRows({ items = [], latest = null } = {}) {
	return (Array.isArray(items) ? items : []).map((att) => {
		// translators: %s: the WordPress.org username of whoever uploaded a file.
		const by = att.author ? sprintf(__('by %s'), att.author) : '';
		return {
			key: att.url,
			name: att.filename,
			url: att.url,
			latest: Boolean(latest && latest.kind === 'attachment' && latest.key === att.url),
			meta: [by, att.dateText, att.sizeText].filter(Boolean).join(' · ')
		};
	});
}

/**
 * Where the attachments' section is: nothing asked of Trac yet, asking,
 * read, or read and failed, with the sentence that says how.
 *
 * Reading the attachments opens the ticket in a window of its own, where
 * Trac may ask whoever is there to show they are human. The three failures
 * are the three ways that can end without an answer.
 *
 * @param {Object}  root0
 * @param {Object}  [root0.result]  What the read answered, `{ status, error }`, or null before any read.
 * @param {boolean} [root0.loading] A read is under way.
 * @param {number}  [root0.count]   How many patch files it found.
 * @return {{unread: boolean, reading: boolean, none: boolean, failure: string}} What to say.
 */
function attachmentsStatus({ result = null, loading = false, count = 0 } = {}) {
	const read = Boolean(result && (result.status === 'ok' || result.status === 'no-attachments'));
	let failure = '';
	if (result && result.status === 'challenge-timeout') {
		failure = __('Trac’s human-check did not complete in time. Try again, and click “I am human” if it appears.');
	} else if (result && result.status === 'closed') {
		// The way to try again is the section's Refresh: once a read has
		// answered, however it ended, "Show Trac attachments" is gone.
		failure = __('The Trac window was closed before the attachments finished loading. Click “Refresh” to try again.');
	} else if (result && result.status === 'error') {
		failure = __('Could not read the attachments from Trac.');
		if (result.error) {
			// translators: %s: an error message, as the system gave it.
			failure = sprintf(__('Could not read the attachments from Trac. (%s)'), result.error);
		}
	}
	return {
		unread: !result && !loading,
		reading: Boolean(loading),
		none: read && count === 0,
		failure
	};
}

module.exports = { ticketCardWords, ticketFacts, pullRequestState, pullRequestRows, pullRequestsStatus, attachmentRows, attachmentsStatus };
