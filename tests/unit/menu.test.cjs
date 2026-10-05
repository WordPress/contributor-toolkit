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
});
