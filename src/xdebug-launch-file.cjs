'use strict';

const path = require('node:path');
const { isActionableSite } = require('./site-registry');

const NOT_THERE = new Set(['ENOENT', 'ENOTDIR']);
const MAX_CONFIG_BYTES = 16 * 1024;

function inside(root, target) {
	const relative = path.relative(root, target);
	return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function refusal(reason) {
	return { ok: false, reason };
}

async function existingLaunchFile(file, root, { realPath, stat }) {
	let realFile;
	try {
		realFile = await realPath(file);
	} catch (error) {
		const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
		return NOT_THERE.has(code) ? { ok: true, exists: false, created: false } : refusal('file-unavailable');
	}
	if (!inside(root, realFile)) return refusal('outside-site');
	try {
		const info = await stat(file);
		return info.isFile() ? { ok: true, exists: true, created: false } : refusal('invalid-file');
	} catch (error) {
		const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
		return NOT_THERE.has(code) ? { ok: true, exists: false, created: false } : refusal('file-unavailable');
	}
}

/**
 * Check for, or create without replacing, the Xdebug launch file for a site.
 *
 * @param {string}   sitePath
 * @param {Object}   deps
 * @param {Array}    deps.sites
 * @param {Array}    deps.pending
 * @param {Function} deps.realPath
 * @param {Function} deps.stat
 * @param {Function} deps.mkdir
 * @param {Function} deps.writeFile
 * @param {string}   [deps.config]
 * @param {boolean}  [deps.create]
 * @return {Promise<{ok: boolean, exists?: boolean, created?: boolean, reason?: string}>}
 */
async function xdebugLaunchConfigFile(sitePath, { sites, pending, realPath, stat, mkdir, writeFile, config, create = false } = {}) {
	if (!isActionableSite(sitePath, { sites, pending })) return refusal('unregistered-site');
	if (create) {
		if (typeof config !== 'string' || Buffer.byteLength(config, 'utf8') > MAX_CONFIG_BYTES) return refusal('invalid-config');
		try {
			JSON.parse(config);
		} catch {
			return refusal('invalid-config');
		}
	}

	const rootPath = path.resolve(sitePath);
	let root;
	try {
		root = await realPath(rootPath);
	} catch {
		return refusal('file-unavailable');
	}

	const directory = path.join(root, '.vscode');
	let directoryInfo;
	try {
		directoryInfo = await stat(directory);
	} catch (error) {
		const code = typeof error?.code === 'string' ? error.code : 'UNKNOWN';
		if (!NOT_THERE.has(code)) return refusal('file-unavailable');
		if (!create) return { ok: true, exists: false, created: false };
		try {
			await mkdir(directory, { recursive: true });
			directoryInfo = await stat(directory);
		} catch {
			return refusal('file-unavailable');
		}
	}
	if (!directoryInfo.isDirectory()) return refusal('invalid-directory');

	let realDirectory;
	try {
		realDirectory = await realPath(directory);
	} catch {
		return refusal('file-unavailable');
	}
	if (!inside(root, realDirectory)) return refusal('outside-site');

	const file = path.join(directory, 'launch.json');
	const current = await existingLaunchFile(file, root, { realPath, stat });
	if (!current.ok || current.exists || !create) return current;

	try {
		await writeFile(file, config, { encoding: 'utf8', flag: 'wx' });
		return { ok: true, exists: true, created: true };
	} catch (error) {
		if (error?.code === 'EEXIST') return existingLaunchFile(file, root, { realPath, stat });
		return refusal('file-unavailable');
	}
}

module.exports = { xdebugLaunchConfigFile };