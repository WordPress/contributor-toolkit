'use strict';

/**
 * The app's settings (#559): what each one is called in the store, what it
 * falls back to, and what it accepts.
 *
 * They are app-wide, under `preferences` in the one electron-store beside the
 * contributor's WordPress.org handle and the event they are at: a setting is
 * a fact about the person or their machine, not a property of a checkout.
 * The window reads them once and holds what main last answered, so a change
 * applies to the next thing that asks the window for one.
 *
 * A value is checked here and not only in the window, because the window is
 * not the only thing that writes the store, and because a setting becomes
 * something the app does: the folder is where it makes a site. The module is
 * pure: it is handed what the disk says, so `node --test` covers it without
 * one (same convention as wporg-handle.cjs).
 */

const { __ } = require('@wordpress/i18n');
const { THEMES } = require('./theme.cjs');

// What the quit setting can be.
const QUIT_BEHAVIOURS = ['stop', 'restart'];

// A switch: on or off, and nothing for the fallback.
function acceptSwitch(value) {
	if (value === null || value === undefined) return { ok: true, value: null };
	if (typeof value !== 'boolean') return { ok: false, error: __('Choose on or off.') };
	return { ok: true, value };
}

/**
 * Each setting by the key it is stored under: what it falls back to, and
 * `accept(value, deps)`, which gives back the value to store or a refusal
 * for the contributor, not for a log.
 */
const SETTINGS = {
	// The language the app shows: one it has a catalog for, English, or
	// nothing for the operating system's. The window shows a change after a
	// relaunch, since main applies the catalog as it starts.
	locale: {
		fallback: null,
		accept(value, { isLanguage }) {
			if (value === null || value === undefined || value === '') return { ok: true, value: null };
			if (typeof value !== 'string') return { ok: false, error: __('Choose a language.') };
			if (!isLanguage(value)) return { ok: false, error: __('The app has no translation for that language.') };
			return { ok: true, value };
		}
	},
	// The PHP a site's development server runs on, one of the versions the
	// bundled Playground has; applied at the next start of a server.
	phpVersion: {
		fallback: '8.3',
		accept(value, { isPhpVersion }) {
			if (value === null || value === undefined || value === '') return { ok: true, value: null };
			if (typeof value !== 'string' || !isPhpVersion(value)) return { ok: false, error: __('The app does not have that PHP version.') };
			return { ok: true, value };
		}
	},
	// WP_DEBUG and SCRIPT_DEBUG, on unless turned off here; the rest of the
	// constants a server is booted with are wp-debug-constants.js's and not
	// anyone's to change.
	wpDebug: { fallback: true, accept: acceptSwitch },
	scriptDebug: { fallback: true, accept: acceptSwitch },
	// What starts when a site is opened: its development server, its build
	// watch, both or neither. Off unless turned on: a server is minutes of
	// CPU on a laptop at a Contributor Day.
	autoStartServer: { fallback: false, accept: acceptSwitch },
	autoStartWatch: { fallback: false, accept: acceptSwitch },
	// What happens to running servers and watches when the app quits: they
	// are stopped either way, since the quit sweep ends every child the app
	// started; 'restart' remembers which sites had one and starts them
	// again at the next launch.
	quitBehavior: {
		fallback: 'stop',
		accept(value) {
			if (value === null || value === undefined || value === '') return { ok: true, value: null };
			if (!QUIT_BEHAVIOURS.includes(value)) return { ok: false, error: __('Choose what happens when the app quits.') };
			return { ok: true, value };
		}
	},
	// The window's theme (#560): light, dark, or the operating system's,
	// which is the fallback. Main applies it to Electron's native theme, and
	// the window follows what Chromium then says of the colour scheme.
	theme: {
		fallback: 'system',
		accept(value) {
			if (value === null || value === undefined || value === '') return { ok: true, value: null };
			if (!THEMES.includes(value)) return { ok: false, error: __('Choose light, dark, or your system’s theme.') };
			return { ok: true, value };
		}
	},
	// The folder new sites are made in, each in a subfolder of its own. Unset,
	// the create-site dialog asks for one every time, as it did before. The
	// path is kept as the system's dialog gave it: a folder's name can end in
	// a space, and trimmed it would be another folder's.
	newSiteLocation: {
		fallback: null,
		accept(value, { isAbsolute, isDirectory }) {
			if (value === null || value === undefined) return { ok: true, value: null };
			if (typeof value !== 'string') return { ok: false, error: __('Choose a folder.') };
			if (!value.trim()) return { ok: true, value: null };
			if (!isAbsolute(value)) return { ok: false, error: __('Choose a folder by its full path.') };
			if (!isDirectory(value)) return { ok: false, error: __('That folder does not exist.') };
			return { ok: true, value };
		}
	}
};

/**
 * Every setting, as the window shows it: what the store holds where it holds
 * one, and the fallback where it does not or where what it holds is not of
 * the setting's kind.
 *
 * Only the kind is checked here, and not what the disk says: a folder that
 * has gone since it was chosen is still the folder that was chosen, and the
 * create-site dialog says where a site would go before anything is made.
 *
 * @param {Object} [preferences] The store's `preferences`.
 * @return {Object} One value per key of SETTINGS.
 */
function readSettings(preferences = {}) {
	const stored = preferences && typeof preferences === 'object' ? preferences : {};
	const text = (key) => (typeof stored[key] === 'string' && stored[key] ? stored[key] : SETTINGS[key].fallback);
	const flag = (key) => (typeof stored[key] === 'boolean' ? stored[key] : SETTINGS[key].fallback);
	return {
		locale: text('locale'),
		phpVersion: text('phpVersion'),
		wpDebug: flag('wpDebug'),
		scriptDebug: flag('scriptDebug'),
		autoStartServer: flag('autoStartServer'),
		autoStartWatch: flag('autoStartWatch'),
		quitBehavior: QUIT_BEHAVIOURS.includes(stored.quitBehavior) ? stored.quitBehavior : SETTINGS.quitBehavior.fallback,
		theme: THEMES.includes(stored.theme) ? stored.theme : SETTINGS.theme.fallback,
		newSiteLocation: text('newSiteLocation')
	};
}

/**
 * Whether `value` may be stored as the setting `key`, and in what form.
 *
 * @param {string}   key
 * @param {*}        value
 * @param {Object}   deps
 * @param {Function} deps.isAbsolute   Whether a path is a full one on this platform.
 * @param {Function} deps.isDirectory  Whether a path is a folder on this machine.
 * @param {Function} deps.isLanguage   Whether a tag is one of the languages the app can show.
 * @param {Function} deps.isPhpVersion Whether a version is one the bundled Playground has.
 * @return {{ok: true, value: *}|{ok: false, error: string}} The value to store, or why not.
 */
function acceptSetting(key, value, deps) {
	const setting = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
	if (!setting) return { ok: false, error: __('There is no such setting.') };
	return setting.accept(value, deps);
}

module.exports = { SETTINGS, readSettings, acceptSetting };
