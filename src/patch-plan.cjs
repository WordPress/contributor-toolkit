'use strict';

/**
 * Reading a patch before applying it (issue #11): what files it touches, where
 * those files live in today's checkout, and what applying it would disturb.
 *
 * Patches reach the app from three places that do not agree on a format:
 * attachments on a Trac ticket (Subversion style, no `a/` `b/` prefixes, paths
 * sometimes against the pre-`src/` layout), `.diff` files from a
 * wordpress-develop pull request (git style, `a/` `b/` prefixes), and the app's
 * own generated patches (`createTwoFilesPatch` output, `a/` `b/` prefixes but
 * no `diff --git` line). Everything downstream works in repo-relative paths, so
 * normalising happens here, once.
 *
 * Lives at `src/` rather than `src/renderer/` because both the main process and
 * the applier consume it — same placement as git-update.cjs — and it keeps the
 * `diff` package out of the renderer bundle. The renderer-facing half of this
 * feature (the step chain) is in renderer/update-plan.cjs instead.
 */

const JsDiff = require('diff');
const { normalizeEol } = require('./git-update.cjs');

// Files that stayed at the repo root when core moved everything else under
// src/. A patch naming one of these is already correct for today's layout.
const ROOT_FILES = [
	'.editorconfig',
	'.gitignore',
	'.jshintrc',
	'.travis.yml',
	'Gruntfile.js',
	'package.json',
	'phpunit.xml.dist',
	'wp-cli.yml',
	'wp-config-sample.php',
	'wp-tests-config-sample.php'
];

// Files that did move under src/ despite not being wp-* prefixed, so the
// wp-* rule below would miss them.
const SRC_FILES = ['index.php', 'license.txt', 'readme.html', 'xmlrpc.php'];

// Directories that only ever existed in the modern layout.
const MODERN_DIRS = ['src/', 'tests/', 'tools/'];

/**
 * Strips the leading `a/` and `b/` that git puts on diff headers.
 *
 * Deliberately conditional: Subversion-style patches from Trac carry no prefix
 * at all, so stripping unconditionally would turn `wp-admin/admin.php` into
 * `admin.php` and write to the wrong place. Both sides have to look prefixed
 * before either is trusted — `/dev/null` counts as agreement, since an added or
 * deleted file only has one real side.
 *
 * @param {string} oldName
 * @param {string} newName
 * @return {{oldPath: string, newPath: string}}
 */
function stripPathPrefix(oldName, newName) {
	const isNull = (name) => name === '/dev/null';
	const looksPrefixed = (name, letter) => isNull(name) || new RegExp(`^${letter}/`).test(name);
	const bothPrefixed = looksPrefixed(oldName, 'a') && looksPrefixed(newName, 'b');
	const drop = (name) => (isNull(name) || !bothPrefixed ? name : name.slice(2));
	// `Index: trunk/wp-…` is what an older Subversion checkout produced; the
	// branch name is not part of the repo-relative path either way.
	const dropTrunk = (name) => (isNull(name) ? name : name.replace(/^trunk\//, ''));
	return { oldPath: dropTrunk(drop(oldName)), newPath: dropTrunk(drop(newName)) };
}

/**
 * Rewrites a path written against the pre-src/ layout to where that file lives
 * today. A patch attached to a ticket years ago still names `wp-admin/…`.
 *
 * @param {string} filePath
 * @return {string}
 */
function mapToSrcLayout(filePath) {
	if (!filePath || filePath === '/dev/null') return filePath;
	if (MODERN_DIRS.some((dir) => filePath.startsWith(dir))) return filePath;
	if (ROOT_FILES.includes(filePath)) return filePath;
	if (SRC_FILES.includes(filePath)) return `src/${filePath}`;
	if (filePath.startsWith('wp-')) return `src/${filePath}`;
	// Unrecognised: leave it alone rather than guess a move that would write
	// outside the tree the contributor expects.
	return filePath;
}

/**
 * Walks the raw patch for its per-file section headers.
 *
 * Needed because jsdiff returns the byte-identical shape `[{hunks: []}]` for a
 * binary file, a 100%-similarity rename, and text that is not a patch at all —
 * it keeps neither the filenames nor the marker that tells them apart. Without
 * this, prose pasted in would be reported as a binary file and a pure rename
 * would be rejected as garbage.
 *
 * @param {string} raw
 * @return {Array<{path: string, isBinary: boolean, renameFrom: string, renameTo: string}>}
 */
function scanSections(raw) {
	const sections = [];
	const last = () => sections[sections.length - 1];
	for (const line of raw.split('\n')) {
		const git = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(line);
		if (git) {
			sections.push({ path: git[2] || git[1], isBinary: false, renameFrom: '', renameTo: '' });
			continue;
		}
		const svn = /^Index: (.+)$/.exec(line);
		if (svn) {
			sections.push({ path: svn[1].trim(), isBinary: false, renameFrom: '', renameTo: '' });
			continue;
		}
		if (!sections.length) continue;
		if (/^Binary files .* differ$/.test(line) || /^GIT binary patch$/.test(line)) {
			last().isBinary = true;
			continue;
		}
		const from = /^rename from (.+)$/.exec(line);
		if (from) { last().renameFrom = from[1].trim(); continue; }
		const to = /^rename to (.+)$/.exec(line);
		if (to) last().renameTo = to[1].trim();
	}
	return sections;
}

/**
 * @param {Object} file    A jsdiff parsePatch entry.
 * @param {string} oldPath
 * @param {string} newPath
 * @return {string}
 */
function classify(file, oldPath, newPath) {
	if (oldPath === '/dev/null') return 'add';
	if (newPath === '/dev/null') return 'delete';
	if (oldPath !== newPath) return 'rename';
	return 'modify';
}

/**
 * Chooses the per-path normalisation for a project's layout (#251).
 *
 * `src-layout` (WordPress Core, the default) rewrites pre-`src/` paths — a patch
 * attached to a ticket years ago still names `wp-admin/…`. `repo-relative`
 * (Gutenberg) leaves paths alone: its diffs are already repo-relative
 * (`packages/…`), and running them through the Core rewrite would move any
 * top-level `wp-`-prefixed path under a `src/` directory that does not exist
 * there.
 *
 * @param {string} [layout]
 * @return {(filePath: string) => string}
 */
function pathMapperFor(layout) {
	return layout === 'repo-relative' ? (filePath) => filePath : mapToSrcLayout;
}

/**
 * Parses a patch into the files it touches, with paths normalised to
 * repo-relative form for the target project's layout.
 *
 * @param {string} text
 * @param {Object} [options]
 * @param {string} [options.layout] 'src-layout' (default) or 'repo-relative'.
 * @return {{ok: true, files: Array}|{ok: false, error: string}}
 */
function parsePatchFiles(text, { layout } = {}) {
	const raw = typeof text === 'string' ? text : '';
	if (!raw.trim()) return { ok: false, error: 'The patch is empty.' };

	let parsed;
	try {
		// Normalise line endings on the way in so hunk context matches what the
		// applier reads off disk, which is normalised the same way.
		parsed = JsDiff.parsePatch(normalizeEol(raw));
	} catch (e) {
		return { ok: false, error: `Could not read the patch: ${String(e && e.message ? e.message : e)}` };
	}

	if (!parsed || parsed.length === 0) {
		return { ok: false, error: 'No file changes found in the patch.' };
	}

	const sections = scanSections(normalizeEol(raw));
	const mapPath = pathMapperFor(layout);
	const files = [];

	for (let i = 0; i < parsed.length; i++) {
		const file = parsed[i];

		if (!file.hunks || file.hunks.length === 0) {
			// jsdiff kept nothing, so the raw section is the only evidence of
			// what this was.
			const section = sections[i];
			if (section && section.renameFrom && section.renameTo) {
				const oldPath = mapPath(section.renameFrom);
				const newPath = mapPath(section.renameTo);
				files.push({ kind: 'rename', oldPath, newPath, path: newPath, hunks: [], patch: file });
				continue;
			}
			if (section && section.isBinary) {
				const binaryPath = mapPath(stripPathPrefix(section.path, section.path).newPath);
				files.push({ kind: 'binary', oldPath: binaryPath, newPath: binaryPath, path: binaryPath, hunks: [], patch: file });
				continue;
			}
			return { ok: false, error: 'That does not look like a patch — no file changes found.' };
		}

		const oldName = file.oldFileName || file.index || '';
		const newName = file.newFileName || file.index || '';
		const { oldPath, newPath } = stripPathPrefix(oldName, newName);
		const kind = classify(file, oldPath, newPath);
		const target = kind === 'delete' ? oldPath : newPath;
		files.push({
			kind,
			oldPath: mapPath(oldPath),
			newPath: mapPath(newPath),
			path: mapPath(target),
			hunks: file.hunks,
			patch: file
		});
	}

	return { ok: true, files };
}

/**
 * What applying these files would mean for a given checkout.
 *
 * `conflicts` is the honest version of the dirty-tree question: applying a
 * patch is not destructive the way a hard reset is, so the only changes worth
 * mentioning are the ones on files the contributor has already edited.
 *
 * @param {Object}   root0
 * @param {Array}    root0.files
 * @param {string[]} [root0.dirtyPaths]
 * @return {{paths: string[], conflicts: string[], unsupported: string[], needsInstall: boolean}}
 */
function planApply({ files, dirtyPaths = [] } = {}) {
	const list = Array.isArray(files) ? files : [];
	const paths = list.map((f) => f.path).filter(Boolean);
	// A rename disturbs the file it moves away from as well as the one it
	// creates, so both sides count when looking for collisions.
	const touched = new Set(paths);
	for (const f of list) {
		if (f.kind === 'rename' && f.oldPath) touched.add(f.oldPath);
	}
	const dirty = new Set(dirtyPaths);
	return {
		paths,
		conflicts: [...touched].filter((p) => dirty.has(p)),
		// Binary hunks cannot be applied from a text diff. Naming them is the
		// difference between "this patch is partly unapplied" and a silent gap.
		unsupported: list.filter((f) => f.kind === 'binary').map((f) => f.path || '(unnamed binary file)'),
		// Same rule the trunk update uses (#94): the lockfile moving is what
		// makes an install necessary rather than merely possible.
		needsInstall: touched.has('package-lock.json')
	};
}

module.exports = {
	ROOT_FILES,
	SRC_FILES,
	stripPathPrefix,
	mapToSrcLayout,
	pathMapperFor,
	parsePatchFiles,
	planApply
};
