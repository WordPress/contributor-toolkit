// VitePress configuration for the user documentation site.
//
// The docs are a separate npm package (docs/package.json) on purpose: the root package's
// postinstall runs electron-builder and an esbuild build, which a docs-only CI job has no
// reason to pay for, and the app's dependency tree stays free of a static-site generator.
//
// `base` comes from the environment because this is a project Pages site — the site is
// served under /<repo-name>/, and this repository has already been renamed once
// (experimental-wp-dev-env → contributor-toolkit). The deploy workflow passes the live
// repository name in, so another rename cannot break asset URLs. The fallback only has
// to keep `npm run build` working locally.

import { defineConfig } from 'vitepress';

export default defineConfig( {
	title: 'WordPress Contributor Toolkit',
	description:
		'A desktop app that sets up a full WordPress core development environment with zero prerequisites.',
	base: process.env.DOCS_BASE ?? '/contributor-toolkit/',
	// A link to a page that does not exist should fail the build, not ship a 404.
	ignoreDeadLinks: false,
	// Markdown under docs/ that is written for contributors, not users, and so has
	// no business on the public user guide. testing.md (#70) documents how to run
	// the suites; CONTRIBUTING.md is its home for humans. Excluded rather than
	// moved so that PR does not have to change to land.
	srcExclude: [ 'testing.md' ],
	vite: {
		server: {
			watch: {
				// The build writes into .vitepress/dist, which sits inside the
				// directory the dev server watches — so running `npm run docs:build`
				// with the dev server open makes it reload once per generated page.
				ignored: [ '**/.vitepress/dist/**' ],
			},
		},
	},
	themeConfig: {
		nav: [
			{ text: 'Guide', link: '/guide/getting-started' },
			{
				text: 'Download',
				link: 'https://github.com/WordPress/contributor-toolkit/releases/latest',
			},
		],
		sidebar: [
			{
				text: 'Start here',
				items: [
					{ text: 'Getting started', link: '/guide/getting-started' },
					{ text: 'Creating a site', link: '/guide/creating-a-site' },
					{ text: 'The setup wizard', link: '/guide/setup-wizard' },
				],
			},
			{
				text: 'Daily workflow',
				items: [
					{ text: 'Running the site', link: '/guide/running-the-site' },
					{ text: 'Staying up to date with trunk', link: '/guide/trunk-updates' },
					{ text: 'Opening your editor', link: '/guide/editors' },
				],
			},
			{
				text: 'Contributing changes',
				items: [
					{ text: 'Working on a Trac ticket', link: '/guide/trac-tickets' },
					{ text: 'Applying patches and PRs', link: '/guide/applying-patches' },
					{ text: 'Submitting your changes', link: '/guide/submitting-changes' },
					{ text: 'Opening a pull request', link: '/guide/submit-github-pr' },
					{ text: 'Attaching a patch to Trac', link: '/guide/submit-trac' },
					{ text: 'Handing a patch to a mentor', link: '/guide/submit-mentor' },
				],
			},
			{
				text: 'Tools',
				items: [
					{ text: 'The terminal', link: '/guide/terminal' },
					{ text: 'Logs and debugging', link: '/guide/logs-and-debugging' },
					{ text: 'Catching outgoing email', link: '/guide/mail' },
					{ text: 'Browsing the database', link: '/guide/database' },
				],
			},
			{
				text: 'Reference',
				items: [
					{ text: 'Managing sites', link: '/guide/managing-sites' },
					{ text: 'Troubleshooting', link: '/guide/troubleshooting' },
				],
			},
		],
		socialLinks: [
			{
				icon: 'github',
				link: 'https://github.com/WordPress/contributor-toolkit',
			},
		],
		outline: 'deep',
		search: { provider: 'local' },
	},
} );
