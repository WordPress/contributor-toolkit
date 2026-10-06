// The application menu.
//
// The app previously set no menu at all and inherited Electron's default one.
// Setting a menu replaces that default wholesale, so the template below rebuilds
// it out of Electron's built-in roles — anything dropped here is a feature the
// user silently loses. The only real addition is the Help submenu, which is how
// a contributor gets at the log file without knowing where their OS keeps it.
//
// Kept free of Electron imports and of the log module: the caller supplies the
// click handlers, so this file is a plain data structure. Its labels are
// translated when the template is built, so main applies the locale first.
//
// "Settings…" (#559) is where each platform keeps it: in the app menu on
// macOS and under File elsewhere, with the shortcut each has for it. A role
// given a submenu of its own keeps its label and loses its default items, so
// the two menus that hold it are written out, item by item as Electron's
// defaults have them, with the one addition.

const { __ } = require('@wordpress/i18n');

const isMac = (platform = process.platform) => platform === 'darwin';

function buildMenuTemplate({ onOpenLog, onShowLogsFolder, onOpenSettings, platform = process.platform } = {}) {
	const settings = {
		id: 'settings',
		label: __('Settings…'),
		accelerator: 'CmdOrCtrl+,',
		click: () => onOpenSettings?.()
	};
	return [
		// On macOS the first submenu is the app menu (About/Quit/Services). On
		// Windows and Linux those items live under File instead, which `fileMenu`
		// already handles, so this entry is omitted entirely.
		...(isMac(platform) ? [{
			role: 'appMenu',
			submenu: [
				{ role: 'about' },
				{ type: 'separator' },
				settings,
				{ type: 'separator' },
				{ role: 'services' },
				{ type: 'separator' },
				{ role: 'hide' },
				{ role: 'hideOthers' },
				{ role: 'unhide' },
				{ type: 'separator' },
				{ role: 'quit' }
			]
		}] : []),
		isMac(platform)
			? { role: 'fileMenu' }
			: { role: 'fileMenu', submenu: [settings, { type: 'separator' }, { role: 'quit' }] },
		{ role: 'editMenu' },
		{ role: 'viewMenu' },
		{ role: 'windowMenu' },
		{
			role: 'help',
			submenu: [
				{
					// "App Log" rather than "Log": the app also tails each site's
					// WordPress debug.log, and confusing the two would send people
					// to the wrong file.
					label: __('Open App Log'),
					click: () => onOpenLog?.()
				},
				{
					label: __('Show Logs Folder'),
					click: () => onShowLogsFolder?.()
				},
				{ type: 'separator' },
				// Duplicates the View entry on purpose. Someone who does not know
				// the shortcut looks under Help, not View.
				{ role: 'toggleDevTools' }
			]
		}
	];
}

module.exports = { buildMenuTemplate };
