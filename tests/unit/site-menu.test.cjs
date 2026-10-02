const test = require('node:test');
const assert = require('node:assert/strict');

const { siteMenuItems, fileManagerLabel } = require('../../src/renderer/site-menu.cjs');

const ids = (items) => items.map((item) => item.id);

test('a site with nothing going on is offered everything, deleting last and set apart', () => {
	const items = siteMenuItems({ platform: 'darwin' });
	assert.deepEqual(ids(items), ['rename', 'copy-path', 'show-in-file-manager', 'update-trunk', 'open-in-other', 'delete']);
	assert.deepEqual(items.map((item) => item.label), ['Rename…', 'Copy path', 'Show in Finder', 'Update to latest trunk', 'Open in other application…', 'Delete site']);
	assert.equal(items.at(-1).separated, true);
	assert.ok(items.slice(0, -1).every((item) => !item.separated));
	assert.ok(items.every((item) => !item.disabled));
});

test('the file manager is named where it has a name, and called what it is elsewhere', () => {
	assert.equal(fileManagerLabel('darwin'), 'Show in Finder');
	assert.equal(fileManagerLabel('win32'), 'Show in Explorer');
	assert.equal(fileManagerLabel('linux'), 'Show in file manager');
	assert.equal(fileManagerLabel(undefined), 'Show in file manager');
});

test('each application detection found is offered by name, before the way to choose another', () => {
	const items = siteMenuItems({
		platform: 'win32',
		editors: [{ name: 'Visual Studio Code', path: 'C:\\Code.exe' }, { name: 'Zed', path: 'C:\\zed.exe' }]
	});
	assert.deepEqual(ids(items), ['rename', 'copy-path', 'show-in-file-manager', 'update-trunk', 'open-in', 'open-in', 'open-in-other', 'delete']);
	const offered = items.filter((item) => item.id === 'open-in');
	assert.deepEqual(offered.map((item) => item.label), ['Open in Visual Studio Code', 'Open in Zed']);
	assert.deepEqual(offered.map((item) => item.path), ['C:\\Code.exe', 'C:\\zed.exe']);
});

test('choosing another application is offered whatever detection found, and while it is still looking', () => {
	assert.ok(ids(siteMenuItems({ editors: [] })).includes('open-in-other'));
	assert.ok(ids(siteMenuItems({ editors: null })).includes('open-in-other'));
	const looking = siteMenuItems({ detecting: true });
	assert.deepEqual(ids(looking), ['rename', 'copy-path', 'show-in-file-manager', 'update-trunk', 'detecting', 'open-in-other', 'delete']);
	const row = looking.find((item) => item.id === 'detecting');
	assert.equal(row.label, 'Looking for applications…');
	assert.equal(row.disabled, true);
});

test('a site still being set up cannot be deleted from the menu', () => {
	const items = siteMenuItems({ isPending: true });
	assert.ok(!ids(items).includes('delete'));
	assert.ok(!ids(items).includes('deleting'));
	// And not while it is both, which cannot happen but must not offer it.
	assert.ok(!ids(siteMenuItems({ isPending: true, isDeleting: true })).includes('deleting'));
});

test('a site being deleted says so where deleting was, and that cannot be pressed', () => {
	const items = siteMenuItems({ isDeleting: true });
	assert.ok(!ids(items).includes('delete'));
	const row = items.at(-1);
	assert.deepEqual(row, { id: 'deleting', label: 'Deleting…', disabled: true, separated: true });
});

test('no arguments at all is the menu of an ordinary site', () => {
	assert.deepEqual(ids(siteMenuItems()), ['rename', 'copy-path', 'show-in-file-manager', 'update-trunk', 'open-in-other', 'delete']);
});
