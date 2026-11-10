// What the page says about step debugging a site with Xdebug (#723): the
// launch.json VS Code needs to listen for it, the values PhpStorm needs, and
// whether the running server has it.
'use strict';

const { __, sprintf } = require('@wordpress/i18n');

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
	const { server, local } = xdebugMapping({ sitePath, serve });
	const pathMappings = { [server]: local };
	return JSON.stringify({
		version: '0.2.0',
		configurations: [
			{ name: 'Listen for Xdebug', type: 'php', request: 'launch', port: XDEBUG_PORT, pathMappings }
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
 * running server has Xdebug at a time, so a server started while another
 * site's had it started without it, and says whose.
 *
 * @param {Object}  root0
 * @param {boolean} root0.setting     What the settings hold.
 * @param {boolean} root0.running     The site's server is up.
 * @param {boolean} root0.startedWith It started with Xdebug.
 * @param {string}  [root0.heldBy]    The name of the site whose server had Xdebug when this one started, or ''.
 * @return {{on: boolean, note: string}}
 */
function xdebugStatus({ setting, running, startedWith, heldBy = '' }) {
	if (!running) return { on: false, note: '' };
	if (startedWith && !setting) return { on: true, note: __('Xdebug is still on for this site until you restart the server.') };
	if (!startedWith && setting && heldBy) {
		return {
			on: false,
			note: sprintf(
				// translators: %s: the name of the site whose server has Xdebug.
				__('Xdebug is on for %s, so this site started without it. Stop that site’s server, then restart this one to use it here.'),
				heldBy
			)
		};
	}
	if (!startedWith && setting) return { on: false, note: __('Xdebug is turned on, but this site started before that. Restart the server to use it.') };
	return { on: startedWith, note: '' };
}

/**
 * What the server's details say of Xdebug: null when there is nothing to
 * say; otherwise whether the server has it, the note from `xdebugStatus`,
 * and the launch.json for VS Code and the values for PhpStorm while it has
 * it (and nothing when it would not connect).
 *
 * @param {Object}  root0
 * @param {boolean} root0.setting     What the settings hold.
 * @param {boolean} root0.running     The site's server is up.
 * @param {boolean} root0.startedWith It started with Xdebug.
 * @param {string}  [root0.heldBy]    The name of the site whose server had Xdebug when this one started, or ''.
 * @param {string}  root0.sitePath    The checkout's folder.
 * @param {Object}  root0.serve       The project's serve model.
 * @param {string}  root0.url         The running server's address.
 * @return {?{on: boolean, note: string, config: string, phpStorm: Array}}
 */
function xdebugSection({ setting, running, startedWith, heldBy = '', sitePath, serve, url }) {
	const status = xdebugStatus({ setting, running, startedWith, heldBy });
	if (!status.on && !status.note) return null;
	return {
		...status,
		config: status.on ? xdebugLaunchConfig({ sitePath, serve }) : '',
		phpStorm: status.on ? phpStormSettings({ sitePath, serve, url }) : []
	};
}

module.exports = { XDEBUG_PORT, xdebugLaunchConfig, phpStormSettings, xdebugStatus, xdebugSection };
