// What the page says about step debugging a site with Xdebug (#723): the
// launch.json VS Code needs to listen for it, the values PhpStorm needs, and
// whether the running server has it.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');

// Playground's Xdebug connects to the client on this port and has no option
// to move it, so every site's server sends to the same one.
const XDEBUG_PORT = 9003;

// Where the editor listens. Without one, VS Code's PHP Debug listens on every
// interface, open to other machines on the network. Playground's Xdebug
// connects to 127.0.0.1 and not to ::1, so it is this address and not
// localhost, which can resolve to ::1.
const XDEBUG_HOST = '127.0.0.1';

/**
 * The launch.json a contributor pastes into VS Code, with the PHP Debug
 * extension, to stop on breakpoints in the site: a listener on this machine
 * only.
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
	const { server, local } = xdebugMapping({ sitePath, serve });
	const pathMappings = { [server]: local };
	return JSON.stringify({
		version: '0.2.0',
		configurations: [
			{ name: 'Listen for Xdebug', type: 'php', request: 'launch', hostname: XDEBUG_HOST, port: XDEBUG_PORT, pathMappings }
		]
	}, null, 2);
}

/**
 * The one mapping between the path PHP sees and the folder on this machine,
 * which every editor needs; see `xdebugLaunchConfig` for why it is this one.
 *
 * @param {Object} root0
 * @param {string} root0.sitePath The checkout's folder, in this platform's form.
 * @param {Object} root0.serve    The project's serve model: `{strategy, pluginSlug}`.
 * @return {{server: string, local: string}}
 */
function xdebugMapping({ sitePath, serve }) {
	const sep = sitePath.includes('\\') ? '\\' : '/';
	const root = sitePath.endsWith(sep) ? sitePath.slice(0, -1) : sitePath;
	return serve && serve.strategy === 'plugin-mount'
		? { server: `/wordpress/wp-content/plugins/${serve.pluginSlug}`, local: root }
		: { server: '/wordpress', local: `${root}${sep}src` };
}

/**
 * What to enter under PHP → Servers in PhpStorm, which keeps its debug setup
 * in its own settings rather than a file in the project: the server the site
 * runs on and its path mapping, each labelled with the field's name there.
 *
 * @param {Object} root0
 * @param {string} root0.sitePath The checkout's folder.
 * @param {Object} root0.serve    The project's serve model.
 * @param {string} root0.url      The running server's address.
 * @return {Array<{id: string, label: string, value: string}>}
 */
function phpStormSettings({ sitePath, serve, url }) {
	const { hostname, port } = new URL(url);
	const { server, local } = xdebugMapping({ sitePath, serve });
	return [
		{ id: 'host', label: __('Host'), value: hostname },
		{ id: 'port', label: __('Port'), value: port },
		{ id: 'local', label: __('File/Directory'), value: local },
		{ id: 'server', label: __('Absolute path on the server'), value: server }
	];
}

/**
 * Whether the site's running server has Xdebug, and what to say when that is
 * not what the setting says. The setting applies at a server's next start,
 * so a change made while one runs is said, and not shown as done. One
 * running server has Xdebug at a time, so a server without it while another
 * site's has it says which site, and how to have it here.
 *
 * @param {Object}  root0
 * @param {boolean} root0.setting       What the settings hold.
 * @param {boolean} root0.running       The site's server is up.
 * @param {boolean} root0.startedWith   It started with Xdebug.
 * @param {string}  [root0.holder]      The name of the site whose server has Xdebug now, or ''.
 * @param {boolean} [root0.heldAtStart] It started without Xdebug because another site's server had it.
 * @return {{on: boolean, note: string}}
 */
function xdebugStatus({ setting, running, startedWith, holder = '', heldAtStart = false }) {
	if (!running) return { on: false, note: '' };
	if (startedWith && !setting) return { on: true, note: __('Xdebug is still on for this site until you restart the server.') };
	if (!startedWith && setting && holder) {
		return {
			on: false,
			note: sprintf(
				// translators: %s: the name of the site whose server has Xdebug.
				__('Xdebug is on for %s. Stop that site’s server, then restart this one to use it here.'),
				holder
			)
		};
	}
	if (!startedWith && setting && heldAtStart) return { on: false, note: __('This site started without Xdebug because another site’s server had it. Restart the server to use it.') };
	if (!startedWith && setting) return { on: false, note: __('Xdebug is turned on, but this site started before that. Restart the server to use it.') };
	return { on: startedWith, note: '' };
}

/**
 * What the server's details say of Xdebug: null when there is nothing to
 * say; otherwise whether the server has it, the note from `xdebugStatus`,
 * and the launch.json for VS Code and the values for PhpStorm while it has
 * it (and nothing when it would not connect).
 *
 * @param {Object}   root0
 * @param {boolean}  root0.setting       What the settings hold.
 * @param {boolean}  root0.running       The site's server is up.
 * @param {boolean}  root0.startedWith   It started with Xdebug.
 * @param {boolean}  [root0.heldAtStart] It started without Xdebug because another site's server had it.
 * @param {string}   root0.sitePath      The checkout's folder.
 * @param {Object}   [root0.servers]     What each site's view last said of its server, by path, from sites-list.cjs.
 * @param {Function} [root0.nameFor]     A site's name, by its path.
 * @param {Object}   root0.serve         The project's serve model.
 * @param {string}   root0.url           The running server's address.
 * @return {?{on: boolean, note: string, config: string, phpStorm: Array}}
 */
function xdebugSection({ setting, running, startedWith, heldAtStart = false, sitePath, servers = {}, nameFor = (dir) => dir, serve, url }) {
	const holderPath = xdebugHolder({ sitePath, servers });
	const status = xdebugStatus({ setting, running, startedWith, holder: holderPath ? nameFor(holderPath) : '', heldAtStart });
	if (!status.on && !status.note) return null;
	return {
		...status,
		config: status.on ? xdebugLaunchConfig({ sitePath, serve }) : '',
		phpStorm: status.on ? phpStormSettings({ sitePath, serve, url }) : []
	};
}

/**
 * The other site whose server has Xdebug now, from what each site's view
 * says of its server. Main names the one that had it once, at this site's
 * start; that server can stop, and another start with it, afterwards.
 *
 * @param {Object} root0
 * @param {string} root0.sitePath This site.
 * @param {Object} root0.servers  What each site's view last said of its server, by path: `{status, text, xdebug}`.
 * @return {?string} Its path, or null for none.
 */
function xdebugHolder({ sitePath, servers }) {
	const found = Object.entries(servers || {}).find(([other, report]) => other !== sitePath && report && report.status === 'online' && report.xdebug);
	return found ? found[0] : null;
}

module.exports = { XDEBUG_PORT, xdebugLaunchConfig, phpStormSettings, xdebugStatus, xdebugSection, xdebugHolder };
