// The declarative list of documentation screenshots.
//
// Each entry is { slug, tier, variant, prepare, target }:
//   - slug: the output filename, docs/public/screenshots/<slug>.png — docs pages
//     reference these names, so renaming one is a docs change too;
//   - tier 'fixture': captured fully automatically against seeded state;
//     tier 'live': needs a real, initialized site and a maintainer at the
//     keyboard (the harness pauses and says what to set up);
//   - variant: which fixture the shot needs ('seeded' or 'empty');
//   - prepare(page): drives the UI to the state worth photographing. Selectors
//     go by the words on screen, same as the repo's hand-testing convention —
//     if a label changes, the shot fails loudly instead of photographing the
//     wrong thing;
//   - target (optional): a locator for an element screenshot instead of the
//     whole window. Panels read better cropped; whole-window shots orient.

/**
 * Clicks a site in the sidebar and waits for its view to render.
 *
 * @param {import('playwright-core').Page} page
 * @param {string}                         label
 */
async function selectSite(page, label) {
	await page.getByText(label, { exact: true }).first().click();
}

/**
 * Locates a site-view card by its heading text (the cards are styled divs, not
 * landmarks). Every site's view is in the DOM at once — only the selected one
 * is visible — so the visibility filter is what picks the right card.
 *
 * @param {import('playwright-core').Page} page
 * @param {string}                         heading
 */
function card(page, heading) {
	return page
		.locator(`div:has(> div:text-is("${heading}"))`)
		.filter({ visible: true })
		.last();
}

const shots = [
	{
		slug: 'empty-state',
		tier: 'fixture',
		variant: 'empty',
		prepare: async (page) => {
			await page.getByText('No sites yet.').first().waitFor();
		}
	},
	{
		slug: 'create-site-modal',
		tier: 'fixture',
		variant: 'empty',
		prepare: async (page) => {
			await page.getByRole('button', { name: 'Create a contributor site' }).click();
			await page.getByRole('dialog').getByText('Site name').waitFor();
		}
	},
	{
		slug: 'setup-wizard',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await selectSite(page, 'wordpress-develop');
			await page.getByText('Initial setup checklist').waitFor();
		}
	},
	{
		slug: 'site-view',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await page.getByRole('button', { name: 'Submit changes' }).waitFor();
		}
	},
	{
		slug: 'site-menu',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await page.getByRole('button', { name: 'More' }).click();
			await page.getByRole('menuitem', { name: 'Update to latest trunk' }).waitFor();
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
		slug: 'trac-ticket-panel',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => card(page, 'Trac ticket'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await page.getByText('#60000').waitFor();
		}
	},
	{
		slug: 'apply-patch-panel',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => card(page, 'Apply a patch or PR'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await card(page, 'Apply a patch or PR').waitFor();
		}
	},
	{
		slug: 'terminal',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => card(page, 'Terminal'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await card(page, 'Terminal').waitFor();
		}
	},
	{
		slug: 'debug-log',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => card(page, 'Logs'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await page.getByRole('tab', { name: /debug\.log/ }).filter({ visible: true }).click();
			await page.getByText('PHP Notice', { exact: false }).filter({ visible: true }).first().waitFor();
		}
	},
	{
		slug: 'mail-panel',
		tier: 'fixture',
		variant: 'seeded',
		target: (page) => card(page, 'Mail'),
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			await page.getByText('No emails yet.').filter({ visible: true }).waitFor();
		}
	},

	// ---- Live tier: real site, maintainer present. `instructions` is what the
	// harness prints before pausing.
	{
		slug: 'dev-server-running',
		tier: 'live',
		instructions:
			'Select an initialized site and click "Start dev server". Wait until the site URL and "Log in with admin / password" are visible.'
	},
	{
		slug: 'submit-changes-diff',
		tier: 'live',
		instructions:
			'On a site with edited files, click "Submit changes" and wait for the diff to finish generating.'
	},
	{
		slug: 'submit-destinations',
		tier: 'live',
		instructions:
			'In the "Submit changes" modal, continue past the diff until the three destination cards (pull request / Trac / mentor) are visible.'
	},
	{
		slug: 'github-sign-in',
		tier: 'live',
		instructions:
			'Choose "Open a pull request" while signed out, so the GitHub sign-in screen is visible. Stop before entering the device code.'
	},
	{
		slug: 'trunk-update-progress',
		tier: 'live',
		instructions:
			'Start "Update to latest trunk" on a site and wait until the step list is mid-run.'
	}
];

module.exports = { shots };
