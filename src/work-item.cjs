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
 * @return {{kind: string, noun: string, refPlaceholder: string, defaultPrTitle: Function, parseRef: Function, urlFor: Function, attachUrlFor: (Function|null)}}
 */
function workItemProvider(provider, repoPath) {
	if (provider === 'github-issue') {
		return {
			kind: 'github-issue',
			noun: 'issue',
			refPlaceholder: 'Issue number or URL, e.g. 71234',
			// The title a pull request gets when the contributor leaves the field
			// empty. Lives here because both the handler that sends it and the
			// hint that promises it need the same string; when they were written
			// separately the hint said "Ticket #" on a Gutenberg site while the
			// handler sent "Issue #".
			defaultPrTitle: (id) => `Issue #${id}`,
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
		defaultPrTitle: (id) => `Ticket #${id}`,
		parseRef: parseTicketRef,
		urlFor: ticketUrl,
		attachUrlFor: attachUrl
	};
}

module.exports = { workItemProvider };
