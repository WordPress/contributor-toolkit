'use strict';

// Where things are on the app's screen, by the words and roles a contributor
// finds them by.
//
// The journeys and the documentation screenshots (scripts/screenshots/) both
// drive the app through what is on screen: a field by its label, a button by
// its name, a card by its heading. This is the one place those names are
// written down, so that renaming a button, or turning a menu into a dialog,
// is a change to this file and to nothing that uses it.
//
// What is here: every control, something typed into or clicked, that more
// than one of those files reaches; and six locators that find a part of the
// screen rather than something to press, which are the rendered app, an entry
// of the sites list, what a window with no site says, the open site's
// heading, a card and a ticket's row.
//
// What is not here: a sentence one journey asserts, a button only one journey
// presses, and a selector only one file needs even when it reads the markup
// (the engine journey's spinner, the crops in scripts/screenshots/shots.cjs).
// Those are what that file is about, and they read best where the claim is
// made.
//
// Every locator is the one a caller would have written inline, and nothing
// more: no `.first()`, no waiting, no visibility filter unless the comment
// says why. A caller that needs one adds it, where a reader can see it.
//
// No `expect` in this file. The screenshot harness loads it with
// `playwright-core` alone, and an assertion belongs in the test that makes it.

// The words of the list of a site's tickets, which each of its rows' buttons
// is named with.
const { ticketListCard: ticketListWords } = require( '../../../src/renderer/ticket-branch-list.cjs' );

// --- The sites list ----------------------------------------------------------

/**
 * A site's entry in the sites list.
 *
 * The site's name is on screen twice, the entry in the list and the heading
 * of the open site, so neither can be reached by text alone. The entry is a
 * button named by the site's label. The line under it, the project (#251) or
 * that the site is being deleted, is in the entry's row and not in the
 * button's name.
 *
 * That is the name of a site with nothing to report, and only of that one. A
 * site whose trunk is old or whose update is incomplete has its dot's text
 * after its name, in brackets, and a site being deleted is named
 * "<label> (Deleting)": this matches none of them. Seed a recent `trunkDate`,
 * or find those by the name they have.
 *
 * While the list is hidden its entries are not in the accessibility tree, so
 * this finds none.
 *
 * @param {Object} page
 * @param {string} label The site's name.
 * @return {Object} The locator.
 */
const sidebarEntry = ( page, label ) => page.getByRole( 'button', { name: label, exact: true } );

// The list's own button, there whenever the list is: with at least one site.
const createSiteButton = ( page ) => page.getByRole( 'button', { name: 'Create new site', exact: true } );
/**
 * The button in the middle of a window with no site in it. It has the name the
 * create-site dialog gives its own button, so this is the one in the app's
 * own element: a dialog is drawn outside it.
 *
 * @param {Object} page
 * @return {Object} The locator.
 */
const createFirstSiteButton = ( page ) =>
	page.locator( '#root' ).getByRole( 'button', { name: 'Create site', exact: true } );
// What a window with no site in it says.
const noSitesTitle = ( page ) => page.getByText( 'No sites', { exact: true } );
const createSiteDialog = ( page ) => page.getByRole( 'dialog', { name: 'Create a site' } );
// In the footer, whatever the window shows above it.
const giveFeedbackButton = ( page ) => page.getByRole( 'button', { name: 'Give feedback', exact: true } );

// --- A dialog ----------------------------------------------------------------

// The button in a dialog's header that closes it. Takes the dialog, not the
// page: more than one can be in the document.
const closeDialogButton = ( dialog ) => dialog.getByRole( 'button', { name: 'Close', exact: true } );

// --- The open site -----------------------------------------------------------

/**
 * What the app rendered. `#root` is in the static HTML, and its one child is
 * the design system's provider, which is there whatever the app inside it
 * rendered; the app's own elements start one level further down.
 *
 * @param {Object} page
 * @return {Object} The locator.
 */
const renderedApp = ( page ) => page.locator( '#root > * > *' );

/**
 * The open site's heading, in the page's header. The site's name is in the
 * sites list too, so this is the half of the pair `sidebarEntry` is not.
 *
 * @param {Object} page
 * @param {string} label The site's name.
 * @return {Object} The locator.
 */
const siteHeading = ( page, label ) => page.getByRole( 'heading', { name: label, exact: true } );

// The open site's menu, in the page's header, and what is in it. An item is
// there only while the menu is open.
const siteMenuButton = ( page ) => page.getByRole( 'button', { name: 'Site actions', exact: true } );
const updateTrunkMenuItem = ( page ) => page.getByRole( 'menuitem', { name: 'Update to latest trunk', exact: true } );
const deleteSiteMenuItem = ( page ) => page.getByRole( 'menuitem', { name: 'Delete site', exact: true } );

// The server's button, in the open site's details. It shows one word and is
// named by what pressing it does. The header's menu has an item of the same
// name, which is a menu item and not this.
const startDevServerButton = ( page ) => page.getByRole( 'button', { name: 'Start development server', exact: true } );
// The same button once the server has an address; while it is still starting it reads neither.
const stopDevServerButton = ( page ) => page.getByRole( 'button', { name: 'Stop development server', exact: true } );
// The build watch's one button, likewise in the details, by what it offers:
// it stops the watch while the watch is building or watching, and starts it
// the rest of the time.
const startBuildWatchButton = ( page ) => page.getByRole( 'button', { name: 'Start build watch', exact: true } );
const stopBuildWatchButton = ( page ) => page.getByRole( 'button', { name: 'Stop build watch', exact: true } );
// The header's menu for one of the open site's two processes, by what it says
// the process is doing: "Server stopped", "Build watching". With little room
// the header shows its dot alone; its name is the same.
const processMenuButton = ( page, label ) => page.getByRole( 'button', { name: label, exact: true } );
// In the page's header.
const reviewChangesButton = ( page ) => page.getByRole( 'button', { name: 'Review & submit changes', exact: true } );
const retryInstallButton = ( page ) => page.getByRole( 'button', { name: 'Retry install & build', exact: true } );
// A command offered in the hints under the terminal. It is a button only while
// the site is built and nothing is running; the rest of the time it is plain
// text, or not there.
const terminalHint = ( page, command ) => card( page, 'Terminal' ).getByRole( 'button', { name: command, exact: true } );
// Where keys go when the site's terminal is typed in. What the terminal shows
// is not here: it has no role, and the one journey that reads it says how.
const terminalInput = ( page ) => page.getByRole( 'textbox', { name: 'Terminal input' } );

/**
 * A card of the site's view, by its heading.
 *
 * The cards redrawn with the design system (#557) are regions named by their
 * heading. The ones not redrawn yet are styled `div`s with the heading as
 * their first child, not landmarks, and for those this reads the shape of the
 * markup. Every site's view is in the document at once and only the selected
 * one is visible, so the visibility filter is what picks the right card, and
 * `.last()` the innermost `div` that fits, should a wrapper around the card
 * ever fit too.
 *
 * @param {Object} page
 * @param {string} heading The card's heading, exactly.
 * @return {Object} The locator.
 */
const card = ( page, heading ) =>
	page
		.locator( `div:has(> div:text-is("${ heading }"))` )
		.or( page.getByRole( 'region', { name: heading, exact: true } ) )
		.filter( { visible: true } )
		.last();

/**
 * A tab of the Logs panel, by the whole of its name. The name says what is
 * behind the tab as well as which it is: the build watch's says what the
 * watch is doing, "Build watcher (watching)" for one, and debug.log's carries
 * a count.
 *
 * @param {Object} page
 * @param {string} name The tab's name, exactly.
 * @return {Object} The locator.
 */
const logTab = ( page, name ) => page.getByRole( 'tab', { name, exact: true } );

// --- The ticket or issue the site is working on ------------------------------

// The field a Trac ticket is linked in. There are two, with one helper for
// both: the work-item card's, "Ticket number or URL", and the review's,
// "Trac ticket number or URL", which is where a ticket is linked from when a
// patch is about to be saved for one.
const ticketField = ( page ) => page.getByLabel( /^(Trac ticket|Ticket) number or URL$/ );
const linkTicketButton = ( page ) => page.getByRole( 'button', { name: 'Link ticket', exact: true } );
const issueField = ( page ) => page.getByLabel( 'Issue number or URL', { exact: true } );
const linkIssueButton = ( page ) => page.getByRole( 'button', { name: 'Link issue', exact: true } );
const unlinkButton = ( page ) => page.getByRole( 'button', { name: 'Unlink', exact: true } );

/**
 * The number of the linked ticket or issue, as the card's subject. It is
 * what says a site is working on one: the card's own title, "Trac ticket" or
 * "GitHub issue", is the same with nothing linked.
 *
 * @param {Object}        page
 * @param {string|number} number
 * @return {Object} The locator.
 */
const workItemNumber = ( page, number ) => page.getByText( `#${ number }`, { exact: true } );

/**
 * The work-item card's heading, which is what kind of work item the site's
 * project has.
 *
 * @param {Object} page
 * @param {string} title "Trac ticket" or "GitHub issue".
 * @return {Object} The locator.
 */
const workItemHeading = ( page, title ) => page.getByRole( 'heading', { name: title, exact: true } );

/**
 * The work-item card itself.
 *
 * @param {Object} page
 * @param {string} title "Trac ticket" or "GitHub issue".
 * @return {Object} The locator.
 */
const workItemCard = ( page, title ) => page.getByRole( 'region', { name: title, exact: true } );

/**
 * The way from the card to the linked ticket or issue where it lives. It is
 * named by the number, and says where it goes as its tooltip.
 *
 * @param {Object}        page
 * @param {string|number} number
 * @return {Object} The locator.
 */
const openWorkItemButton = ( page, number ) => page.getByRole( 'button', { name: `#${ number }`, exact: true } );

// On a Trac ticket that has not been read yet: reads its facts and its
// attachments, which opens Trac's own window.
const readTicketDetailsButton = ( page ) => page.getByRole( 'button', { name: 'Read details from Trac', exact: true } );

// On each pull request and each attachment of the linked ticket: reads that
// patch before it is applied. Every row's button has this one name.
const readPatchButton = ( page ) => page.getByRole( 'button', { name: 'Apply…', exact: true } );

/**
 * The card that lists a site's parked tickets, under either of its headings:
 * the other tickets while one is linked, every ticket while none is.
 *
 * @param {Object} page
 * @return {Object} The locator.
 */
const ticketListCard = ( page ) =>
	page.getByRole( 'region', { name: /^(Other|Your) (tickets|issues) on this site$/ } );

// A row's button is named by what it shows and then its ticket's number.
// What it shows is asked of the module that words the card, so that the two
// cannot part without a journey going red.
const rowButton = ( page, words, ticket ) =>
	ticketListCard( page ).getByRole( 'button', ticket === undefined
		? { name: new RegExp( `^${ escapeRegExp( words ) } #\\d+$` ) }
		: { name: `${ words } #${ ticket }`, exact: true } );
const escapeRegExp = ( text ) => text.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' );
const rowWords = ( linked, provider ) => ticketListWords( { rowCount: 1, linked, provider } );

/**
 * The way back to a parked ticket while another one is linked.
 *
 * @param {Object}        page
 * @param {string|number} [ticket] Which ticket's; every parked ticket's when left out.
 * @return {Object} The locator.
 */
const switchBackButton = ( page, ticket ) => rowButton( page, rowWords( true ).action, ticket );

/**
 * The way back to a parked ticket while nothing is linked.
 *
 * @param {Object}        page
 * @param {string|number} [ticket] Which ticket's; every parked ticket's when left out.
 * @return {Object} The locator.
 */
const continueWorkingButton = ( page, ticket ) => rowButton( page, rowWords( false ).action, ticket );

/**
 * What deletes a parked ticket's work. It asks first.
 *
 * @param {Object}        page
 * @param {string|number} ticket     Which ticket's.
 * @param {string}        [provider] What the site's work items are: Trac tickets unless told 'github-issue'.
 * @return {Object} The locator.
 */
const deleteWorkButton = ( page, ticket, provider ) => rowButton( page, rowWords( false, provider ).remove, ticket );

/**
 * The row for one parked ticket, in the list of a site's tickets.
 *
 * Addressed by its ticket's number rather than by position. Every row carries
 * the same two controls, and the list is ordered by how recently each ticket
 * was used, so `.first()` picks whichever ticket the app most recently
 * touched, which is a different one depending on how far the render has got.
 * That is a test that deletes the wrong branch and then fails somewhere else
 * entirely.
 *
 * @param {Object}        page
 * @param {string|number} ticket
 * @return {Object} The locator.
 */
const ticketRow = ( page, ticket ) =>
	ticketListCard( page )
		.getByRole( 'listitem' )
		.filter( { has: page.getByText( `#${ ticket }`, { exact: true } ) } );

/**
 * Links a ticket through the card, the way a contributor does, and waits for
 * the app to say it finished.
 *
 * The ticket number rendered as the card's subject is that signal. Waiting on
 * it rather than on a timeout is what keeps this honest on a Windows runner,
 * where the checkout takes noticeably longer. Nothing may be linked when this
 * runs: once a ticket is linked, the field is not on screen at all.
 *
 * @param {Object} page
 * @param {string} ticket
 */
async function linkTicket( page, ticket ) {
	await ticketField( page ).first().fill( ticket );
	await linkTicketButton( page ).first().click();
	await workItemNumber( page, ticket ).first().waitFor( { timeout: 30_000 } );
}

// --- Applying a patch or a pull request --------------------------------------

const prField = ( page ) => page.getByLabel( 'Pull request URL or number' );
const applyPrButton = ( page ) => page.getByRole( 'button', { name: 'Apply PR', exact: true } );
// On a project that takes patch files the card has a tab for each way in,
// and stays on the one it was left on: a journey that asks for a pull request
// after choosing a file goes back to this tab first. A project that takes no
// patch files has neither tab.
const pullRequestTab = ( page ) => page.getByRole( 'tab', { name: 'Pull request', exact: true } );
const patchFileTab = ( page ) => page.getByRole( 'tab', { name: 'Diff', exact: true } );
const choosePatchFileButton = ( page ) => page.getByRole( 'button', { name: 'Choose a .diff or .patch file…', exact: true } );
// Any way to a patch file, a tab or a button, whatever else its name says.
// For asserting there is none: held to the exact names above, that assertion
// would pass the day the words around them changed. A button that only names
// a file, as an attachment's row does, is not one.
const anyPatchFileButton = ( page ) =>
	page.getByRole( 'tab', { name: /diff|patch/i } ).or( page.getByRole( 'button', { name: /^choose a\b.*(diff|patch)/i } ) );

/**
 * Opens the tab a patch file is chosen under and presses its button, which
 * opens the system's file dialog: answer that first, with
 * `session.answerFileDialog`.
 *
 * @param {Object} page
 */
async function choosePatchFile( page ) {
	await patchFileTab( page ).click();
	await choosePatchFileButton( page ).click();
}
const applyAndRebuildButton = ( page ) => page.getByRole( 'button', { name: 'Apply and rebuild', exact: true } );
const revertPatchButton = ( page ) => page.getByRole( 'button', { name: 'Revert this patch', exact: true } );
const revertPrButton = ( page ) => page.getByRole( 'button', { name: 'Revert this PR', exact: true } );

// --- Reading the page --------------------------------------------------------

/**
 * Whether the elements come one after another in the document, in the order
 * given. The site's cards are laid out in document order, so this is where
 * each one sits on the page, read without a bounding box: the page scrolls to
 * the next step as cards appear, and a box measured mid-scroll can land
 * anywhere (#478).
 *
 * @param {Object}   page
 * @param {Object[]} locators Each matching exactly one element.
 * @return {Promise<boolean>} True when every element follows the one before it.
 */
async function inDocumentOrder( page, locators ) {
	const handles = await Promise.all( locators.map( ( locator ) => locator.elementHandle() ) );
	return page.evaluate( ( elements ) => {
		// DOCUMENT_POSITION_FOLLOWING is bit 4 of the mask.
		const follows = ( from, to ) => Math.floor( from.compareDocumentPosition( to ) / 4 ) % 2 === 1;
		return elements.every( ( element, i ) => i === 0 || follows( elements[ i - 1 ], element ) );
	}, handles );
}

module.exports = {
	sidebarEntry,
	createSiteButton,
	createFirstSiteButton,
	noSitesTitle,
	createSiteDialog,
	giveFeedbackButton,
	closeDialogButton,
	renderedApp,
	siteHeading,
	siteMenuButton,
	updateTrunkMenuItem,
	deleteSiteMenuItem,
	startDevServerButton,
	stopDevServerButton,
	startBuildWatchButton,
	stopBuildWatchButton,
	processMenuButton,
	reviewChangesButton,
	retryInstallButton,
	terminalInput,
	terminalHint,
	logTab,
	card,
	ticketField,
	linkTicketButton,
	issueField,
	linkIssueButton,
	unlinkButton,
	workItemHeading,
	workItemCard,
	readTicketDetailsButton,
	readPatchButton,
	openWorkItemButton,
	workItemNumber,
	ticketListCard,
	switchBackButton,
	continueWorkingButton,
	deleteWorkButton,
	ticketRow,
	linkTicket,
	prField,
	applyPrButton,
	pullRequestTab,
	patchFileTab,
	choosePatchFileButton,
	choosePatchFile,
	anyPatchFileButton,
	applyAndRebuildButton,
	revertPatchButton,
	revertPrButton,
	inDocumentOrder,
};
