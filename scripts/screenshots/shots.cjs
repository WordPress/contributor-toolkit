// The declarative list of documentation screenshots.
//
// Each entry is { slug, tier, variant, prepare, target }:
//   - slug: the output filename, docs/public/screenshots/<slug>.png — docs pages
//     reference these names, so renaming one is a docs change too;
//   - tier 'fixture': captured fully automatically against seeded state;
//     tier 'live': needs a real, initialized site and a maintainer at the
//     keyboard (the harness pauses and says what to set up);
//   - variant: which fixture the shot needs ('seeded', isolated 'debug',
//     'gutenberg' or 'empty');
//   - prepare(page): drives the UI to the state worth photographing. Selectors
//     go by the words on screen, same as the repo's hand-testing convention —
//     if a label changes, the shot fails loudly instead of photographing the
//     wrong thing;
//   - target (optional): a locator for an element screenshot instead of the
//     whole window. Panels read better cropped; whole-window shots orient.
//
// Three shots that used to be fixture-tier are live-tier now, joining
// dev-server-running, and moving them back would photograph a screen the 1.0
// app never shows (#298). Each depends on state a seeded settings.json cannot
// express:
//   - dev-server-running: the site URL and the wp-admin link render only while
//     a dev server is serving, and fixture sites are empty directories;
//   - setup-wizard: the self-setup chain arms on the clone-finished edge, so a
//     site that was already in the registry when the app started never runs it;
//   - trac-ticket-panel, and site-view with it: a ticket's own facts come from
//     a live visit to its Trac page and are held in memory, never written to
//     the site's metadata.
// The price is that these four need a maintainer and a real site; the fixture
// tier still covers everything else.

// Where the app's controls and cards are is written down once, for the journeys
// and for these shots alike.
const ui = require('../../tests/e2e/helpers/ui.cjs');
const path = require('path');
const { FIXTURE_ROOT, sayMailServerStarted } = require('./fixtures.cjs');

/**
 * Clicks a site in the sidebar and waits for its view to render.
 *
 * By the label alone rather than through `ui.sidebarEntry`: a fixture site
 * whose snapshot is old wears a staleness dot, and the dot is part of the
 * entry's accessible name.
 *
 * @param {import('playwright-core').Page} page
 * @param {string}                         label
 */
async function selectSite(page, label) {
	const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	await page.getByRole('button', { name: new RegExp(`^${escaped}( \\(.*\\))?$`) }).click();
}

const shots = [
	{
		slug: 'empty-state',
		tier: 'fixture',
		variant: 'empty',
		prepare: async (page) => {
			await ui.noSitesTitle(page).waitFor();
		}
	},
	{
		slug: 'create-site-modal',
		tier: 'fixture',
		variant: 'empty',
		prepare: async (page) => {
			await ui.createFirstSiteButton(page).click();
			await ui.createSiteDialog(page).getByText('Site name').waitFor();
		}
	},
	{
		slug: 'gutenberg-site-view',
		tier: 'fixture',
		variant: 'gutenberg',
		prepare: async (page) => {
			await selectSite(page, 'my-gutenberg-fix');
			await ui.card(page, 'GitHub issue').waitFor();
		}
	},
	{
		slug: 'gutenberg-pull-request-panel',
		tier: 'fixture',
		variant: 'gutenberg',
		target: (page) => ui.card(page, 'Check out a pull request'),
		prepare: async (page) => {
			await selectSite(page, 'my-gutenberg-fix');
			await ui.card(page, 'Check out a pull request').waitFor();
		}
	},
	{
		slug: 'site-menu',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			// The card under the menu has asked which pull requests cite the
			// ticket; the picture is taken with the answer in it.
			await page.getByText('Docs: correct the default').waitFor();
			await ui.siteMenuButton(page).click();
			await ui.updateTrunkMenuItem(page).waitFor();
		}
	},
	{
		slug: 'stale-site-notice',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await selectSite(page, 'older-site');
			await page.getByText(/days old/).first().waitFor();
		}
	},
	{
		slug: 'apply-patch-panel',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => ui.card(page, 'Apply a patch or PR'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await ui.card(page, 'Apply a patch or PR').waitFor();
		}
	},
	{
		slug: 'deep-link-prompt',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => page.getByRole('status').filter({ hasText: 'came from a link' }),
		// The one shot that cannot be reached by driving the UI (#464): the
		// ticket arrives from the operating system, so the picture is taken by
		// making the main process receive the address it would receive from a
		// browser. `app.emit` rather than a real activation, because a launch
		// from source does not own the scheme on macOS or Linux — see
		// protocolRegistration in src/deep-link.cjs.
		prepare: async (page, app) => {
			await selectSite(page, 'my-first-patch');
			await ui.workItemNumber(page, '60000').waitFor();
			await app.evaluate(({ app: electronApp }, url) => {
				electronApp.emit('open-url', { preventDefault() {} }, url);
			}, 'wpct://ticket/62281');
			await page.getByText('came from a link').waitFor();
		}
	},
	{
		slug: 'terminal',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => ui.tray(page, 'Terminal'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await ui.openTray(page, 'Terminal');
		}
	},
	{
		slug: 'debug-log',
		tier: 'fixture',
		variant: 'debug',
		target: (page) => ui.tray(page, 'Logs'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await ui.openTray(page, 'Logs');
			// Taller than it opens, so that the file's lines are all in the
			// picture and the first is not cut by the tabs.
			await page.getByRole('separator', { name: 'Resize tray', exact: true }).focus();
			for (let presses = 0; presses < 3; presses++) await page.keyboard.press('ArrowUp');
			// Starting a real dev session is what makes the renderer attach the
			// debug-log tail, but this fixture deliberately is not a WordPress clone.
			// Both long-running processes are answered and never run (see
			// standInForTheOutside), so the screenshot exercises the real tail
			// without publishing their inevitable fixture failures.
			await ui.startDevServerButton(page).click();
			await page.getByRole('tab', { name: /debug\.log/i }).filter({ visible: true }).click();
			await page.getByText('Undefined variable $post', { exact: false }).filter({ visible: true }).first().waitFor();
			await page.getByRole('tab', { name: /exited/i }).filter({ visible: true }).waitFor({ state: 'detached' });
		}
	},
	{
		slug: 'mail-panel',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => ui.tray(page, 'Email'),
		prepare: async (page, app) => {
			await selectSite(page, 'my-first-patch');
			// Starting the server is what loads the list. The server is
			// stood in for, so the mail server it would bring up is said to
			// have started, where a real one listens on a port of its own
			// choosing that is different in every picture.
			await ui.startDevServerButton(page).click();
			await ui.openTray(page, 'Email');
			await page.getByText('Welcome to WordPress Contributor Day').filter({ visible: true }).waitFor();
			await sayMailServerStarted(app, path.join(FIXTURE_ROOT, 'my-first-patch'));
			await page.getByText(/^SMTP listening on /).filter({ visible: true }).waitFor();
		}
	},
	{
		slug: 'update-incomplete',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => page.getByText('Update incomplete', { exact: true }).locator('..'),
		prepare: async (page) => {
			await selectSite(page, 'needs-rebuild');
			await ui.retryInstallButton(page).waitFor();
		}
	},

	// ---- Live tier: real site, maintainer present. `instructions` is what the
	// harness prints before pausing.
	//
	// The first four are in the order one site passes through them, so a single
	// session — create the site, let it set itself up, run it, link a ticket —
	// takes all four without ever going backwards. Every path in these images is
	// published, so create the site somewhere with no username in it
	// (/private/tmp/wpct-docs/my-first-patch is what the committed ones show),
	// and name it to match the fixture-tier shots so the guide reads as one site.
	{
		slug: 'setup-wizard',
		tier: 'live',
		instructions:
			'Create a site and leave it alone. Shoot while the "Setting this site up for you — step N of 3" banner is up, with a step still to go, so the checklist shows a done step, a running one and a locked one.'
	},
	{
		slug: 'dev-server-running',
		tier: 'live',
		instructions:
			'When the build has finished, click "Start dev server and finish the wizard". Wait until the site URL, the wp-admin link and "Log in with admin / password" are visible.'
	},
	{
		slug: 'site-view',
		tier: 'live',
		instructions:
			'Stop the dev server, then link an open ticket that a pull request cites (65856 in the committed shot) and click "Read details from Trac", clearing the human-check once. Shoot the whole window: the header, with the server\'s and the build watch\'s menus and Review & submit changes, the ticket card under it, and the details beside it.'
	},
	{
		slug: 'trac-ticket-panel',
		tier: 'live',
		target: (page) => ui.card(page, 'Trac ticket'),
		instructions:
			'Same screen as site-view — the ticket facts read and the linked pull requests listed. This one is cropped to the Trac ticket card.'
	},
	{
		slug: 'submit-changes-diff',
		tier: 'live',
		target: (page) => page.locator('.patch-diff'),
		instructions:
			'On a site with edited files, click "Review & submit changes" and wait for the diff to finish generating.'
	},
	{
		slug: 'submit-destinations',
		tier: 'live',
		target: (page) => page.locator('.patch-destinations'),
		instructions:
			'In the "Review & submit changes" modal, wait until the three destination cards (pull request / Trac / mentor) are visible.'
	},
	{
		slug: 'github-sign-in',
		tier: 'live',
		target: (page) => page.getByText('Open a pull request', { exact: true }).locator('../..'),
		instructions:
			'In the "Open a pull request" destination, click "Sign in with GitHub" while signed out. Capture the card while it shows the device code; do not authorize it.'
	},
	{
		slug: 'trunk-update-progress',
		tier: 'live',
		target: (page) => ui.card(page, 'Updating to latest trunk'),
		instructions:
			'Start "Update to latest trunk" on a site and wait until the step list is mid-run.'
	},
	{
		slug: 'apply-patch-conflict',
		tier: 'live',
		target: (page) => ui.card(page, 'Apply a patch or PR'),
		instructions:
			'On an isolated site, preview a patch or pull request that does not fit the checkout, click "Apply and rebuild", and wait until the panel confirms that the checkout was not changed.'
	}
];

module.exports = { shots };
