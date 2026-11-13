'use strict';

// What the control channel (#764) says of a site: the facts a tool needs to
// work in the checkout the app already made, and nothing it would have to
// interpret. Kept out of main.js so the shape has a test of its own.

const { projectTypeForSite } = require('./project-type.cjs');
const { pathBasename } = require('./renderer/path-basename.cjs');

/**
 * @param {Object}      root0
 * @param {string}      root0.sitePath
 * @param {Object}      [root0.meta]        The site's record in the store.
 * @param {string}      root0.branch        The branch checked out.
 * @param {number|null} [root0.pullRequest] The pull request that branch is, if it is one.
 * @param {Object}      [root0.server]      The entry in main.js's `playgroundServers`.
 * @return {Object} One entry of `sites.list`.
 */
function describeSite({ sitePath, meta = {}, branch, pullRequest = null, server = null }) {
	const project = projectTypeForSite(meta);
	return {
		path: sitePath,
		label: meta.label || pathBasename(sitePath),
		project: project.id,
		// The stored key is `tracTicket` for both providers (see the note
		// above `sites:set-ticket` in main.js); the provider is what tells a
		// Trac ticket from a GitHub issue.
		workItem: meta.tracTicket ? { provider: project.workItem.provider, id: meta.tracTicket } : null,
		branch,
		pullRequest,
		initialized: Boolean(meta.initialized),
		server: {
			running: Boolean(server && server.child),
			// A server that is still starting has a process and no address yet.
			url: (server && server.child && server.url) || null
		}
	};
}

module.exports = { describeSite };
