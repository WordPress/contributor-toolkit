'use strict';

/**
 * One interface over the two kinds of work item a site can be on (#251): a
 * WordPress Trac ticket, or a GitHub issue on the project's own repository.
 *
 * The rest of the app asks "parse what they typed", "where does this live", and
 * "what do we call it" without knowing which kind it is — the site's project
 * type picks the provider. Everything Trac-specific still lives in
 * renderer/trac-ticket.cjs and everything GitHub-specific in
 * renderer/github-issue.cjs; this only chooses between them, so neither path
 * had to change to gain the other.
 *
 * The split with project-type.cjs: the registry holds what is true of one
 * target (`workItem.label`, `browseUrl`, `browseLabel` — a site's own words),
 * this module holds what is true of one kind of work item (how to parse a
 * reference, where it lives, whether it takes attachments). A second Trac-based
 * target would reuse this provider and bring its own registry entry.
 *
 * Pure and dependency-free (both parsers are too), so `node --test` requires it
 * directly and the renderer bundles it.
 */

const { parseTicketRef, ticketUrl, attachUrl } = require('./renderer/trac-ticket.cjs');
const { parseIssueRef, issueUrl } = require('./renderer/github-issue.cjs');

/**
 * The provider for a work-item kind, defaulting to Trac for anything unknown —
 * the same default-to-Core rule the project-type registry follows, so a site
 * with no type behaves exactly as it always did.
 *
 * `repoPath` is only meaningful for GitHub issues; the Trac provider ignores it.
 *
 * @param {string} provider   'trac' (default) or 'github-issue'.
 * @param {string} [repoPath] `owner/repo`, for the GitHub provider.
 * @return {{kind: string, noun: string, refPlaceholder: string, refLabel: string, openLabel: string, parseRef: Function, urlFor: Function, attachUrlFor: (Function|null)}}
 */
function workItemProvider(provider, repoPath) {
	if (provider === 'github-issue') {
		return {
			kind: 'github-issue',
			noun: 'issue',
			refPlaceholder: 'Issue number or URL, e.g. 71234',
			// The field's accessible name; the journeys find the field by it.
			refLabel: 'GitHub issue number or URL',
			// The card's link to the work item itself, worded for where it is.
			openLabel: 'Open on GitHub',
			parseRef: (input) => parseIssueRef(input, { repoPath }),
			urlFor: (id) => issueUrl(id, repoPath),
			// GitHub issues carry no patch attachments — work arrives as a pull
			// request, which the linked-PR panel already lists. Null rather than a
			// no-op so a caller has to decide what to show rather than rendering an
			// "attach" affordance that leads nowhere.
			attachUrlFor: null
		};
	}
	return {
		kind: 'trac',
		noun: 'ticket',
		refPlaceholder: 'Ticket number or URL, e.g. 62281',
		refLabel: 'Trac ticket number or URL',
		openLabel: 'Open in Trac',
		parseRef: parseTicketRef,
		urlFor: ticketUrl,
		attachUrlFor: attachUrl
	};
}

module.exports = { workItemProvider };
