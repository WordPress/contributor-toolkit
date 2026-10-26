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
 * title: its status as a badge, and its facts as labelled rows, one per fact,
 * so each can be read without parsing a run-on line. The values are Trac's
 * own words and stay as Trac wrote them; only the labels are translated.
 * The keywords are a row too, of links rather than one value.
 *
 * A closed ticket is not an error, so its badge has no colour; any other
 * status is the ticket being worked on.
 *
 * @param {Object|null} info What `parseTicketInfo` read, or null before the ticket has been read.
 * @return {{summary: string, status: ({label: string, intent: string}|null), facts: Array<{id: string, label: string, value?: string, url?: string, links?: Array<{label: string, url?: string}>}>}|null} Null before the ticket has been read.
 */
function ticketFacts(info) {
	if (!info) return null;
	const badge = statusBadge(info);
	const facts = [];
	// translators: The label of a Trac ticket's type, such as "defect (bug)".
	if (info.type) facts.push({ id: 'type', label: __('Type'), value: info.type });
	// translators: The label of the part of WordPress a ticket is about, as Trac names it, such as "General" or "Editor".
	if (info.component && info.component.label) facts.push({ id: 'component', label: __('Component'), value: info.component.label, url: info.component.url || '' });
	// translators: The label of the milestone a ticket is set for, such as "7.2" or "Awaiting Review".
	if (info.milestone) facts.push({ id: 'milestone', label: __('Milestone'), value: info.milestone });
	// The date Trac gives, not its "4 weeks ago": a read is kept across a
	// relaunch (#695), and the relative words would stop being true while the
	// date stays so. The relative words only when Trac gave no date.
	const opened = info.opened ? info.opened.absolute || info.opened.relative : '';
	// translators: The label of when a Trac ticket was opened, such as "08/28/2023 11:50:14 PM".
	if (opened) facts.push({ id: 'opened', label: __('Opened'), value: opened });
	// translators: The label of a Trac ticket's keywords, such as "has-patch".
	if (Array.isArray(info.keywords) && info.keywords.length) facts.push({ id: 'keywords', label: __('Keywords'), links: info.keywords });
	return {
		summary: info.summary || '',
		status: badge ? { label: badge.label, intent: badge.tone === 'closed' ? 'none' : 'informational' } : null,
		facts
	};
}

/**
 * The top of the card once a ticket is linked: the heading, and what sits
 * above it.
 *
 * Once Trac has given a summary, the summary is the heading's visible text
 * and its link to Trac, with the number small above it. The heading still
 * begins with the number for a screen reader (`hiddenPrefix`): under #108 the
 * number names the branch the site is on. The number above is then hidden
 * from it, so it is not said twice. Before a summary the number is the
 * heading. The status badge sits above the heading whenever Trac gave one.
 *
 * @param {Object}  root0
 * @param {*}       root0.ticketId The linked ticket's number.
 * @param {?Object} root0.facts    What `ticketFacts` made of the read, or null before one.
 * @return {{numberAbove: string, status: ({label: string, intent: string}|null), hiddenPrefix: string, linkText: string}} What to draw.
 */
function ticketHeading({ ticketId, facts = null }) {
	const number = `#${ticketId}`;
	const summary = facts && facts.summary ? facts.summary : '';
	return {
		numberAbove: summary ? number : '',
		status: facts ? facts.status : null,
		hiddenPrefix: summary ? `${number} ` : '',
		linkText: summary || number
	};
}

// A pull request's state as one of the three this card knows, which its
// badge and its group are both read from (#709). Anything else is open.
function pullRequestStateKey(state) {
	const key = typeof state === 'string' ? state.toLowerCase() : '';
	return key === 'merged' || key === 'closed' ? key : 'open';
}

/**
 * A pull request's state, as a badge.
 *
 * The colour goes with the word and never stands in for it. A closed pull
 * request is not a failure, so it has no colour, where red in this window
 * means that something went wrong (#227). An unrecognised state reads as
 * open, which is what the row has always done: a list cached by an older
 * build carries only `open` and `closed`. The apply's preview shows the same
 * badge, from here.
 *
 * @param {string} state 'open', 'merged' or 'closed', in any case.
 * @return {{label: string, intent: string}} The badge.
 */
function pullRequestState(state) {
	const key = pullRequestStateKey(state);
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

// What both lists show above their groups (#709), so a pull request and a
// patch file are shown the same way. With something applied on the site, in
// either list or from a file, that is all: the applied one, in the list it
// came from. With nothing applied, each list shows its newest, which is the
// ticket's latest patch whenever that is in this list. The rest go into
// groups, every one folded to begin with. `entries` are newest first; each
// row is kept with the item it was made from.
function pinNewest(entries, workApplied) {
	const applied = entries.find((entry) => entry.row.applied) || null;
	const others = entries.filter((entry) => entry !== applied);
	const newest = workApplied ? null : others.find((entry) => entry.row.latest) || others[0] || null;
	return { applied, newest, rest: others.filter((entry) => entry !== newest) };
}

const withItems = (rows, items) => rows.map((row, index) => ({ row, item: items[index] }));

/**
 * The linked pull requests as the card shows them (#709): a ticket with many
 * would otherwise push everything under them down. The one checked out, or
 * with nothing applied the newest, is shown, and the rest are in two groups,
 * open and closed, each folded and named with its count. Merged is closed
 * here, as GitHub counts it, and a state it does not know is open, as its
 * badge says. The group the one shown would have been in says "other". A
 * group with nothing in it is left out.
 *
 * @param {Array}   rows                  The rows, as pullRequestRows made them.
 * @param {Array}   items                 The pull requests they were made from, in the same order, newest first.
 * @param {Object}  [options]
 * @param {boolean} [options.workApplied] A pull request or a patch is applied on the site.
 * @return {{applied: ?{row: Object, item: Object}, newest: ?{row: Object, item: Object}, groups: Array<{key: string, label: string, entries: Array<{row: Object, item: Object}>}>}} The checked-out one and the newest, each or null, and the groups, open first.
 */
function pullRequestGroups(rows = [], items = [], { workApplied = false } = {}) {
	const { applied, newest, rest } = pinNewest(withItems(rows, items), workApplied);
	const isOpen = (entry) => pullRequestStateKey(entry.item && entry.item.state) === 'open';
	const shown = applied || newest;
	const newestOpen = Boolean(shown) && isOpen(shown);
	const newestClosed = Boolean(shown) && !newestOpen;
	const open = rest.filter(isOpen);
	const closed = rest.filter((entry) => !isOpen(entry));
	let openLabel;
	if (newestOpen) {
		// translators: %d: how many open pull requests there are besides the one shown above.
		openLabel = sprintf(__('Other open PRs (%d)'), open.length);
	} else {
		// translators: %d: how many pull requests are open.
		openLabel = sprintf(__('Open PRs (%d)'), open.length);
	}
	let closedLabel;
	if (newestClosed) {
		// translators: %d: how many closed or merged pull requests there are besides the one shown above.
		closedLabel = sprintf(__('Other closed PRs (%d)'), closed.length);
	} else {
		// translators: %d: how many pull requests are closed or merged.
		closedLabel = sprintf(__('Closed PRs (%d)'), closed.length);
	}
	const groups = [
		{ key: 'open', label: openLabel, entries: open },
		{ key: 'closed', label: closedLabel, entries: closed }
	].filter((group) => group.entries.length);
	return { applied, newest, groups };
}

const localDateTime = (when) => new Date(when).toLocaleString();

/**
 * What the pull requests' section says besides its rows: that it is asking
 * GitHub for the first time, that GitHub knows of none, or why the list could
 * not be read and what is shown in its place.
 *
 * A list that could not be read keeps the rows it was last read with, so
 * `failure` and rows can be on screen together. `no-ticket` is the answer for
 * a site with nothing linked, and is not a failure. A failure is two
 * sentences, why and what is shown instead, kept apart so that the card
 * places them and nothing joins them with a space a language may not use.
 *
 * @param {Object}   root0
 * @param {Object}   [root0.list]           What the main process answered, `{ status, items, cachedAt }`, or null before it has.
 * @param {boolean}  [root0.loading]        A read is under way.
 * @param {Function} [root0.formatDateTime] Writes a time the way the reader's locale does.
 * @return {{checking: boolean, empty: boolean, failure: ({reason: string, fallback: string}|null)}} What to say.
 */
function pullRequestsStatus({ list = null, loading = false, formatDateTime = localDateTime } = {}) {
	const items = list && Array.isArray(list.items) ? list.items : [];
	let failure = null;
	if (list && list.status !== 'ok' && list.status !== 'no-ticket') {
		let reason = __('Could not read the pull requests from GitHub.');
		if (list.status === 'rate-limited') reason = __('GitHub is rate-limiting this connection.');
		if (list.status === 'offline') reason = __('Could not reach GitHub.');
		let fallback = __('No cached list to fall back on.');
		if (items.length && list.cachedAt) {
			// translators: %s: a date and a time.
			fallback = sprintf(__('Showing what was last seen %s.'), formatDateTime(list.cachedAt));
		}
		failure = { reason, fallback };
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
 * @param {Array}  [root0.items]        The attachments that are patches.
 * @param {Object} [root0.latest]       The ticket's most recent patch, `{ kind, key }`, or null.
 * @param {string} [root0.appliedLabel] What the site's applied patch is called, which for one of these is its file name.
 * @return {Array<{key: string, name: string, url: string, latest: boolean, applied: boolean, meta: string}>} One per file.
 */
function attachmentRows({ items = [], latest = null, appliedLabel = '' } = {}) {
	return (Array.isArray(items) ? items : []).map((att) => {
		// translators: %s: the WordPress.org username of whoever uploaded a file.
		const by = att.author ? sprintf(__('by %s'), att.author) : '';
		return {
			key: att.url,
			name: att.filename,
			url: att.url,
			latest: Boolean(latest && latest.kind === 'attachment' && latest.key === att.url),
			applied: Boolean(appliedLabel) && appliedLabel === att.filename,
			meta: [by, att.dateText, att.sizeText].filter(Boolean).join(' · ')
		};
	});
}

/**
 * The attachments as the card shows them, the way the pull requests are
 * (#709): the one applied, or with nothing applied the newest, and the rest
 * in one folded group named with its count, newest first. Trac lists them oldest first. They are
 * neither open nor closed, so there is the one group.
 *
 * @param {Array}   rows                  The rows, as attachmentRows made them.
 * @param {Array}   items                 The attachments they were made from, in the same order, oldest first.
 * @param {Object}  [options]
 * @param {boolean} [options.workApplied] A pull request or a patch is applied on the site.
 * @return {{applied: ?{row: Object, item: Object}, newest: ?{row: Object, item: Object}, groups: Array<{key: string, label: string, entries: Array<{row: Object, item: Object}>}>}} The applied one and the newest, each or null, and the group.
 */
function attachmentGroups(rows = [], items = [], { workApplied = false } = {}) {
	const { applied, newest, rest } = pinNewest(withItems(rows, items).reverse(), workApplied);
	if (!rest.length) return { applied, newest, groups: [] };
	let label;
	if (applied || newest) {
		// translators: %d: how many patch files there are on the ticket besides the one shown above.
		label = sprintf(__('Other attachments (%d)'), rest.length);
	} else {
		// translators: %d: how many patch files there are on the ticket.
		label = sprintf(__('Attachments (%d)'), rest.length);
	}
	return { applied, newest, groups: [{ key: 'other', label, entries: rest }] };
}

/**
 * When the ticket's details were read from Trac (#695), said wherever they
 * are shown, since a relaunch shows the last read and not a new one.
 *
 * @param {Object}   root0
 * @param {string}   [root0.checkedAt]      When the read answered, as an ISO time.
 * @param {Function} [root0.formatDateTime] Writes a time the way the reader's locale does.
 * @return {string} The sentence, or '' before any read.
 */
function tracReadAt({ checkedAt = null, formatDateTime = localDateTime } = {}) {
	if (!checkedAt) return '';
	// translators: %s: a date and time.
	return sprintf(__('Read from Trac %s'), formatDateTime(checkedAt));
}

/**
 * What the Trac sections show once the last read of the ticket has come back
 * from the store (#695): the saved read only while the ticket it was asked
 * for is still the one linked, and never over a read that has already
 * answered, which is newer.
 *
 * @param {Object}  root0
 * @param {?Object} root0.current    What the sections show now, or null.
 * @param {?Object} root0.saved      The saved read, or null when there is none.
 * @param {boolean} root0.sameTicket The ticket is still the one the saved read was asked for.
 * @return {?Object} What to show.
 */
function tracReadToShow({ current, saved, sameTicket }) {
	return !current && saved && sameTicket ? saved : current;
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
		// translators: “I am human” is what Trac's own page calls its button, in English whatever the reader's language; leave it as it is.
		failure = __('Trac’s human-check did not complete in time. Try again, and click “I am human” if it appears.');
	} else if (result && result.status === 'closed') {
		// The way to try again is the section's Refresh: once a read has
		// answered, however it ended, "Show Trac attachments" is gone.
		// translators: “Refresh” is the button beside the section's heading; use the word that button has in this language.
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

module.exports = { ticketCardWords, ticketFacts, ticketHeading, pullRequestState, pullRequestRows, pullRequestGroups, pullRequestsStatus, attachmentRows, attachmentGroups, attachmentsStatus, tracReadAt, tracReadToShow };
