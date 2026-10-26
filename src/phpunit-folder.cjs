'use strict';

const path = require('path');
const crypto = require('crypto');

// The folder a site's PHP unit test files live in: its SQLite plugin, drop-in,
// database, test config and wrapper, under the app's own `php-tests`
// directory. Named by a hash of the site's path, so it is one folder per site
// and nothing about the path has to be safe in a file name. The runner writes
// it; deleting the site removes it.
//
// Apart from phpunit-plan.cjs because it needs `crypto`, and that module is
// also bundled into the window, where there is none.
function phpunitSiteFolder(toolkitDir, sitePath) {
	const key = crypto.createHash('sha256').update(path.resolve(sitePath)).digest('hex').slice(0, 16);
	return path.join(toolkitDir, key);
}

module.exports = { phpunitSiteFolder };
