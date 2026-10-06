'use strict';

/**
 * What the app starts again at its next launch (#559): with the quit setting
 * on 'restart', the sites whose development server or build watch was
 * running when it quit. The quit sweep stops them either way; this is the
 * list that brings them back.
 *
 * Pure, so `node --test` covers it: main hands it what it tracks of its
 * children, and reads back what the store holds.
 */

/**
 * The sites to start again, from what is running now.
 *
 * A site with a server is listed once, under the servers, and its watch is
 * not listed as well: on the projects whose server needs the watch, the
 * server's start brings the watch with it, and on the others the watch is
 * the contributor's to start.
 *
 * @param {Object}                                                                   root0
 * @param {string[]}                                                                 root0.servers  The sites with a running server.
 * @param {Array<{directoryPath: string, scriptName: string, scriptArgs: string[]}>} root0.scripts  The scripts running, by site.
 * @param {Function}                                                                 root0.watchFor Given a site, what its project runs as its watch: `{ script, args }`.
 * @return {{servers: string[], watches: string[]}}
 */
function sitesToResume({ servers = [], scripts = [], watchFor }) {
	const withServer = [...new Set(servers)];
	const watches = [];
	for (const { directoryPath, scriptName, scriptArgs = [] } of scripts) {
		if (withServer.includes(directoryPath) || watches.includes(directoryPath)) continue;
		const watch = watchFor(directoryPath);
		if (!watch) continue;
		const sameArgs = JSON.stringify(watch.args || []) === JSON.stringify(scriptArgs || []);
		if (watch.script === scriptName && sameArgs) watches.push(directoryPath);
	}
	return { servers: withServer, watches };
}

/**
 * What the store holds to start again, and only while the quit setting still
 * says so: a list left by a launch under 'restart' is not followed under
 * 'stop'.
 *
 * @param {Object} preferences The store's `preferences`.
 * @return {{servers: string[], watches: string[]}}
 */
function readResume(preferences) {
	const stored = preferences && typeof preferences === 'object' ? preferences : {};
	const list = stored.resume && typeof stored.resume === 'object' ? stored.resume : {};
	const paths = (value) => (Array.isArray(value) ? value.filter((entry) => typeof entry === 'string' && entry) : []);
	if (stored.quitBehavior !== 'restart') return { servers: [], watches: [] };
	return { servers: paths(list.servers), watches: paths(list.watches) };
}

module.exports = { sitesToResume, readResume };
