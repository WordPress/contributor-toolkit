// Guards the Linux desktop identity of the packaged app.
//
// Electron names the running app after desktopName in package.json: it is the Wayland app_id, the
// X11 WM_CLASS and what setAsDefaultProtocolClient('wpct') hands to xdg-settings. electron-builder
// names the installed .desktop file after build.linux.executableName. The two have to agree, or the
// desktop cannot tie the open window to its menu entry and the wpct:// registration names a file
// that does not exist (#782).

const test = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('../../package.json');

test('desktopName names the .desktop file the Linux packages install', () => {
	assert.equal(pkg.desktopName, `${pkg.build.linux.executableName}.desktop`);
});
