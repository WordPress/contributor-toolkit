const test = require('node:test');
const assert = require('node:assert/strict');

const { siteMenuItems, openInItems, fileManagerLabel, updateHeldReason } = require('../../src/renderer/site-menu.cjs');

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

test('the way to choose another application is first, then each one detection found by its name', () => {
	const items = openInItems({
		editors: [{ name: 'Visual Studio Code', path: 'C:\\Code.exe' }, { name: 'Zed', path: 'C:\\zed.exe' }]
	});
	assert.deepEqual(items, [
		{ id: 'open-in-other', label: 'Other application…' },
		{ id: 'open-in', label: 'Visual Studio Code', path: 'C:\\Code.exe' },
		{ id: 'open-in', label: 'Zed', path: 'C:\\zed.exe' }
	]);
});

test('choosing another application is offered whatever detection found, and while it is still looking', () => {
	assert.deepEqual(ids(openInItems({ editors: [] })), ['open-in-other']);
	assert.deepEqual(ids(openInItems({ editors: null })), ['open-in-other']);
	assert.deepEqual(ids(openInItems()), ['open-in-other']);
	const looking = openInItems({ editors: [{ name: 'Zed', path: '/zed' }], detecting: true });
	assert.deepEqual(ids(looking), ['open-in-other', 'open-in', 'detecting']);
	assert.deepEqual(looking.at(-1), { id: 'detecting', label: 'Looking for applications…', disabled: true });
});

test('nothing that can be pressed moves when detection answers', () => {
	// The three lists a contributor can see in one opening of the menu, on a
	// machine where nothing was known, and on one where an editor was: while
	// looking, and after. A row that is in both keeps its place.
	const zed = { name: 'Zed', path: '/zed' };
	const code = { name: 'Visual Studio Code', path: '/code' };
	const sequences = [
		[openInItems({ detecting: true }), openInItems({ editors: [zed, code] })],
		[openInItems({ editors: [zed], detecting: true }), openInItems({ editors: [zed] })],
		[openInItems({ editors: [zed], detecting: true }), openInItems({ editors: [zed, code] })]
	];
	const keyOf = (item) => item.path || item.id;
	for (const [before, after] of sequences) {
		before.forEach((item, index) => {
			if (item.disabled) return;
			const then = after.findIndex((other) => keyOf(other) === keyOf(item));
			assert.equal(then, index, `${item.label} moved from row ${index} to row ${then}`);
		});
	}
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

test('an update can start when no update, install or build is running', () => {
	assert.equal(updateHeldReason(), '');
	assert.equal(updateHeldReason({}), '');
	assert.equal(updateHeldReason({ isUpdating: false, installing: false, building: false }), '');
});

test('an update is held by an update, an install or a build, and the reason names which', () => {
	assert.equal(updateHeldReason({ isUpdating: true }), 'Wait for the trunk update to finish.');
	assert.equal(updateHeldReason({ installing: true }), 'Wait for the installation to finish.');
	assert.equal(updateHeldReason({ building: true }), 'Wait for the build to finish.');
});

test('an update that is installing or building is named as the update, not as its step', () => {
	// The chain runs its own install and build, so their flags are up while
	// it is: the reason must not send the contributor to wait for a build
	// when what is in the way is the whole update.
	assert.equal(updateHeldReason({ isUpdating: true, installing: true }), 'Wait for the trunk update to finish.');
	assert.equal(updateHeldReason({ isUpdating: true, building: true }), 'Wait for the trunk update to finish.');
	assert.equal(updateHeldReason({ installing: true, building: true }), 'Wait for the installation to finish.');
});

test('a held update keeps its place and its name in the menu, cannot be pressed, and says why', () => {
	const reason = updateHeldReason({ building: true });
	const items = siteMenuItems({ platform: 'darwin', updateHeld: reason });
	assert.deepEqual(ids(items), TOP);
	assert.deepEqual(items.find((item) => item.id === 'update-trunk'), { id: 'update-trunk', label: 'Update to latest trunk', disabled: true, description: reason });
	// Nothing else is held with it.
	assert.ok(items.filter((item) => item.id !== 'update-trunk').every((item) => !item.disabled && !item.description));
});

test('an update that is not held carries no reason', () => {
	for (const updateHeld of ['', undefined]) {
		assert.deepEqual(siteMenuItems({ updateHeld }).find((item) => item.id === 'update-trunk'), { id: 'update-trunk', label: 'Update to latest trunk' });
	}
});

test('no arguments at all is the menu of an ordinary site', () => {
	assert.deepEqual(ids(siteMenuItems()), TOP);
});
