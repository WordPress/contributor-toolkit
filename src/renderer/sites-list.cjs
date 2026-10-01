// What the sites list says about each site (#555).
//
// The list is the one part of the window that describes every site at once,
// including the ones that are not open, so everything it says has to come from
// what the window keeps for all of them: the label, the project, the trunk's
// date and whether an update was left incomplete. What a site's own view
// knows, such as whether its server is running, is not reachable from here
// yet.
'use strict';

const { getProjectType } = require('../project-type.cjs');
const { pathBasename } = require('./path-basename.cjs');
const { trunkAgeInfo } = require('./update-plan.cjs');

const DELETING_TEXT = 'Deleting site…';

/**
 * What a site's dot reports, before the site is even opened (#94): an update
 * that moved trunk and never finished its install and build, or a trunk that
 * is old. The first wins, since it is the one that leaves the site not
 * working. Null when there is nothing to report.
 *
 * @param {Object} meta           The site's record.
 * @param {number} [now=Date.now] The time to measure the trunk's age from.
 * @return {{kind: string, text: string}|null}
 */
function siteAttention(meta = {}, now = Date.now()) {
	if (meta.updateIncomplete) {
		return { kind: 'incomplete', text: 'Update incomplete — code is new, built assets are old' };
	}
	const age = trunkAgeInfo({ trunkDate: meta.trunkDate, now });
	if (age.stale) {
		return { kind: 'stale', text: `WordPress code is ${age.ageDays} days old — update to latest trunk` };
	}
	return null;
}

/**
 * A site's id in the list. The list builds element ids from it and points
 * `aria-labelledby` at them, and that attribute is a list of ids separated by
 * spaces: a path with a space in it, which a Windows home folder has for
 * anyone with two names, would name the row after nothing. Encoded, the path
 * has no space left in it and is still one id per site.
 *
 * @param {string} sitePath
 * @return {string}
 */
function rowId(sitePath) {
	return encodeURIComponent(String(sitePath));
}

/**
 * The rows of the sites list, in the order given.
 *
 * `description` is the line under the name: the project, or that the site is
 * being deleted, which matters more than which project it was.
 *
 * @param {Object}   root0
 * @param {string[]} root0.sites      Site paths, already in display order.
 * @param {Object}   [root0.siteMeta] Records by path.
 * @param {string[]} [root0.deleting] Paths of the sites being deleted.
 * @param {number}   [root0.now]      The time to measure trunk ages from.
 * @return {Array<{id: string, path: string, name: string, project: string, description: string, deleting: boolean, attention: ({kind: string, text: string}|null)}>}
 */
function sitesListRows({ sites, siteMeta = {}, deleting = [], now = Date.now() }) {
	return (sites || []).map((sitePath) => {
		const meta = (siteMeta && siteMeta[sitePath]) || {};
		const isDeleting = deleting.includes(sitePath);
		const project = getProjectType(meta.projectType).tag;
		return {
			id: rowId(sitePath),
			path: sitePath,
			name: (meta.label && meta.label.trim()) || pathBasename(sitePath),
			project,
			description: isDeleting ? DELETING_TEXT : project,
			deleting: isDeleting,
			attention: siteAttention(meta, now)
		};
	});
}

/**
 * The site to open after the list reported a new selection.
 *
 * The list reports its selection by row id. Today that is the one entry that
 * was pressed, the open site's own when it is pressed again, and nothing here
 * depends on it being so: a report that names no other site, whether it is
 * the open site alone or nothing at all, leaves the open site open, since a
 * window with sites in it always has one open. A site that is being deleted
 * cannot be opened.
 *
 * @param {Object}      root0
 * @param {string[]}    root0.selection The row ids the list reports as selected.
 * @param {string|null} root0.current   The path of the site that is open.
 * @param {Array}       root0.rows      From `sitesListRows`.
 * @return {string|null} The path of the site to open, or `current` when nothing changes.
 */
function siteToOpen({ selection, current, rows }) {
	const chosen = new Set(selection || []);
	const next = (rows || []).find((row) => chosen.has(row.id) && row.path !== current && !row.deleting);
	return next ? next.path : current;
}

module.exports = { sitesListRows, siteAttention, siteToOpen, rowId, DELETING_TEXT };
