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
	assert.equal(mac.find((item) => item.role === 'fileMenu').submenu, undefined, 'File keeps its default items on macOS');

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
		items.filter((i) => i.label).map((i) => i.label),
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
		helpItems(buildMenuTemplate({})).filter((i) => i.label).map((i) => i.label),
		[pseudoLocalize('Open App Log'), pseudoLocalize('Show Logs Folder')]
	);
	assert.equal(
		buildMenuTemplate({ platform: 'win32' }).find((i) => i.role === 'fileMenu').submenu.find((i) => i.id === 'settings').label,
		pseudoLocalize('Settings…')
	);
});
