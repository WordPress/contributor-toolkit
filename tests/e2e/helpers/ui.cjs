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
// What belongs here is a control that more than one file reaches, something
// typed into or clicked, and any locator that has to know how the screen is
// built rather than what it says: a sidebar entry, a card. What does not
// belong here is a sentence one journey asserts, or a button only one journey
// presses. Those are what that journey is about, and they read best where the
// claim is made; the wording itself is pinned by the unit test of the module
// that words it.
//
// Every locator is the one a caller would have written inline, and nothing
// more: no `.first()`, no waiting, no visibility filter unless the comment
// says why. A caller that needs one adds it, where a reader can see it.
//
// No `expect` in this file. The screenshot harness loads it with
// `playwright-core` alone, and an assertion belongs in the test that makes it.

// --- The sidebar -------------------------------------------------------------

/**
 * A site's entry in the sidebar.
 *
 * The site's name is on screen twice, the sidebar entry and the heading of the
 * open site, so neither can be reached by text alone. The entry's accessible
 * name is the site's label followed by its project tag (#251), so the label is
 * matched as the whole name minus that one word.
 *
 * @param {Object} page
 * @param {string} label The site's name.
 * @return {Object} The locator.
 */
const sidebarEntry = ( page, label ) =>
	page.getByRole( 'button', { name: new RegExp( `^${ label.replace( /[.*+?^${}()|[\]\\]/g, '\\$&' ) } (Core|Gutenberg)$` ) } );

const createSiteButton = ( page ) => page.getByRole( 'button', { name: 'Create a site', exact: true } );
const createSiteDialog = ( page ) => page.getByRole( 'dialog', { name: 'Create a site' } );

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

const siteMenuButton = ( page ) => page.getByRole( 'button', { name: 'More', exact: true } );
const updateTrunkMenuItem = ( page ) => page.getByRole( 'menuitem', { name: 'Update to latest trunk', exact: true } );
const deleteSiteMenuItem = ( page ) => page.getByRole( 'menuitem', { name: 'Delete this site', exact: true } );

const startDevServerButton = ( page ) => page.getByRole( 'button', { name: 'Start dev server', exact: true } );
const reviewChangesButton = ( page ) => page.getByRole( 'button', { name: 'Review & submit changes', exact: true } );
const retryInstallButton = ( page ) => page.getByRole( 'button', { name: 'Retry install & build', exact: true } );

/**
 * A card of the site's view, by its heading.
 *
 * The cards are styled `div`s with the heading as their first child, not
 * landmarks, so this reads the shape of the markup: the one selector here that
 * does. Every site's view is in the document at once and only the selected one
 * is visible, so the visibility filter is what picks the right card.
 *
 * @param {Object} page
 * @param {string} heading The card's heading, exactly.
 * @return {Object} The locator.
 */
const card = ( page, heading ) =>
	page
		.locator( `div:has(> div:text-is("${ heading }"))` )
		.filter( { visible: true } )
		.last();

// --- The ticket or issue the site is working on ------------------------------

const ticketField = ( page ) => page.getByLabel( 'Trac ticket number or URL' );
const linkTicketButton = ( page ) => page.getByRole( 'button', { name: 'Link ticket', exact: true } );
const issueField = ( page ) => page.getByLabel( 'GitHub issue number or URL' );
const linkIssueButton = ( page ) => page.getByRole( 'button', { name: 'Link issue', exact: true } );
const unlinkButton = ( page ) => page.getByRole( 'button', { name: 'Unlink', exact: true } );

/**
 * The number of the linked ticket or issue, as the card's subject.
 *
 * @param {Object}        page
 * @param {string|number} number
 * @return {Object} The locator.
 */
const workItemNumber = ( page, number ) => page.getByText( `#${ number }`, { exact: true } );

// The way back to a parked ticket while another one is linked.
const switchBackButton = ( page ) => page.getByRole( 'button', { name: 'switch', exact: true } );

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
// By part of its name: the button reads "or choose a .diff / .patch file…",
// and the journeys that assert it is gone should not pass because the
// sentence around those words changed.
const choosePatchFileButton = ( page ) => page.getByRole( 'button', { name: 'choose a .diff / .patch file' } );
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
	createSiteDialog,
	renderedApp,
	siteMenuButton,
	updateTrunkMenuItem,
	deleteSiteMenuItem,
	startDevServerButton,
	reviewChangesButton,
	retryInstallButton,
	card,
	ticketField,
	linkTicketButton,
	issueField,
	linkIssueButton,
	unlinkButton,
	workItemNumber,
	switchBackButton,
	linkTicket,
	prField,
	applyPrButton,
	choosePatchFileButton,
	applyAndRebuildButton,
	revertPatchButton,
	revertPrButton,
	inDocumentOrder,
};
