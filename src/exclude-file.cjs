'use strict';

/**
 * The one writer of the app's blocks in a site's `.git/info/exclude` (#523):
 * the machine-local excludes and the generated Gutenberg download main.js
 * seeds (#19), and the files another branch ignored that a switch leaves
 * behind (#521). No Electron, so ticket-branches.js can use it too.
 *
 * A block is its marker line and the rules under it. Rules above or below the
 * app's blocks are never rewritten; this only appends.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Appends `marker` and `lines` to `<dir>/.git/info/exclude`, creating the file
 * and its directory when missing.
 *
 * By default only the lines not already in the file are appended, with the
 * marker first when it is not there yet. With `once`, the block is written
 * whole when its marker is missing and not at all when it is present: from
 * then on the contributor owns it, and a rule they removed is not restored.
 *
 * @param {string}   dir          Repository working directory.
 * @param {string}   marker       The block's marker line.
 * @param {string[]} lines        The block's rules.
 * @param {Object}   [root0]
 * @param {boolean}  [root0.once] Write the block only when its marker is missing.
 * @return {Promise<boolean>} Whether anything was appended.
 */
async function appendExcludeBlock(dir, marker, lines, { once = false } = {}) {
	const infoDir = path.join(dir, '.git', 'info');
	const excludePath = path.join(infoDir, 'exclude');
	let existing = '';
	try {
		existing = await fs.promises.readFile(excludePath, 'utf8');
	} catch (error) {
		if (!error || error.code !== 'ENOENT') throw error;
	}
	const present = new Set(existing.split(/\r?\n/));
	let block;
	if (once) block = present.has(marker) ? [] : [marker, ...lines];
	else {
		block = lines.filter((line) => !present.has(line));
		if (block.length && !present.has(marker)) block.unshift(marker);
	}
	if (!block.length) return false;

	await fs.promises.mkdir(infoDir, { recursive: true });
	const separator = existing && !existing.endsWith('\n') ? '\n' : '';
	await fs.promises.appendFile(excludePath, `${separator}${block.join('\n')}\n`);
	return true;
}

module.exports = { appendExcludeBlock };
