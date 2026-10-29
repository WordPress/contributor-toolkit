// What the page says about step debugging a site with Xdebug (#723): the
// launch.json VS Code needs to listen for it, whether the running server has
// it, and which other sites' servers are sending to the same port.
'use strict';

const { __ } = require('@wordpress/i18n');
const { pathBasename } = require('./path-basename.cjs');

// Playground's Xdebug connects to the client on this port and has no option
// to move it, so every site's server sends to the same one.
const XDEBUG_PORT = 9003;

/**
 * The launch.json a contributor pastes into VS Code, with the PHP Debug
 * extension, to stop on breakpoints in the site.
 *
 * The mapping is what makes a breakpoint hit. A Core site is served from
 * build/, but the PHP there is src/'s, copied line for line by the build, and
 * src/ is what a contributor edits, so the served WordPress maps to src/. A
 * plugin-mount site's checkout is mounted as it is under the plugins
 * directory, so the mount maps to the checkout.
 *
 * This holds while Playground bundles Xdebug 3.4, which reports the paths
 * PHP sees. The CLI also writes a path map for Xdebug 3.5 that maps the
 * served WordPress to build/; once a bundled Xdebug honours it, Xdebug
 * reports host paths and this mapping no longer applies. Check it when
 * moving to a Playground with Xdebug 3.5.
 *
 * @param {Object} root0
 * @param {string} root0.sitePath The checkout's folder, in this platform's form.
 * @param {Object} root0.serve    The project's serve model: `{strategy, pluginSlug}`.
 * @return {string} The file's text.
 */
function xdebugLaunchConfig({ sitePath, serve }) {
	const sep = sitePath.includes('\\') ? '\\' : '/';
	const root = sitePath.endsWith(sep) ? sitePath.slice(0, -1) : sitePath;
	const pathMappings = serve && serve.strategy === 'plugin-mount'
		? { [`/wordpress/wp-content/plugins/${serve.pluginSlug}`]: root }
		: { '/wordpress': `${root}${sep}src` };
	return JSON.stringify({
		version: '0.2.0',
		configurations: [
			{ name: 'Listen for Xdebug', type: 'php', request: 'launch', port: XDEBUG_PORT, pathMappings }
		]
	}, null, 2);
}

/**
 * Whether the site's running server has Xdebug, and what to say when that is
 * not what the setting says. The setting applies at a server's next start,
 * so a change made while one runs is said, and not shown as done.
 *
 * @param {Object}  root0
 * @param {boolean} root0.setting     What the settings hold.
 * @param {boolean} root0.running     The site's server is up.
 * @param {boolean} root0.startedWith It started with Xdebug.
 * @return {{on: boolean, note: string}}
 */
function xdebugStatus({ setting, running, startedWith }) {
	if (!running) return { on: false, note: '' };
	if (startedWith && !setting) return { on: true, note: __('Xdebug is still on for this site until you restart the server.') };
	if (!startedWith && setting) return { on: false, note: __('Xdebug is turned on, but this site started before that. Restart the server to use it.') };
	return { on: startedWith, note: '' };
}

/**
 * What the server's details say of Xdebug: null when there is nothing to
 * say; otherwise whether the server has it, the note from `xdebugStatus`,
 * the launch.json while it has it (and '' when it would not connect), and
 * the other sites whose server is running with it.
 *
 * @param {Object}   root0
 * @param {boolean}  root0.setting     What the settings hold.
 * @param {boolean}  root0.running     The site's server is up.
 * @param {boolean}  root0.startedWith It started with Xdebug.
 * @param {string}   root0.sitePath    The checkout's folder.
 * @param {Object}   root0.serve       The project's serve model.
 * @param {string[]} root0.others      From `otherXdebugSites`.
 * @return {?{on: boolean, note: string, config: string, others: string[]}}
 */
function xdebugSection({ setting, running, startedWith, sitePath, serve, others }) {
	const status = xdebugStatus({ setting, running, startedWith });
	if (!status.on && !status.note) return null;
	return { ...status, config: status.on ? xdebugLaunchConfig({ sitePath, serve }) : '', others };
}

/**
 * The other sites whose server is running with Xdebug, by the name the sites
 * list shows. Their requests reach VS Code on the same port as this site's,
 * and VS Code cannot tell them apart.
 *
 * @param {Object} root0
 * @param {Object} root0.servers  What each site's view last said of its server, by path: `{status, text, xdebug}`.
 * @param {Object} root0.siteMeta The sites' metadata, by path.
 * @param {string} root0.sitePath This site.
 * @return {string[]}
 */
function otherXdebugSites({ servers, siteMeta, sitePath }) {
	return Object.entries(servers || {})
		.filter(([other, report]) => other !== sitePath && report && report.status === 'online' && report.xdebug)
		.map(([other]) => {
			const label = siteMeta && siteMeta[other] && siteMeta[other].label;
			return (label && label.trim()) || pathBasename(other);
		});
}

module.exports = { XDEBUG_PORT, xdebugLaunchConfig, xdebugStatus, xdebugSection, otherXdebugSites };
