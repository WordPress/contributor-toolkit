'use strict';

/**
 * Reading a ticket's own properties off its Trac page (issue #292).
 *
 * The app shows a linked ticket's number and the work attached to it, but
 * nothing about the ticket itself — so a contributor can sink time into a
 * ticket that was closed `wontfix` years ago and only find out on Trac. The
 * facts that would have told them (status, resolution, type, milestone,
 * component, keywords, when it was opened) all sit in the `#ticket` block of
 * the page the attachments scrape already loads, so reading them costs no new
 * mechanism and no second proof-of-work challenge.
 *
 * Parsing is regex over the HTML string, like trac-attachments.cjs and for the
 * same reason: unit-testable under `node --test` with no browser, against
 * fixtures taken from real ticket pages. Every field degrades to an empty
 * value rather than failing the parse — a ticket with no milestone is normal,
 * not an error.
 *
 * The component and keyword links are Trac's own query URLs, lifted from the
 * page rather than rebuilt, so they stay right if Trac changes its query
 * syntax. They open in the contributor's browser, which handles the
 * proof-of-work like any other visit.
 */

const TRAC_HOST = 'core.trac.wordpress.org';

/**
 * The handful of entities Trac's property markup actually emits.
 *
 * @param {string} text
 * @return {string}
 */
function decodeEntities(text) {
	return text
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#34;/g, '"')
		.replace(/&#39;/g, "'");
}

/**
 * A page-relative Trac link made absolute, or null for anything that is not
 * plainly a Trac path. The hrefs come out of scraped HTML, so they are treated
 * as untrusted: only `/…` paths onto the known host survive.
 *
 * @param {string} href
 * @return {string|null}
 */
function absoluteTracUrl(href) {
	const decoded = decodeEntities(href || '');
	if (!decoded.startsWith('/')) return null;
	return `https://${TRAC_HOST}${decoded}`;
}

/**
 * First capture of `re` against `html`, entity-decoded and trimmed, or ''.
 *
 * @param {string} html
 * @param {RegExp} re
 * @return {string}
 */
function capture(html, re) {
	const m = html.match(re);
	return m ? decodeEntities(m[1]).trim() : '';
}

/**
 * One "Opened … ago" (or Closed, or Last modified) line from the date block.
 * Trac renders these as a relative phrase whose title carries the absolute
 * moment — both are kept, the relative for display, the absolute for the
 * tooltip.
 *
 * @param {string} html
 * @param {string} label
 * @return {{relative: string, absolute: string}|null}
 */
function dateLine(html, label) {
	const re = new RegExp(
		`${label}\\s*<a class="timeline"[^>]*title="See timeline at ([^"]+)"[^>]*>([^<]+)</a>`
	);
	const m = html.match(re);
	if (!m) return null;
	return { absolute: decodeEntities(m[1]).trim(), relative: decodeEntities(m[2]).trim() };
}

/**
 * A `<td headers="h_x">…` cell's links, as `{label, url}` rows.
 *
 * @param {string} html
 * @param {string} header
 * @return {Array<{label: string, url: ?string}>}
 */
function cellLinks(html, header) {
	const cell = html.match(new RegExp(`<td headers="${header}"[^>]*>([\\s\\S]*?)</td>`));
	if (!cell) return [];
	const links = [];
	const linkRe = /<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
	let m;
	while ((m = linkRe.exec(cell[1])) !== null) {
		const label = decodeEntities(m[2]).trim();
		if (label) links.push({ label, url: absoluteTracUrl(m[1]) });
	}
	return links;
}

/**
 * The ticket's own facts, from the `#ticket` block's HTML.
 *
 * Returns null when the HTML holds no recognisable ticket — the caller treats
 * that as "nothing to show", never as an error: the attachments alongside it
 * are still good.
 *
 * @param {string} html
 * @return {?Object}
 */
function parseTicketInfo(html) {
	if (!html || !/trac-status|trac-ticket-title/.test(html)) return null;

	const summary = capture(html, /<span class="summary">([^<]*)<\/span>/);
	const status = capture(html, /<span class="trac-status">\s*<a[^>]*>([^<]+)<\/a>/);
	const type = capture(html, /<span class="trac-type">\s*<a[^>]*>([^<]+)<\/a>/);
	// Only present on closed tickets, rendered as "(fixed)" beside the status.
	const resolution = capture(html, /<span class="trac-resolution">\s*\(<a[^>]*>([^<]+)<\/a>/);

	const [milestone] = cellLinks(html, 'h_milestone');
	const [component] = cellLinks(html, 'h_component');
	const keywords = cellLinks(html, 'h_keywords');

	return {
		summary,
		status,
		type,
		resolution,
		opened: dateLine(html, 'Opened'),
		closed: dateLine(html, 'Closed'),
		milestone: milestone ? milestone.label : '',
		component: component || null,
		keywords
	};
}

/**
 * The status pill's text and tone, as one decision.
 *
 * "closed (fixed)" and "closed (wontfix)" read as opposite instructions — go
 * find another ticket vs read the discussion first — so the resolution rides
 * inside the pill rather than being a separate fact. Tone is a name the panel
 * maps to its palettes, not a colour, so this stays a pure module.
 *
 * @param {?Object} info From parseTicketInfo.
 * @return {?{label: string, tone: 'closed'|'active'}}
 */
function statusBadge(info) {
	if (!info || !info.status) return null;
	const label = info.resolution ? `${info.status} (${info.resolution})` : info.status;
	return { label, tone: info.status === 'closed' ? 'closed' : 'active' };
}

module.exports = { parseTicketInfo, statusBadge };
