'use strict';

// The contribution targets ("project types") the toolkit can host.
//
// Until now every site was implicitly a `wordpress-develop` (WordPress Core)
// checkout, and that assumption was a scattering of constants: the clone URL,
// the "is it built?" path, the dev/build scripts, the Playground serve model,
// the work-item source (Trac), and the pull-request upstream. This module is
// the one place those per-target facts live, so a site's chosen type — not a
// constant buried in a handler — drives each of them (issue #251).
//
// It is deliberately pure data + pure functions: no `electron`, no `fs`, no
// side effects. Both the main process and the renderer bundle `require`/`import`
// it, and `node --test` loads it directly.
//
// The invariant every consumer relies on: an unknown or missing type resolves
// to Core. A site created before this field existed has no `projectType`, so it
// keeps Core behavior with no migration and no store write.

const WORDPRESS_DEVELOP_GIT_URL = 'https://github.com/WordPress/wordpress-develop.git';
const GUTENBERG_GIT_URL = 'https://github.com/WordPress/gutenberg.git';

const DEFAULT_PROJECT_TYPE = 'core';

const PROJECT_TYPES = {
	core: {
		id: 'core',
		label: 'WordPress Core',
		// The option label shown in the create-site wizard picker.
		wizardLabel: 'WordPress Core (Trac tickets)',
		// One-line description shown next to the choice in the create-site wizard.
		description: 'Contribute to WordPress Core using Trac tickets.',
		// The noun this target uses for a unit of work, for UI copy: a Core site
		// links a "ticket", a Gutenberg site links an "issue".
		workItemNoun: 'ticket',

		clone: { url: WORDPRESS_DEVELOP_GIT_URL, ref: 'trunk', singleBranch: true, depth: 1 },
		upstream: { owner: 'WordPress', repo: 'wordpress-develop', base: 'trunk' },

		build: {
			// site:status checks this path under the site to decide "is it built?".
			builtCheckRelPath: ['build', 'wp-includes', 'js', 'dist'],
			buildScript: 'build',
			// wordpress-develop's dev watcher is Grunt, reached through npm's `--`
			// passthrough (see dev-server-command.cjs for why the separator matters).
			watch: { script: 'grunt', args: ['--', '_watch'], label: 'npm run grunt -- _watch' },
			allowedScripts: ['build', 'build:dev', 'dev', 'test', 'watch', 'grunt']
		},

		// 'docroot' — the built checkout IS the WordPress install Playground serves.
		serve: { strategy: 'docroot' },

		// 'src-layout' — patch paths are rewritten into wordpress-develop's
		// src/wp-includes layout (patch-plan.cjs mapToSrcLayout).
		patch: { layout: 'src-layout' },

		workItem: { provider: 'trac' },

		pr: {
			branchPrefix: 'trac-',
			// The line that ties the pull request back to its work item.
			bodyLine: (id, url) => `Trac ticket: ${url}`,
			closesKeyword: null
		}
	},

	gutenberg: {
		id: 'gutenberg',
		label: 'Gutenberg',
		wizardLabel: 'Gutenberg (GitHub issues)',
		description: 'Contribute to the block editor (Gutenberg) using GitHub issues.',
		workItemNoun: 'issue',

		clone: { url: GUTENBERG_GIT_URL, ref: 'trunk', singleBranch: true, depth: 1 },
		upstream: { owner: 'WordPress', repo: 'gutenberg', base: 'trunk' },

		build: {
			// Gutenberg builds each package into build/<package>; block-library is
			// always present in a completed build, so its directory is the marker.
			builtCheckRelPath: ['build', 'block-library'],
			buildScript: 'build',
			// `npm run dev` is already an incremental watcher — it must NOT inherit
			// Core's `grunt -- _watch` passthrough dance.
			watch: { script: 'dev', args: [], label: 'npm run dev' },
			allowedScripts: ['build', 'dev', 'test', 'test:unit', 'lint']
		},

		// 'plugin-mount' — Gutenberg is a plugin, so Playground boots a stock
		// WordPress and mounts the built checkout as an active plugin.
		serve: { strategy: 'plugin-mount' },

		// 'repo-relative' — Gutenberg PR diffs are already repo-relative
		// (packages/…); no src-layout rewrite.
		patch: { layout: 'repo-relative' },

		workItem: { provider: 'github-issue' },

		pr: {
			branchPrefix: 'fix/issue-',
			bodyLine: (id) => `Fixes #${id}`,
			closesKeyword: 'Fixes'
		}
	}
};

// Resolve a stored id to its config, defaulting to Core for anything unknown or
// missing. This is the single seam every caller uses — never index
// PROJECT_TYPES directly with untrusted input.
function getProjectType(id) {
	return PROJECT_TYPES[id] || PROJECT_TYPES[DEFAULT_PROJECT_TYPE];
}

// Convenience for the common case: resolve straight from a site's stored meta.
function projectTypeForSite(meta) {
	return getProjectType(meta && meta.projectType);
}

// True only for an id the registry actually defines — for validating input
// before persisting it (an unknown id is coerced to Core on read, but we store
// the normalized id, not the raw input).
function isProjectTypeId(id) {
	return Object.prototype.hasOwnProperty.call(PROJECT_TYPES, id);
}

// Normalize arbitrary input to a stored id: a known id passes through, anything
// else becomes the default. Used at the write boundary (wordpress:setup).
function normalizeProjectType(id) {
	return isProjectTypeId(id) ? id : DEFAULT_PROJECT_TYPE;
}

module.exports = {
	PROJECT_TYPES,
	DEFAULT_PROJECT_TYPE,
	getProjectType,
	projectTypeForSite,
	isProjectTypeId,
	normalizeProjectType
};
