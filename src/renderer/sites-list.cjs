// What the sites list says about each site (#555).
//
// The list is the one part of the window that describes every site at once,
// including the ones that are not open, so everything it says has to come from
// what the window keeps for all of them: the label, the project, the trunk's
// date and whether an update was left incomplete. What only a site's own view
// knows, whether its server is running, reaches the list the one way it can:
// the view reports it to the window as it changes, and the window hands the
// reports in here by path.
'use strict';

const { __, _n, sprintf } = require('@wordpress/i18n');
const { getProjectType } = require('../project-type.cjs');
const { pathBasename } = require('./path-basename.cjs');
const { trunkAgeInfo } = require('./update-plan.cjs');

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
		return { kind: 'incomplete', text: __('Update incomplete — code is new, built assets are old') };
	}
	const age = trunkAgeInfo({ trunkDate: meta.trunkDate, now });
	if (age.stale) {
		return {
			kind: 'stale',
			// translators: %d: how many days old the site's copy of the WordPress code is.
			text: sprintf(_n('WordPress code is %d day old — update to latest trunk', 'WordPress code is %d days old — update to latest trunk', age.ageDays), age.ageDays)
		};
	}
	return null;
}

// The words a server's dot can be, as `serverProcess` in site-processes.cjs
// says them: grey, green, amber and red.
const SERVER_STATUSES = new Set(['offline', 'online', 'busy', 'failed']);

/**
 * What a site's server dot reports, from what the site's own view last said
 * of its server: the word for the dot's colour, and the words the dot stands
 * for, which are said after the site's name. A site whose view has said
 * nothing, which every site is until its view has rendered, is offline, and
 * so is a report with a word the dot has no colour for. An offline server is
 * the state every site opens in and the grey dot says it, so its words are
 * '': said after every name, "Server stopped" would be the thing a reader of
 * the list hears most and needs least.
 *
 * @param {{status?: string, text?: string}|null} [report] What the view said last.
 * @return {{status: string, text: string}}
 */
function serverDot(report) {
	const status = report && SERVER_STATUSES.has(report.status) ? report.status : 'offline';
	const text = status === 'offline' ? '' : String((report && report.text) || '');
	return { status, text };
}

/**
 * What a site's view reports of its server: the word the header's own dot
 * is drawn from, and the words to say beside it, which for a server that
 * went by itself or could not start are the sentence that says so, since
 * "Server stopped" would not say what the red dot means.
 *
 * @param {{status: string, label: string, detail?: string}} process From `serverProcess` in site-processes.cjs.
 * @return {{status: string, text: string}}
 */
function serverReport(process) {
	return { status: process.status, text: process.detail || process.label };
}

/**
 * The window's reports, by path, after one site has reported: its entry
 * replaced, or taken out for a report of null, from a view on its way out.
 * The same object comes back when nothing changed, so a report that says
 * what the last one said does not re-render the list.
 *
 * @param {Object}                              current  Reports by path.
 * @param {string}                              sitePath
 * @param {{status: string, text: string}|null} report
 * @return {Object}
 */
function withServerReport(current, sitePath, report) {
	const last = current[sitePath];
	if (!report) {
		if (!last) return current;
		const rest = { ...current };
		delete rest[sitePath];
		return rest;
	}
	if (last && last.status === report.status && last.text === report.text) return current;
	return { ...current, [sitePath]: report };
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
 * @param {Object}   [root0.servers]  What each site's view last said of its server, by path: `{status, text}`.
 * @param {number}   [root0.now]      The time to measure trunk ages from.
 * @return {Array<{id: string, path: string, name: string, project: string, description: string, deleting: boolean, attention: ({kind: string, text: string}|null), server: {status: string, text: string}}>}
 */
function sitesListRows({ sites, siteMeta = {}, deleting = [], servers = {}, now = Date.now() }) {
	return (sites || []).map((sitePath) => {
		const meta = (siteMeta && siteMeta[sitePath]) || {};
		const isDeleting = deleting.includes(sitePath);
		const project = getProjectType(meta.projectType).tag;
		return {
			id: rowId(sitePath),
			path: sitePath,
			name: (meta.label && meta.label.trim()) || pathBasename(sitePath),
			project,
			description: isDeleting ? __('Deleting site…') : project,
			deleting: isDeleting,
			attention: siteAttention(meta, now),
			server: serverDot(servers && servers[sitePath])
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

module.exports = { sitesListRows, siteAttention, serverDot, serverReport, withServerReport, siteToOpen, rowId };
