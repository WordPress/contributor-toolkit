const test = require('node:test');
const assert = require('node:assert/strict');

const { addFilter, removeFilter } = require('@wordpress/hooks');
const { buildMenuTemplate } = require('../../src/menu.js');
const { pseudoLocalize } = require('../../src/renderer/pseudo-locale.cjs');

const roles = (template) => template.map((item) => item.role);
const helpItems = (template) => template.find((item) => item.role === 'help').submenu;

test('rebuilds the default menu roles that setting a menu would otherwise drop', () => {
	// Setting an application menu replaces Electron's default wholesale, so a
	// missing role here is a silent regression in existing menu behaviour.
	for (const platform of ['darwin', 'win32', 'linux']) {
		const template = buildMenuTemplate({ platform });
		for (const role of ['fileMenu', 'editMenu', 'viewMenu', 'windowMenu', 'help']) {
			assert.ok(roles(template).includes(role), `${role} missing on ${platform}`);
		}
	}
});

test('the app menu is macOS-only', () => {
	// On Windows and Linux those items belong under File, which fileMenu covers;
	// an appMenu there would render as a stray empty submenu.
	assert.ok(roles(buildMenuTemplate({ platform: 'darwin' })).includes('appMenu'));
	assert.ok(!roles(buildMenuTemplate({ platform: 'win32' })).includes('appMenu'));
	assert.ok(!roles(buildMenuTemplate({ platform: 'linux' })).includes('appMenu'));
});

// Where each platform keeps its settings (#559): the app menu on macOS, File
// elsewhere. The default items of the menu that holds it are still there,
// since giving a role a submenu replaces the role's own.
test('Settings… is in the app menu on macOS and under File elsewhere, with the platform shortcut', () => {
	const mac = buildMenuTemplate({ platform: 'darwin' });
	const appMenu = mac.find((item) => item.role === 'appMenu').submenu;
	assert.deepEqual(appMenu.filter((i) => i.id).map((i) => i.label), ['Settings…']);
	assert.deepEqual(appMenu.filter((i) => i.role).map((i) => i.role), ['about', 'services', 'hide', 'hideOthers', 'unhide', 'quit']);
	assert.deepEqual(mac.find((item) => item.role === 'fileMenu').submenu.map((i) => i.role), ['close'], 'File keeps its default items on macOS');

	for (const platform of ['win32', 'linux']) {
		const file = buildMenuTemplate({ platform }).find((item) => item.role === 'fileMenu').submenu;
		assert.deepEqual(file.filter((i) => i.id).map((i) => i.label), ['Settings…'], platform);
		assert.deepEqual(file.filter((i) => i.role).map((i) => i.role), ['quit'], platform);
	}

	const item = appMenu.find((i) => i.id === 'settings');
	assert.equal(item.accelerator, 'CmdOrCtrl+,');
});

test('Settings… invokes the handler it was given, and does not throw without one', () => {
	let opened = 0;
	const item = buildMenuTemplate({ platform: 'linux', onOpenSettings: () => { opened++; } })
		.find((i) => i.role === 'fileMenu').submenu.find((i) => i.id === 'settings');
	item.click();
	assert.equal(opened, 1);
	assert.doesNotThrow(() => buildMenuTemplate({ platform: 'darwin' }).find((i) => i.role === 'appMenu').submenu.find((i) => i.id === 'settings').click());
});

test('Help exposes both log entries plus DevTools', () => {
	const items = helpItems(buildMenuTemplate({}));
	assert.deepEqual(
		items.filter((i) => i.label && !i.role).map((i) => i.label),
		['Open App Log', 'Show Logs Folder']
	);
	assert.ok(items.some((i) => i.role === 'toggleDevTools'));
});

test('Help entries invoke the handlers they were given', () => {
	let opened = 0;
	let revealed = 0;
	const items = helpItems(buildMenuTemplate({
		onOpenLog: () => { opened++; },
		onShowLogsFolder: () => { revealed++; }
	}));
	items.find((i) => i.label === 'Open App Log').click();
	items.find((i) => i.label === 'Show Logs Folder').click();
	assert.equal(opened, 1);
	assert.equal(revealed, 1);
});

test('clicking without handlers does not throw', () => {
	// The template is built before the log path is known in some call orders;
	// a click must not take the whole main process down with it.
	const items = helpItems(buildMenuTemplate());
	assert.doesNotThrow(() => items.find((i) => i.label === 'Open App Log').click());
});

test('Help labels are translated when the template is built, not when the module loads', (t) => {
	// main applies the locale before it builds the menu, so a label read at
	// require time would stay English.
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => removeFilter('i18n.gettext', 'test/pseudo-locale'));
	assert.deepEqual(
		helpItems(buildMenuTemplate({})).filter((i) => i.label && !i.role).map((i) => i.label),
		[pseudoLocalize('Open App Log'), pseudoLocalize('Show Logs Folder')]
	);
	assert.equal(
		buildMenuTemplate({ platform: 'win32' }).find((i) => i.role === 'fileMenu').submenu.find((i) => i.id === 'settings').label,
		pseudoLocalize('Settings…')
	);
});

// Giving a role a submenu replaces the role's default items, so each menu is
// written out (#657). These are Electron 43's defaults, by platform; a role
// missing here is a menu item or a shortcut the user silently loses.
test('every menu holds the items Electron\'s default menu has on that platform', () => {
	const items = (template, role) => template.find((i) => i.role === role).submenu.map((i) => i.role || i.type || i.label);
	const mac = buildMenuTemplate({ platform: 'darwin' });
	assert.deepEqual(items(mac, 'fileMenu'), ['close']);
	assert.deepEqual(items(mac, 'editMenu'), ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'pasteAndMatchStyle', 'delete', 'selectAll', 'separator', 'Substitutions', 'Speech']);
	const edit = mac.find((i) => i.role === 'editMenu').submenu;
	assert.deepEqual(edit.find((i) => i.label === 'Substitutions').submenu.map((i) => i.role || i.type), ['showSubstitutions', 'separator', 'toggleSmartQuotes', 'toggleSmartDashes', 'toggleTextReplacement']);
	assert.deepEqual(edit.find((i) => i.label === 'Speech').submenu.map((i) => i.role), ['startSpeaking', 'stopSpeaking']);
	assert.deepEqual(items(mac, 'windowMenu'), ['minimize', 'zoom', 'separator', 'front']);
	for (const platform of ['win32', 'linux']) {
		const other = buildMenuTemplate({ platform });
		assert.deepEqual(items(other, 'editMenu'), ['undo', 'redo', 'separator', 'cut', 'copy', 'paste', 'delete', 'separator', 'selectAll'], platform);
		assert.deepEqual(items(other, 'windowMenu'), ['minimize', 'zoom', 'close'], platform);
	}
	for (const platform of ['darwin', 'win32', 'linux']) {
		assert.deepEqual(items(buildMenuTemplate({ platform }), 'viewMenu'), ['reload', 'forceReload', 'toggleDevTools', 'separator', 'resetZoom', 'zoomIn', 'zoomOut', 'separator', 'togglefullscreen'], platform);
	}
});

test('the items that name the app name it, and quitting is worded as each platform words it', () => {
	const appMenu = buildMenuTemplate({ platform: 'darwin', appName: 'Toolkit' }).find((i) => i.role === 'appMenu').submenu;
	const label = (items, role) => items.find((i) => i.role === role).label;
	assert.equal(label(appMenu, 'about'), 'About Toolkit');
	assert.equal(label(appMenu, 'hide'), 'Hide Toolkit');
	assert.equal(label(appMenu, 'quit'), 'Quit Toolkit');
	const quit = (platform) => label(buildMenuTemplate({ platform }).find((i) => i.role === 'fileMenu').submenu, 'quit');
	assert.equal(quit('win32'), 'Exit');
	assert.equal(quit('linux'), 'Quit');
});

test('every menu, and every item in one that is not a separator, has a label translated when the template is built', (t) => {
	// A role's own label is Electron's English, so an item left without one
	// stays English in every language (#657). The app menu is the exception:
	// macOS titles it with the app's name, whatever it is given.
	addFilter('i18n.gettext', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	addFilter('i18n.gettext_with_context', 'test/pseudo-locale', (text) => pseudoLocalize(text));
	t.after(() => {
		removeFilter('i18n.gettext', 'test/pseudo-locale');
		removeFilter('i18n.gettext_with_context', 'test/pseudo-locale');
	});
	const untranslated = (items, where) => items.flatMap((item) => {
		const here = `${where} › ${item.role || item.label}`;
		const bracketed = item.type === 'separator' || item.role === 'appMenu' || /^\[.*\]$/.test(item.label ?? '');
		return [...(bracketed ? [] : [here]), ...(item.submenu ? untranslated(item.submenu, here) : [])];
	});
	for (const platform of ['darwin', 'win32', 'linux']) {
		assert.deepEqual(untranslated(buildMenuTemplate({ platform, appName: 'Toolkit' }), platform), []);
	}
});
