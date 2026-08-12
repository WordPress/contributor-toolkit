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
 * The one path named by a `diff --git a/<path> b/<path>` line whose two sides
 * are the same file — the only shape an added or deleted file can have.
 *
 * The line has no delimiter, so a path containing a space makes it ambiguous in
 * general (`git apply` itself refuses such a line without `---`/`+++` to cross-
 * check). But when both sides are the same path — and for an add or a delete
 * they always are — the split is fixed by the line's length, so even
 * `a/new file.php b/new file.php` reads back exactly. Git quotes a path only
 * for characters beyond plain spaces; the quoted form carries C-style escapes,
 * so it is left unparsed rather than guessed at.
 *
 * @param {string} line A `diff --git ` line.
 * @return {string|null} The repo-relative path, or null when it cannot be read
 *                       with certainty.
 */
function samePathFromGitDiffLine(line) {
	const rest = line.slice('diff --git '.length);
	if (!rest.startsWith('a/')) return null;
	const length = (rest.length - 5) / 2;
	if (!Number.isInteger(length) || length < 1) return null;
	const filePath = rest.slice(2, 2 + length);
	if (rest.slice(2 + length, 5 + length) !== ' b/' || rest.slice(5 + length) !== filePath) return null;
	return filePath;
}

/**
 * Rewrites the sections real git emits for an empty file added or deleted into
 * the shape the rest of this parser already reads (#311).
 *
 * An empty file has no line to diff, so git writes its section as headers
 * alone and — unlike this app's own generator — omits the `---`/`+++` pair
 * entirely; the file's fate is carried by `new file mode` / `deleted file
 * mode`. jsdiff cannot see those: such a section comes back as `{hunks: []}`
 * with no filenames when it is last in the patch, and is silently swallowed
 * when another section follows it. Either way one empty file used to take the
 * whole patch down (or vanish from it) — every unrelated file included.
 *
 * Supplying the pair git left out, before jsdiff parses, is the whole fix: the
 * section then parses like the app's own empty-file sections, and everything
 * downstream — classification, layout mapping, `planApply`, the applier and
 * its guards — treats both origins identically because they are identical.
 *
 * Deliberately narrow: a section is only rewritten when it carries a
 * new/deleted file mode line, has no `---`/`+++`/hunk of its own, is not
 * binary and not a rename, and its `diff --git` line names one unambiguous
 * path. Anything else is left byte-for-byte alone.
 *
 * @param {string} text EOL-normalised patch text.
 * @return {string}
 */
function supplyEmptyFileHeaders(text) {
	const lines = text.split('\n');
	const out = [];
	let i = 0;
	while (i < lines.length) {
		out.push(lines[i]);
		if (!lines[i].startsWith('diff --git ')) { i++; continue; }
		let mode = '';
		let opaque = false;
		let end = i + 1;
		while (end < lines.length && !lines[end].startsWith('diff --git ') && !lines[end].startsWith('Index: ')) {
			const line = lines[end];
			if (/^new file mode /.test(line)) mode = 'add';
			else if (/^deleted file mode /.test(line)) mode = 'delete';
			else if (/^(--- |\+\+\+ |@@ |GIT binary patch|rename (?:from|to) )/.test(line) || /^Binary files .* differ$/.test(line)) opaque = true;
			end++;
		}
		const section = lines.slice(i + 1, end);
		// The injected pair goes at the section's end, where git itself puts
		// it — but ahead of any trailing blank line, which jsdiff would read
		// as a phantom context line.
		let tail = section.length;
		while (tail > 0 && section[tail - 1] === '') tail--;
		out.push(...section.slice(0, tail));
		const filePath = mode && !opaque ? samePathFromGitDiffLine(lines[i]) : null;
		// jsdiff can silently omit a mode-only section it cannot name when a
		// normal section follows. Refuse the whole patch instead of reporting a
		// partial success. Decoding Git's quoted C-style paths is deliberately
		// outside the narrow 1.0 reader (#316).
		if (mode && !opaque && !filePath) {
			throw new Error('The empty file path is quoted or ambiguous.');
		}
		if (filePath) {
			out.push(
				mode === 'add' ? '--- /dev/null' : `--- a/${filePath}`,
				mode === 'add' ? `+++ b/${filePath}` : '+++ /dev/null'
			);
		}
		out.push(...section.slice(tail));
		i = end;
	}
	return out.join('\n');
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
 * Parses a patch into the files it touches, with paths normalised to
 * repo-relative form for today's layout.
 *
 * @param {string} text
 * @return {{ok: true, files: Array}|{ok: false, error: string}}
 */
function parsePatchFiles(text) {
	const raw = typeof text === 'string' ? text : '';
	if (!raw.trim()) return { ok: false, error: 'The patch is empty.' };

	// Normalise line endings on the way in so hunk context matches what the
	// applier reads off disk, which is normalised the same way.
	const normalized = normalizeEol(raw);

	let parsed;
	try {
		// Real git carries an empty file added or deleted as headers alone,
		// with no `---`/`+++` pair for jsdiff to read (#311) — supplying it
		// here is what lets the rest of this function see those sections at
		// all, instead of one of them rejecting the whole patch.
		parsed = JsDiff.parsePatch(supplyEmptyFileHeaders(normalized));
	} catch (e) {
		return { ok: false, error: `Could not read the patch: ${String(e && e.message ? e.message : e)}` };
	}

	if (!parsed || parsed.length === 0) {
		return { ok: false, error: 'No file changes found in the patch.' };
	}

	const sections = scanSections(normalized);
	const files = [];

	for (let i = 0; i < parsed.length; i++) {
		const file = parsed[i];

		if (!file.hunks || file.hunks.length === 0) {
			// An empty file added or deleted has no line on either side, so its
			// section is headers alone (#311). `/dev/null` still says which of
			// the two it was — the same rule classify() applies to a hunked
			// section — and it comes off the parsed filenames, so it does not
			// depend on `sections` lining up with `parsed` (it does not, in a
			// patch that mixes git-style and bare sections).
			if (file.oldFileName === '/dev/null' || file.newFileName === '/dev/null') {
				const empty = stripPathPrefix(file.oldFileName || '', file.newFileName || '');
				const emptyKind = classify(file, empty.oldPath, empty.newPath);
				const emptyTarget = emptyKind === 'delete' ? empty.oldPath : empty.newPath;
				files.push({
					kind: emptyKind,
					oldPath: mapToSrcLayout(empty.oldPath),
					newPath: mapToSrcLayout(empty.newPath),
					path: mapToSrcLayout(emptyTarget),
					hunks: [],
					patch: file
				});
				continue;
			}
			// jsdiff kept nothing, so the raw section is the only evidence of
			// what this was.
			const section = sections[i];
			if (section && section.renameFrom && section.renameTo) {
				const oldPath = mapToSrcLayout(section.renameFrom);
				const newPath = mapToSrcLayout(section.renameTo);
				files.push({ kind: 'rename', oldPath, newPath, path: newPath, hunks: [], patch: file });
				continue;
			}
			if (section && section.isBinary) {
				const binaryPath = mapToSrcLayout(stripPathPrefix(section.path, section.path).newPath);
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
			oldPath: mapToSrcLayout(oldPath),
			newPath: mapToSrcLayout(newPath),
			path: mapToSrcLayout(target),
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
	parsePatchFiles,
	planApply
};
