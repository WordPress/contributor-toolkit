const test = require('node:test');
const assert = require('node:assert/strict');

const { siteMenuItems, openInItems, fileManagerLabel } = require('../../src/renderer/site-menu.cjs');

const ids = (items) => items.map((item) => item.id);
const TOP = ['rename', 'copy-path', 'show-in-file-manager', 'update-trunk', 'open-in-menu', 'delete'];

test('a site with nothing going on is offered everything, deleting last and set apart', () => {
	const items = siteMenuItems({ platform: 'darwin' });
	assert.deepEqual(ids(items), TOP);
	assert.deepEqual(items.map((item) => item.label), ['Rename…', 'Copy path', 'Show in Finder', 'Update to latest trunk', 'Open in', 'Delete site']);
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

test('the menu\'s own list is the same whatever detection finds and while it is still looking', () => {
	// What a contributor is about to press must not move: "Delete site" is
	// in this list, and detection answers after the menu is on screen.
	const editors = [{ name: 'Visual Studio Code', path: 'C:\\Code.exe' }, { name: 'Zed', path: 'C:\\zed.exe' }];
	for (const state of [{}, { detecting: true }, { editors }, { editors, detecting: true }, { editors: null }]) {
		const items = siteMenuItems({ platform: 'win32', ...state });
		assert.deepEqual(ids(items), TOP);
		assert.deepEqual(items.map((item) => item.label), ['Rename…', 'Copy path', 'Show in Explorer', 'Update to latest trunk', 'Open in', 'Delete site']);
	}
});

test('each application detection found is offered by its name, before the way to choose another', () => {
	const items = openInItems({
		editors: [{ name: 'Visual Studio Code', path: 'C:\\Code.exe' }, { name: 'Zed', path: 'C:\\zed.exe' }]
	});
	assert.deepEqual(items, [
		{ id: 'open-in', label: 'Visual Studio Code', path: 'C:\\Code.exe' },
		{ id: 'open-in', label: 'Zed', path: 'C:\\zed.exe' },
		{ id: 'open-in-other', label: 'Other application…' }
	]);
});

test('choosing another application is offered whatever detection found, and while it is still looking', () => {
	assert.deepEqual(ids(openInItems({ editors: [] })), ['open-in-other']);
	assert.deepEqual(ids(openInItems({ editors: null })), ['open-in-other']);
	assert.deepEqual(ids(openInItems()), ['open-in-other']);
	const looking = openInItems({ editors: [{ name: 'Zed', path: '/zed' }], detecting: true });
	assert.deepEqual(ids(looking), ['open-in', 'detecting', 'open-in-other']);
	assert.deepEqual(looking[1], { id: 'detecting', label: 'Looking for applications…', disabled: true });
});

test('the menu carries the applications under "Open in"', () => {
	const editors = [{ name: 'Zed', path: '/zed' }];
	const openIn = siteMenuItems({ editors, detecting: true }).find((item) => item.id === 'open-in-menu');
	assert.deepEqual(openIn.items, openInItems({ editors, detecting: true }));
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
	assert.deepEqual(items.at(-1), { id: 'deleting', label: 'Deleting…', disabled: true, separated: true });
});

test('no arguments at all is the menu of an ordinary site', () => {
	assert.deepEqual(ids(siteMenuItems()), TOP);
});
