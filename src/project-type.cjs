'use strict';

// The contribution targets ("project types") the toolkit can host.
//
// Until now every site was implicitly a `wordpress-develop` (WordPress Core)
// checkout, and that assumption was a scattering of constants: the clone URL,
// the "is it built?" path, the dev/build scripts, the Playground serve model,
// the work-item source (Trac), and the pull-request upstream. This module is
// the one place those per-target facts live, so a site's chosen type, not a
// constant buried in a handler, drives each of them (issue #251).
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
		// The pill on a site's sidebar row and header. Short, because the row
		// is narrow and the CSS upper-cases it; every site wears one, so a
		// list of mixed sites reads at a glance.
		tag: 'Core',
		// The option label shown in the create-site wizard picker, and the
		// line under it. They say what the app does with the site today, not
		// what a later version will.
		wizardLabel: 'WordPress Core',
		description: 'The wordpress-develop repository: Trac tickets, patches and pull requests.',

		// git-clone.cjs decides the clone's shape (partial, single branch); the
		// registry only says where from and which branch.
		clone: { url: WORDPRESS_DEVELOP_GIT_URL, ref: 'trunk' },
		// The folder a site gets when the contributor leaves the name empty.
		defaultFolderName: 'wordpress-develop-trunk',
		upstream: { owner: 'WordPress', repo: 'wordpress-develop', base: 'trunk' },

		build: {
			// site:status checks this path under the site to decide "is it built?".
			builtCheckRelPath: ['build', 'wp-includes', 'js', 'dist'],
			// Why the watcher is `grunt -- _watch` and not `npm run watch`:
			// wordpress-develop's Gruntfile renames the real watch task to `_watch`
			// and registers a `watch` wrapper that runs the entire production
			// `build` task first when invoked without arguments. On a site that
			// has already completed the wizard's full build that rebuild has
			// nothing to do, yet it is where tens of minutes go on every
			// dev-server start (30+ on a Windows VM). Invoking `_watch` through
			// the `grunt` passthrough script starts the same watchers immediately.
			//
			// The `'--'` is load-bearing: script-runner.js deliberately does not
			// insert a separator, and without one npm consumes `_watch` as its
			// own argument and runs bare `grunt`, the default task, i.e. a full
			// build with no watcher.
			watch: { script: 'grunt', args: ['--', '_watch'], label: 'npm run grunt -- _watch' },
			// What the terminal's `npm run <script>` accepts.
			allowedScripts: ['build', 'build:dev', 'dev', 'test', 'watch', 'grunt']
		},

		// What the setup checklist says about the steps that differ per target.
		setup: {
			cloneLabel: 'Download WordPress development version',
			cloneDescription: 'Clone the WordPress develop repository.',
			buildDescription: 'Compile WordPress Core to generate the dist files. Later updates rebuild automatically.',
			builtDescription: 'Built. Edited files in src/ since? Run npm run build in the Terminal below so the site picks them up — updates and applied patches rebuild on their own.',
			serverDescription: 'Launch the development server once to complete the WordPress setup wizard.'
		},

		// What the site page's cards say where the two targets differ. The
		// work-item card itself reads its words from work-item.cjs and from the
		// `workItem` block below.
		cards: {
			// What the pull-request destination says when there is no work item
			// linked to cite.
			prBlockedNote: 'No ticket is linked to this site. A pull request has to cite one — link it in the Trac card.',
			// The rest of the pull-request destination's words that differ per
			// target: what it costs, what happens after, what the app cannot do
			// for a signed-out contributor, the help under the notes field, the
			// line that sends them back to the work item once the pull request
			// exists, and the fold that says how pull requests work here.
			prCost: 'A GitHub account. The fork is made for you; no password is typed into this app and no credential is written to disk.',
			prAfter: 'Automated checks run on it. Nobody watches GitHub, though — posting the link on the ticket is what gets it seen.',
			signInCannot: 'It cannot create the GitHub account for you, and it cannot post to Trac on your behalf.',
			prNotesHelp: 'Goes at the top of the description. The ticket link and your WordPress.org username are added underneath.',
			prLoopBack: 'Triage and props live on the ticket, so the link belongs there too.',
			// Two facts from the core handbook that a first-timer has no way to
			// know and that change what they do next: nobody is watching GitHub,
			// and nothing is merged there. Both make the Trac step this flow
			// ends on the point rather than the postscript.
			prHow: {
				summary: 'How pull requests work in core',
				lines: [
					'Nobody watches the pull request list. Yours is seen because its link is on the ticket — which is why this flow ends by sending you back there.',
					'Nothing is merged on GitHub either. A committer applies the change themselves, and the ticket is where they decide to.'
				],
				linkLabel: 'The handbook page on pull requests',
				linkUrl: 'https://make.wordpress.org/core/handbook/contribute/git/github-pull-requests-for-code-review/'
			},
			applyHeading: 'Apply a patch or PR',
			applyDescription: 'Pull requests are checked out with their author\u2019s commits. A .diff/.patch file is applied to the current branch as a removable layer.',
			// Patch files are how work arrives from Trac; a target whose work
			// arrives as pull requests has no use for the file picker.
			patchFiles: true
		},

		// 'docroot', the built checkout IS the WordPress install Playground serves.
		serve: { strategy: 'docroot' },

		// 'src-layout', patch paths are rewritten into wordpress-develop's
		// src/wp-includes layout (patch-plan.cjs mapToSrcLayout).
		patch: { layout: 'src-layout' },

		workItem: {
			provider: 'trac',
			// The local branch a work item gets its own namespace under. Core's
			// is `ticket/`, unchanged since #108, so no existing site moves.
			branchPrefix: 'ticket/',
			// What the panel calls it, and where a newcomer goes to find one.
			label: 'Trac ticket',
			browseUrl: 'https://core.trac.wordpress.org/tickets/good-first-bugs',
			browseLabel: 'Browse good first bugs on Trac'
		},

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
		tag: 'Gutenberg',
		wizardLabel: 'Gutenberg',
		description: 'The block editor, built and run as a plugin in a stock WordPress: GitHub issues, and pull requests by checkout.',

		clone: { url: GUTENBERG_GIT_URL, ref: 'trunk' },
		defaultFolderName: 'gutenberg-trunk',
		upstream: { owner: 'WordPress', repo: 'gutenberg', base: 'trunk' },

		build: {
			// Gutenberg's build lands the plugin's scripts under build/scripts/<handle>/
			// (lib/client-assets.php reads index.min.js from there) and styles under
			// build/styles/. block-library is in every completed build, so its
			// script is the marker. Measured on trunk, 2026-09-15; the layout has
			// moved before (it used to be build/<package>), so re-check it when a
			// site that just built still reads as unbuilt.
			builtCheckRelPath: ['build', 'scripts', 'block-library', 'index.min.js'],
			// `npm run dev` is Gutenberg's own incremental watcher: a full build
			// first (about 20 s on trunk, 2026-09-15), then it watches. No `--`
			// passthrough, that is Core's Grunt arrangement.
			//
			// That first build starts by removing build/ (tools/build-scripts/dev.mjs
			// runs clean.mjs --packages) and writes the PHP registries lib/ calls
			// into (build/build.php, build/styles.php) last. A server started
			// before it finishes serves a plugin with no build/ or half of one:
			// the "requires files to be built" notice, or a fatal on
			// gutenberg_override_style() (#488). `readyPattern` is the line
			// wp-build --watch prints once that build is done, and the server
			// start waits for it. Core has no pattern: grunt _watch touches
			// nothing on start, so the server may start at once.
			watch: { script: 'dev', args: [], label: 'npm run dev', readyPattern: 'Watching for changes' },
			// Gutenberg's bare `test` runs PHP and e2e suites that need Docker;
			// the unit suite and the linters are what a checkout without it can run.
			allowedScripts: ['build', 'dev', 'test:unit', 'lint', 'lint:js']
		},

		cards: {
			prBlockedNote: 'No issue is linked to this site. A pull request has to cite one: link it in the GitHub issue card.',
			prCost: 'A GitHub account. The fork is made for you; no password is typed into this app and no credential is written to disk.',
			prAfter: 'Automated checks run on it, and it is reviewed and merged right there: on Gutenberg the pull request is the venue.',
			signInCannot: 'It cannot create the GitHub account for you.',
			prNotesHelp: 'Goes at the top of the description. The Fixes line that links the issue and your WordPress.org username are added underneath.',
			prLoopBack: 'The Fixes line already lists it on the issue. A comment there still tells the people watching it.',
			// The two facts above are false here, and the audience least able
			// to spot the app describing a different project is exactly this
			// one, so the fold says what is true of Gutenberg instead.
			prHow: {
				summary: 'How pull requests work in Gutenberg',
				lines: [
					'The pull request is where the change is reviewed and, once approved, merged. Nothing has to be posted anywhere else for it to be seen.',
					'Reviewers ask for testing steps. Put them in the notes: what to open, what to click, what should happen.'
				],
				linkLabel: 'The Gutenberg contributing guide',
				linkUrl: 'https://github.com/WordPress/gutenberg/blob/trunk/CONTRIBUTING.md'
			},
			applyHeading: 'Check out a pull request',
			applyDescription: 'Pull requests are checked out with their author\u2019s commits.',
			patchFiles: false
		},

		setup: {
			cloneLabel: 'Download Gutenberg',
			cloneDescription: 'Clone the Gutenberg repository.',
			buildDescription: 'Compile the Gutenberg packages. Later updates rebuild automatically.',
			builtDescription: 'Built. Edited a package since? Run npm run build in the Terminal below so the site picks it up; updates rebuild on their own.',
			serverDescription: 'Launch a WordPress with this checkout as its Gutenberg plugin, once, to finish the setup.'
		},

		// 'plugin-mount', Gutenberg is a plugin, so Playground boots a stock
		// WordPress and mounts the built checkout as an active plugin under
		// wp-content/plugins/<pluginSlug>.
		serve: { strategy: 'plugin-mount', pluginSlug: 'gutenberg' },

		// 'repo-relative', Gutenberg PR diffs are already repo-relative
		// (packages/…); no src-layout rewrite.
		patch: { layout: 'repo-relative' },

		workItem: {
			provider: 'github-issue',
			// `issue/`, not `ticket/`: a contributor reading `git branch` in
			// their own client sees the noun the upstream uses, and a site
			// cannot end up with two namespaces meaning the same thing.
			branchPrefix: 'issue/',
			label: 'GitHub issue',
			browseUrl: 'https://github.com/WordPress/gutenberg/issues?q=is%3Aissue+is%3Aopen+label%3A%22Good+First+Issue%22',
			browseLabel: 'Browse good first issues on GitHub'
		},

		pr: {
			branchPrefix: 'fix/issue-',
			bodyLine: (id) => `Fixes #${id}`,
			closesKeyword: 'Fixes'
		}
	}
};

// True only for an id the registry actually defines. Own properties only: the
// registry is a plain object, so `'__proto__'`, `'constructor'` or `'toString'`
// would otherwise resolve to something truthy that is not a project type.
function isProjectTypeId(id) {
	return Object.prototype.hasOwnProperty.call(PROJECT_TYPES, id);
}

// Resolve a stored id to its config, defaulting to Core for anything unknown or
// missing. This is the single seam every caller uses, never index
// PROJECT_TYPES directly with untrusted input.
function getProjectType(id) {
	return isProjectTypeId(id) ? PROJECT_TYPES[id] : PROJECT_TYPES[DEFAULT_PROJECT_TYPE];
}

// Convenience for the common case: resolve straight from a site's stored meta.
function projectTypeForSite(meta) {
	return getProjectType(meta && meta.projectType);
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
