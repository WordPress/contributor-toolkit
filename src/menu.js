// The application menu.
//
// The app previously set no menu at all and inherited Electron's default one.
// Setting a menu replaces that default wholesale, so the template below rebuilds
// it out of Electron's built-in roles — anything dropped here is a feature the
// user silently loses. The only real additions are Settings… and the Help
// submenu, which is how a contributor gets at the log file without knowing
// where their OS keeps it.
//
// Kept free of Electron imports and of the log module: the caller supplies the
// click handlers and the app's name, so this file is a plain data structure.
// Its labels are translated when the template is built, so main applies the
// locale first.
//
// A role supplies an item's action and shortcut, but its label is Electron's
// own English, so every item here is given one of ours (#657). A role given a
// submenu of its own keeps its label and loses its default items, so every
// menu is written out, item by item as Electron 43's defaults have them on
// each platform, each label worded as Electron words it there. A new Electron
// may change those defaults.
//
// "Settings…" (#559) is where each platform keeps it: in the app menu on
// macOS and under File elsewhere, with the shortcut each has for it.

const { __, _x, sprintf } = require('@wordpress/i18n');

const isMac = (platform = process.platform) => platform === 'darwin';

function buildMenuTemplate({ onOpenLog, onShowLogsFolder, onOpenSettings, appName = '', platform = process.platform } = {}) {
	const mac = isMac(platform);
	const settings = {
		id: 'settings',
		label: __('Settings…'),
		accelerator: 'CmdOrCtrl+,',
		click: () => onOpenSettings?.()
	};
	const toggleDevTools = { role: 'toggleDevTools', label: __('Toggle Developer Tools') };
	return [
		// On macOS the first submenu is the app menu (About/Quit/Services). On
		// Windows and Linux those items live under File instead, so this entry
		// is omitted entirely. macOS titles it with the app's name whatever its
		// label says, so it is given none.
		...(mac ? [{
			role: 'appMenu',
			submenu: [
				// translators: %s: the app's name, WordPress Contributor Toolkit.
				{ role: 'about', label: sprintf(__('About %s'), appName) },
				{ type: 'separator' },
				settings,
				{ type: 'separator' },
				{ role: 'services', label: __('Services') },
				{ type: 'separator' },
				// translators: %s: the app's name, WordPress Contributor Toolkit.
				{ role: 'hide', label: sprintf(__('Hide %s'), appName) },
				{ role: 'hideOthers', label: __('Hide Others') },
				{ role: 'unhide', label: __('Show All') },
				{ type: 'separator' },
				// translators: %s: the app's name, WordPress Contributor Toolkit.
				{ role: 'quit', label: sprintf(__('Quit %s'), appName) }
			]
		}] : []),
		{
			role: 'fileMenu',
			label: __('File'),
			submenu: mac
				? [{ role: 'close', label: __('Close Window') }]
				// Exit on Windows, as Electron words it there.
				: [settings, { type: 'separator' }, { role: 'quit', label: platform === 'win32' ? __('Exit') : __('Quit') }]
		},
		{
			role: 'editMenu',
			label: __('Edit'),
			submenu: [
				{ role: 'undo', label: __('Undo') },
				{ role: 'redo', label: __('Redo') },
				{ type: 'separator' },
				{ role: 'cut', label: __('Cut') },
				{ role: 'copy', label: __('Copy') },
				{ role: 'paste', label: __('Paste') },
				...(mac ? [
					{ role: 'pasteAndMatchStyle', label: __('Paste and Match Style') },
					{ role: 'delete', label: __('Delete') },
					{ role: 'selectAll', label: __('Select All') },
					{ type: 'separator' },
					{
						label: __('Substitutions'),
						submenu: [
							{ role: 'showSubstitutions', label: __('Show Substitutions') },
							{ type: 'separator' },
							{ role: 'toggleSmartQuotes', label: __('Smart Quotes') },
							{ role: 'toggleSmartDashes', label: __('Smart Dashes') },
							{ role: 'toggleTextReplacement', label: __('Text Replacement') }
						]
					},
					{
						label: __('Speech'),
						submenu: [
							{ role: 'startSpeaking', label: __('Start Speaking') },
							{ role: 'stopSpeaking', label: __('Stop Speaking') }
						]
					}
				] : [
					{ role: 'delete', label: __('Delete') },
					{ type: 'separator' },
					{ role: 'selectAll', label: __('Select All') }
				])
			]
		},
		{
			role: 'viewMenu',
			label: __('View'),
			submenu: [
				{ role: 'reload', label: __('Reload') },
				{ role: 'forceReload', label: __('Force Reload') },
				toggleDevTools,
				{ type: 'separator' },
				{ role: 'resetZoom', label: __('Actual Size') },
				{ role: 'zoomIn', label: __('Zoom In') },
				{ role: 'zoomOut', label: __('Zoom Out') },
				{ type: 'separator' },
				{ role: 'togglefullscreen', label: __('Toggle Full Screen') }
			]
		},
		{
			role: 'windowMenu',
			label: __('Window'),
			submenu: [
				{ role: 'minimize', label: __('Minimize') },
				{ role: 'zoom', label: _x('Zoom', 'the Window menu: make the window fill the screen, or back') },
				...(mac
					? [{ type: 'separator' }, { role: 'front', label: __('Bring All to Front') }]
					: [{ role: 'close', label: __('Close') }])
			]
		},
		{
			role: 'help',
			label: __('Help'),
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
				toggleDevTools
			]
		}
	];
}

module.exports = { buildMenuTemplate };
