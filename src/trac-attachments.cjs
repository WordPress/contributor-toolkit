'use strict';

/**
 * Reading the attachment list off a Trac ticket page (issue #109 / #11).
 *
 * On many tickets — good-first-bugs especially — the work a contributor wants
 * to try is a `.diff` attached to the ticket, not a pull request. Trac serves
 * that list only inside a real browser (everything else meets the proof-of-work
 * interstitial), so the embedded view scrapes the `#attachments` block's HTML
 * and hands it here to turn into rows.
 *
 * Parsing is done by regex over the HTML string, not with DOM selectors,
 * precisely so it can be unit tested under `node --test` without a browser —
 * the same approach core's own `grunt-patch-wordpress` takes. The Trac
 * attachment markup has been stable for years, which is what makes this
 * tractable; the fragile part is contained here and covered by fixtures.
 *
 * Each attachment appears as a `<dt>…</dt>` inside the block, carrying a link to
 * `/attachment/ticket/<id>/<file>` (and usually a raw link too), the author,
 * a date, and a size. Missing pieces degrade to empty strings rather than
 * dropping the row — a filename with a working download link is useful even
 * without its metadata.
 */

/**
 * The canonical raw download URL for an attachment path. Trac serves the file
 * itself under `raw-attachment`; the `attachment` path is the HTML view. Same
 * transform core's grunt-patch-wordpress uses.
 *
 * @param {string} pathOrUrl
 * @return {string}
 */
const TRAC_HOST = 'core.trac.wordpress.org';

function toRawUrl(pathOrUrl) {
	const abs = pathOrUrl.startsWith('http') ? pathOrUrl : `https://${TRAC_HOST}${pathOrUrl}`;
	return abs.replace('/attachment/ticket/', '/raw-attachment/ticket/');
}

/**
 * @param {string} chunk HTML of one `<dt>…</dt>` (plus its `<dd>` if present).
 * @param {string} id
 * @return {{filename: string, url: string, author: string, dateText: string, sizeText: string, applyable: boolean}|null}
 */
function parseOne(chunk, id) {
	// The attachment link names the file. Accept both the view and raw forms;
	// the id guard keeps stray links (e.g. to other tickets) out.
	const link = new RegExp(`href="((?:https?://[^"]+)?/(?:raw-)?attachment/ticket/${id}/([^"?]+))"`).exec(chunk);
	if (!link) return null;
	const url = toRawUrl(link[1]);
	// The parser must never emit an off-host URL: an absolute href on another
	// host would pass the id-shaped path check, and the filename is rendered as
	// an openExternal link. Rejecting the row here means a poisoned ticket page
	// cannot get an attacker URL in front of the user.
	try {
		if (new URL(url).hostname !== TRAC_HOST) return null;
	} catch {
		return null;
	}
	const filename = decodeURIComponent(link[2]);

	// Author: the trac-author anchor, or its text. Falls back to empty.
	const authorMatch = /class="trac-author[^"]*"[^>]*>([^<]+)</.exec(chunk)
		|| /added by\s+<[^>]*>([^<]+)</.exec(chunk);
	const author = authorMatch ? authorMatch[1].trim() : '';

	// Prefer an absolute timestamp from a title attribute over relative text
	// ("15 months ago"), which cannot be sorted or aged.
	const absDate = /title="See timeline at ([^"]+)"/.exec(chunk)
		|| /\(((?:0?[1-9]|1[0-2])\/\d{1,2}\/\d{4}[^)]*)\)/.exec(chunk);
	const relDate = /([\d]+\s+(?:years?|months?|weeks?|days?|hours?|minutes?)\s+ago)/.exec(chunk);
	const dateMatch = absDate || relDate;
	const dateText = dateMatch ? dateMatch[1].trim() : '';

	const sizeMatch = /\(\s*([\d.]+\s*[KMG]?B)\s*\)/i.exec(chunk);
	const sizeText = sizeMatch ? sizeMatch[1].replace(/\s+/g, ' ').trim() : '';

	return {
		filename,
		url,
		author,
		dateText,
		sizeText,
		// Only unified diffs can be applied; a .txt or .zip is listed context.
		applyable: /\.(diff|patch)$/i.test(filename)
	};
}

/**
 * Parses the scraped `#attachments` block into attachment rows, newest markup
 * order preserved (Trac lists oldest-first). Deduplicates by filename, since
 * each attachment carries both a raw and a view link.
 *
 * @param {string}        attachmentsHtml outerHTML of `#attachments`, or ''.
 * @param {number|string} ticketId
 * @return {Array}
 */
function parseAttachments(attachmentsHtml, ticketId) {
	const html = typeof attachmentsHtml === 'string' ? attachmentsHtml : '';
	const id = String(ticketId).replace(/[^0-9]/g, '');
	if (!html || !id) return [];

	// Split on <dt> so each attachment's metadata stays with its link. The
	// leading segment before the first <dt> (heading) yields no link and drops.
	const chunks = html.split(/<dt[\s>]/i);
	const seen = new Set();
	const rows = [];
	for (const chunk of chunks) {
		const row = parseOne(chunk, id);
		if (!row || seen.has(row.filename)) continue;
		seen.add(row.filename);
		rows.push(row);
	}
	return rows;
}

module.exports = { toRawUrl, parseAttachments };
