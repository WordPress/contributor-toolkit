'use strict';

/**
 * The app's settings (#559): what each one is called in the store, what it
 * falls back to, and what it accepts.
 *
 * They are app-wide, under `preferences` in the one electron-store beside the
 * contributor's WordPress.org handle and the event they are at: a setting is
 * a fact about the person or their machine, not a property of a checkout.
 * Main reads a setting at the moment it is used, so a change applies to the
 * next thing that reads it.
 *
 * A value is checked here and not only in the window, because the window is
 * not the only thing that writes the store, and because some of these values
 * become a path the app creates in or a line in a file it writes. The module
 * is pure: it is handed what it has to ask the disk, so `node --test` covers
 * it without one (same convention as wporg-handle.cjs).
 */

const { __ } = require('@wordpress/i18n');

/**
 * Each setting by the key it is stored under: what it falls back to, and
 * `accept(value, deps)`, which gives back the value to store or a refusal
 * for the contributor, not for a log.
 */
const SETTINGS = {
	// The folder new sites are made in, each in a subfolder of its own. Unset,
	// the create-site dialog asks for one every time, as it did before.
	newSiteLocation: {
		fallback: null,
		accept(value, { isAbsolute, isDirectory }) {
			if (value === null || value === undefined) return { ok: true, value: null };
			if (typeof value !== 'string') return { ok: false, error: __('Choose a folder.') };
			const folder = value.trim();
			if (!folder) return { ok: true, value: null };
			if (!isAbsolute(folder)) return { ok: false, error: __('Choose a folder by its full path.') };
			if (!isDirectory(folder)) return { ok: false, error: __('That folder does not exist.') };
			return { ok: true, value: folder };
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
	return {
		newSiteLocation: typeof stored.newSiteLocation === 'string' && stored.newSiteLocation ? stored.newSiteLocation : SETTINGS.newSiteLocation.fallback
	};
}

/**
 * Whether `value` may be stored as the setting `key`, and in what form.
 *
 * @param {string}   key
 * @param {*}        value
 * @param {Object}   deps
 * @param {Function} deps.isAbsolute  Whether a path is a full one on this platform.
 * @param {Function} deps.isDirectory Whether a path is a folder on this machine.
 * @return {{ok: true, value: *}|{ok: false, error: string}} The value to store, or why not.
 */
function acceptSetting(key, value, deps) {
	const setting = Object.hasOwn(SETTINGS, key) ? SETTINGS[key] : null;
	if (!setting) return { ok: false, error: __('There is no such setting.') };
	return setting.accept(value, deps);
}

module.exports = { SETTINGS, readSettings, acceptSetting };
