// The files the change on the checkout touched, in the site's details (#669),
// and what one click on one of them does. Pure, like site-details.cjs: the
// renderer bundle imports it and `node --test` requires it directly.
'use strict';

/**
 * The paths to list, in the order the patch changed them, or none when
 * nothing is applied. An empty list is no section at all.
 *
 * @param {Object}  root0
 * @param {?Object} [root0.appliedPatch] From `site:status`: `{ label, files, ... }`.
 * @return {string[]}
 */
function affectedFiles({ appliedPatch = null } = {}) {
	return Array.isArray(appliedPatch?.files) ? appliedPatch.files : [];
}

/**
 * Where a click on a file sends it: the first editor detection found, which
 * is the first the site menu's "Open in" offers, or the file manager when
 * there is none. The file manager rather than nothing, so the link always
 * does something.
 *
 * @param {Object} root0
 * @param {Array}  [root0.editors] Detected applications, `{ name, path }`, in detection's order.
 * @return {{kind: 'editor', path: string}|{kind: 'reveal'}}
 */
function fileOpenTarget({ editors = [] } = {}) {
	const first = Array.isArray(editors) ? editors[0] : null;
	return first ? { kind: 'editor', path: first.path } : { kind: 'reveal' };
}

module.exports = { affectedFiles, fileOpenTarget };
