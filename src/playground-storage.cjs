'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { removeTree } = require('./remove-tree');

// Playground CLI's `start` command keys its persistent WordPress installation
// by process.cwd(), under ~/.wordpress-playground/sites. Resolve the checkout
// before deleting it: on macOS cwd resolves /var to /private/var. The real
// restart/delete test pins this agreement with the installed CLI.
// Call only after the registry's deletion guard and after stopping the server.
async function removePersistentPlaygroundSite(sitePath) {
	let cwd;
	try {
		cwd = await fs.realpath(sitePath);
	} catch (error) {
		// A checkout removed outside the app has no cwd to resolve. Forgetting
		// that registry entry must not guess which external directory to erase.
		if (error.code === 'ENOENT') return;
		throw error;
	}
	const key = createHash('sha256').update(cwd).digest('hex');
	await removeTree(path.join(os.homedir(), '.wordpress-playground', 'sites', key));
}

module.exports = { removePersistentPlaygroundSite };
