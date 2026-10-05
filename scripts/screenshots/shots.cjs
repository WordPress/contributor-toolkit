// The declarative list of documentation screenshots.
//
// Each entry is { slug, tier, variant, prepare, target, clip, viewport, instructions }:
//   - slug: the output filename, docs/public/screenshots/<slug>.png — docs pages
//     reference these names, so renaming one is a docs change too;
//   - tier 'fixture': captured fully automatically against seeded state;
//     tier 'live': needs a real, initialized site and a maintainer at the
//     keyboard (the harness pauses and says what to set up);
//   - variant: which fixture the shot needs ('seeded', isolated 'debug',
//     'gutenberg', 'empty', or 'repo:<slug>' for a real checkout of its own);
//   - prepare(page): drives the UI to the state worth photographing. Selectors
//     go by the words on screen, same as the repo's hand-testing convention —
//     if a label changes, the shot fails loudly instead of photographing the
//     wrong thing;
//   - target (optional): a locator for an element screenshot instead of the
//     whole window. Panels read better cropped; whole-window shots orient;
//   - clip (optional): for a part of the window that is no one element, the
//     rectangle to cut out of it, read off the page once `prepare` is done;
//   - viewport (optional): the size of window the page is laid out for,
//     for something taller than the window the harness opens;
//   - instructions (live tier): what the harness tells the maintainer to set
//     up before it takes the picture.
//
// A seeded settings.json cannot express every state worth a picture (#298):
// a server that is serving, a ticket's facts, which come from a visit to its
// Trac page and are held in memory. Shots of those were live-tier for a
// while. They are fixture-tier again, with the outside answered for the app
// the way the journeys answer it (standInForTheOutside in fixtures.cjs): the
// server's start says where the site is served, and Trac's answer is the
// fixture's. What is photographed is the app in a state it does reach, with
// nothing behind it.
//
// The shots that need a checkout, with edits in it, a ticket's branch or an
// origin to fetch from, have one: the `repo:` variants are a real repository
// (buildRepoFixture in fixtures.cjs), and the shot does the rest through the
// app. Each has a variant, and so a repository and a launch, of its own,
// since it writes to both. Two things a shot does not do through the app:
// edit the checkout, which it does from outside as an editor would, and
// leave a ticket some hours ago. The tickets a site was left with are the
// fixture's (PARKED_TICKETS), written as the app writes them.
//
// What is still live-tier needs what no stand-in gives yet: setup-wizard,
// since the self-setup chain arms on the clone-finished edge and a site that
// was already in the registry when the app started never runs it.

// Where the app's controls and cards are is written down once, for the journeys
// and for these shots alike.
const fs = require('fs');
const path = require('path');
const ui = require('../../tests/e2e/helpers/ui.cjs');
const {
	FIXTURE_ROOT, TICKET_FROM_TRAC, LINKED_PULL_REQUESTS, LINKED_TICKET, OTHER_TICKET,
	SUMMARY_FILE, SUMMARY_FIXED, FIXED_LINE, SUMMARY_TEST_FILE, SUMMARY_TEST
} = require('./fixtures.cjs');

// The fixture's site that is a real checkout (the `repo:` variants).
const REPO_SITE = path.join(FIXTURE_ROOT, 'my-first-patch');

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

/**
 * Opens the fixture's ready site and waits for its ticket's pull requests,
 * which the card asks for as the site is opened.
 *
 * @param {import('playwright-core').Page} page
 */
async function openReadySite(page) {
	await selectSite(page, 'my-first-patch');
	await page.getByText(LINKED_PULL_REQUESTS[0].title).waitFor();
}

/**
 * A rectangle to cut out of the window, refused if any of it is outside the
 * part of the window the page is in. A card that has grown taller than the
 * page would otherwise be photographed with the header or the footer's
 * buttons across it, and nothing would say so.
 *
 * @param {import('playwright-core').Page}                        page
 * @param {{x: number, y: number, width: number, height: number}} clip
 * @return {Promise<{x: number, y: number, width: number, height: number}>} The same rectangle.
 */
async function insideThePage(page, clip) {
	const area = await page.locator('.site-workspace-main').boundingBox();
	// A pixel's grace: a part scrolled to the page's very foot can come out
	// a fraction of a pixel past it, where heights are not whole numbers.
	if (clip.y < area.y - 1 || clip.y + clip.height > area.y + area.height + 1) {
		throw new Error(`The part to photograph (${Math.round(clip.y)} to ${Math.round(clip.y + clip.height)}) does not fit in the page (${Math.round(area.y)} to ${Math.round(area.y + area.height)}). Cut less, or scroll the page first.`);
	}
	return clip;
}

/**
 * Has the ticket's card read the ticket from Trac, which the fixture answers
 * for, and waits for what it reads.
 *
 * @param {import('playwright-core').Page} page
 */
async function readTicketFromTrac(page) {
	await ui.readTicketDetailsButton(page).click();
	await page.getByText(TICKET_FROM_TRAC.ticket.summary).filter({ visible: true }).first().waitFor();
	await page.getByText(TICKET_FROM_TRAC.items[0].filename).filter({ visible: true }).first().waitFor();
}

/**
 * Links the fixture's ticket on the checkout, through the app, and waits for
 * what the card then reads of it from Trac and GitHub without being asked.
 *
 * @param {import('playwright-core').Page} page
 */
async function linkTheTicket(page) {
	await ui.linkTicket(page, LINKED_TICKET);
	await page.getByText(TICKET_FROM_TRAC.ticket.summary).filter({ visible: true }).first().waitFor();
	await page.getByText(LINKED_PULL_REQUESTS[0].title).filter({ visible: true }).first().waitFor();
}

/**
 * Waits for a button that can be pressed, and presses nothing. A ticket's
 * buttons cannot be until whatever the site is doing has wholly ended, which
 * for a link is after the card has read the ticket; one that is only on the
 * page may still be drawn as held. A trial click is the wait. It leaves the
 * pointer over the button, which is then drawn as about to be pressed, so the
 * pointer is taken away again.
 *
 * @param {import('playwright-core').Page}    page
 * @param {import('playwright-core').Locator} button
 */
async function waitUntilPressable(page, button) {
	await button.click({ trial: true });
	await page.mouse.move(0, 0);
}

/**
 * Makes one change in the checkout, from outside the app as an editor would:
 * the fix to the file the ticket is about.
 */
function fixTheLine() {
	fs.writeFileSync(path.join(REPO_SITE, SUMMARY_FILE), SUMMARY_FIXED);
}

/**
 * Asks for the fixture's ticket to be linked while there is an edit on trunk,
 * and waits for the question the app asks about the edit in place of linking.
 *
 * @param {import('playwright-core').Page} page
 * @return {Promise<import('playwright-core').Locator>} The answer that takes the edit along.
 */
async function askToLinkOverAnEdit(page) {
	fixTheLine();
	await ui.ticketField(page).first().fill(LINKED_TICKET);
	await ui.linkTicketButton(page).first().click();
	const carry = page.getByRole('button', { name: `Take these edits into #${LINKED_TICKET}`, exact: true });
	await carry.waitFor();
	return carry;
}

/**
 * Does the contributor's work in the checkout, from outside the app as an
 * editor would: the fix to the file the ticket is about, and a test for it
 * in a file trunk does not have.
 */
function editTheCheckout() {
	fixTheLine();
	fs.mkdirSync(path.dirname(path.join(REPO_SITE, SUMMARY_TEST_FILE)), { recursive: true });
	fs.writeFileSync(path.join(REPO_SITE, SUMMARY_TEST_FILE), SUMMARY_TEST);
}

/**
 * Opens the review of the checkout's changes and waits for the diff, which
 * the dialog works out when it opens.
 *
 * @param {import('playwright-core').Page} page
 * @return {Promise<import('playwright-core').Locator>} The dialog.
 */
async function openTheReview(page) {
	await ui.reviewChangesButton(page).click();
	const dialog = page.getByRole('dialog', { name: 'Review & submit changes' });
	await dialog.getByText(FIXED_LINE.trim(), { exact: false }).first().waitFor();
	return dialog;
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
			await page.getByText(LINKED_PULL_REQUESTS[0].title).waitFor();
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
			// Starting the dev server is what makes the renderer attach the
			// debug-log tail, which it does before it asks for the server, and
			// the tail is not stood in for. The server and the script it runs
			// first are (see standInForTheOutside): this fixture deliberately
			// is not a WordPress clone, and the picture is of the real tail
			// without their inevitable failures in it.
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
		prepare: async (page) => {
			await selectSite(page, 'my-first-patch');
			// Starting the server is what loads the list and brings the mail
			// server up. Both are stood in for (see standInForTheOutside), on
			// a port that is the same in every picture, where a real mail
			// server listens on one of its own choosing.
			await ui.startDevServerButton(page).click();
			await ui.openTray(page, 'Email');
			await page.getByText('Welcome to WordPress Contributor Day').filter({ visible: true }).waitFor();
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
	{
		slug: 'dev-server-running',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await openReadySite(page);
			// The server is stood in for (see standInForTheOutside): its start
			// says where the site is served, and the window then has a
			// running server, with the ways to the site and what to log in
			// with.
			await ui.startDevServerButton(page).click();
			await ui.stopDevServerButton(page).waitFor();
			await page.getByText('wp-admin', { exact: true }).filter({ visible: true }).first().waitFor();
			// The button just pressed keeps the focus and has the pointer over
			// it, and is drawn with a ring and as if about to be pressed again,
			// which is not what the picture is of.
			await ui.stopDevServerButton(page).blur();
			await page.mouse.move(0, 0);
		}
	},
	{
		slug: 'site-view',
		tier: 'fixture',
		variant: 'seeded',
		prepare: async (page) => {
			await openReadySite(page);
			await readTicketFromTrac(page);
		}
	},
	{
		slug: 'trac-ticket-panel',
		tier: 'fixture',
		variant: 'seeded',
		// The ticket's facts and the pull requests that cite it: the card
		// from its top to the foot of that list. The whole card is taller
		// than the page has room for, and linked-pull-requests has the rest.
		clip: async (page) => {
			const card = await ui.card(page, 'Trac ticket').boundingBox();
			const next = await page.getByText('Trac attachments', { exact: true }).filter({ visible: true }).boundingBox();
			return insideThePage(page, { x: card.x, y: card.y, width: card.width, height: next.y - 32 - card.y });
		},
		prepare: async (page) => {
			await openReadySite(page);
			await readTicketFromTrac(page);
		}
	},
	{
		slug: 'linked-pull-requests',
		tier: 'fixture',
		variant: 'seeded',
		// The card's two lists and not its facts: from the first list's
		// heading to the card's foot.
		clip: async (page) => {
			const card = await ui.card(page, 'Trac ticket').boundingBox();
			const lists = await page.getByText('Linked pull requests', { exact: true }).filter({ visible: true }).boundingBox();
			const top = lists.y - 16;
			return insideThePage(page, { x: card.x, y: top, width: card.width, height: card.y + card.height - top });
		},
		prepare: async (page) => {
			await openReadySite(page);
			await readTicketFromTrac(page);
			// The page is put where the lists are whole, above the tray's
			// buttons, before the picture is cut out of it.
			await ui.card(page, 'Trac ticket').evaluate((card) => card.scrollIntoView({ block: 'end' }));
		}
	},
	{
		slug: 'submit-changes-diff',
		tier: 'fixture',
		variant: 'repo:submit-changes-diff',
		target: (page) => page.locator('.patch-diff'),
		prepare: async (page) => {
			await linkTheTicket(page);
			editTheCheckout();
			await openTheReview(page);
		}
	},
	{
		slug: 'submit-destinations',
		tier: 'fixture',
		variant: 'repo:submit-destinations',
		// The three destinations are one under another and taller than the
		// window, where the dialog scrolls to reach the last. The column is
		// as tall as the dialog; the picture is of it down to its last card.
		viewport: { width: 1200, height: 1400 },
		clip: async (page) => {
			const column = await page.locator('.patch-destinations').boundingBox();
			const last = await page.locator('.patch-destinations > :last-child').boundingBox();
			// The column scrolls where it is shorter than what is in it, and
			// would then be photographed cut off, with nothing to say so.
			if (last.y + last.height > column.y + column.height + 1) {
				throw new Error(`The destinations (to ${Math.round(last.y + last.height)}) do not fit in their column (to ${Math.round(column.y + column.height)}). Ask for a taller window.`);
			}
			return { x: column.x, y: column.y - 8, width: column.width, height: last.y + last.height - column.y + 16 };
		},
		prepare: async (page) => {
			await linkTheTicket(page);
			editTheCheckout();
			const dialog = await openTheReview(page);
			for (const destination of ['Open a pull request', 'Attach to Trac', 'Hand it to a mentor']) {
				await dialog.getByText(destination, { exact: true }).first().waitFor();
			}
		}
	},
	{
		slug: 'github-sign-in',
		tier: 'fixture',
		variant: 'repo:github-sign-in',
		target: (page) => page.getByText('Open a pull request', { exact: true }).locator('../..'),
		prepare: async (page) => {
			await linkTheTicket(page);
			editTheCheckout();
			const dialog = await openTheReview(page);
			// The sign-in is stood in for: it gets as far as its code and
			// waits there, as a real one does until GitHub is told the code.
			await dialog.getByRole('button', { name: 'Sign in with GitHub', exact: true }).click();
			await dialog.getByText('WDJB-MJHT').waitFor();
		}
	},
	{
		slug: 'apply-patch-conflict',
		tier: 'fixture',
		variant: 'repo:apply-patch-conflict',
		target: (page) => ui.card(page, 'Apply a patch or PR'),
		prepare: async (page) => {
			await linkTheTicket(page);
			// The contributor has already changed the line the ticket's patch
			// expects to find, so the patch does not fit.
			editTheCheckout();
			const attachment = page.getByRole('listitem').filter({ hasText: TICKET_FROM_TRAC.items[0].filename, visible: true });
			await attachment.getByRole('button', { name: 'Apply…', exact: true }).click();
			const preview = page.getByRole('dialog', { name: `Apply ${TICKET_FROM_TRAC.items[0].filename}`, exact: true });
			await ui.applyAndRebuildButton(preview).click();
			const card = ui.card(page, 'Apply a patch or PR');
			await card.getByRole('alert').filter({ hasText: 'The checkout was not changed.' }).waitFor();
			await card.scrollIntoViewIfNeeded();
		}
	},
	{
		slug: 'trunk-update-progress',
		tier: 'fixture',
		variant: 'repo:trunk-update-progress',
		target: (page) => ui.card(page, 'Updating to latest trunk'),
		prepare: async (page) => {
			// The fixture's origin is a commit ahead, so there is something to
			// fetch; what the update runs after it is stood in for and never
			// ends, so the card stays part of the way through.
			await ui.siteMenuButton(page).click();
			await ui.updateTrunkMenuItem(page).click();
			await ui.card(page, 'Updating to latest trunk').getByText('Rebuilding — output in the Terminal', { exact: true }).waitFor();
		}
	},
	{
		slug: 'site-with-tickets',
		tier: 'fixture',
		variant: 'repo:site-with-tickets',
		// The ticket in hand and the card of the others under it: a page
		// taller than the window the harness opens, so a taller window.
		viewport: { width: 1200, height: 1480 },
		prepare: async (page) => {
			await linkTheTicket(page);
			await ui.ticketRow(page, OTHER_TICKET).waitFor();
			await waitUntilPressable(page, ui.switchBackButton(page, OTHER_TICKET));
			// The picture is of both cards. A page grown past this window
			// would leave the second out of it, and nothing would say so.
			await insideThePage(page, await ui.ticketListCard(page).boundingBox());
		}
	},
	{
		slug: 'ticket-list-card',
		tier: 'fixture',
		variant: 'repo:ticket-list-card',
		target: (page) => ui.ticketListCard(page),
		prepare: async (page) => {
			await linkTheTicket(page);
			await ui.ticketListCard(page).scrollIntoViewIfNeeded();
			await waitUntilPressable(page, ui.switchBackButton(page, OTHER_TICKET));
		}
	},
	{
		slug: 'ticket-list-unlinked',
		tier: 'fixture',
		variant: 'repo:ticket-list-unlinked',
		target: (page) => ui.ticketListCard(page),
		prepare: async (page) => {
			await ui.ticketListCard(page).scrollIntoViewIfNeeded();
			await waitUntilPressable(page, ui.continueWorkingButton(page, OTHER_TICKET));
			await waitUntilPressable(page, ui.continueWorkingButton(page, LINKED_TICKET));
		}
	},
	{
		slug: 'trunk-work-question',
		tier: 'fixture',
		variant: 'repo:trunk-work-question',
		target: (page) => ui.card(page, 'Trac ticket'),
		prepare: async (page) => {
			const carry = await askToLinkOverAnEdit(page);
			// The button just pressed keeps the focus, and is drawn with a
			// ring the picture is not of.
			await ui.linkTicketButton(page).first().blur();
			await page.mouse.move(0, 0);
			await carry.scrollIntoViewIfNeeded();
		}
	},
	{
		slug: 'carried-work-notice',
		tier: 'fixture',
		variant: 'repo:carried-work-notice',
		// The card from its top to the line over the pull requests: the
		// ticket, the notice and what the card says of the change. The
		// whole card is taller than the page has room for.
		clip: async (page) => {
			const card = await ui.card(page, 'Trac ticket').boundingBox();
			const lists = await page.getByText('Linked pull requests', { exact: true }).filter({ visible: true }).boundingBox();
			return insideThePage(page, { x: card.x, y: card.y, width: card.width, height: lists.y - 32 - card.y });
		},
		prepare: async (page) => {
			const carry = await askToLinkOverAnEdit(page);
			await carry.click();
			await ui.workItemNumber(page, LINKED_TICKET).first().waitFor();
			await page.getByText(`came along into #${LINKED_TICKET}`, { exact: false }).filter({ visible: true }).first().waitFor();
			await page.getByText(TICKET_FROM_TRAC.ticket.summary).filter({ visible: true }).first().waitFor();
			await page.getByText(LINKED_PULL_REQUESTS[0].title).filter({ visible: true }).first().waitFor();
			// What the card says of the change is read after the link has
			// ended, by a read of its own, and is the last thing in the
			// picture to arrive.
			await page.getByText(`You have 1 unsubmitted change for ticket #${LINKED_TICKET}`, { exact: false }).filter({ visible: true }).first().waitFor();
		}
	},

	// ---- Live tier: real site, maintainer present. `instructions` is what the
	// harness prints before pausing.
	//
	// Every path in these images is published, so create the site somewhere
	// with no username in it (/private/tmp/wpct-docs/my-first-patch is what the
	// committed ones show), and name it to match the fixture-tier shots so the
	// guide reads as one site.
	{
		slug: 'setup-wizard',
		tier: 'live',
		instructions:
			'Create a site and leave it alone. Shoot while the "Setting this site up for you — step N of 3" banner is up, with a step still to go, so the checklist shows a done step, a running one and a locked one.'
	},
];

module.exports = { shots };
