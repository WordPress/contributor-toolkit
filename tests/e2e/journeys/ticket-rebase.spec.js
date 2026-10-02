/**
 * Moving a ticket's work onto the current trunk, driven through the app (#385).
 *
 * After an update the ticket card says trunk has moved and, since the bundled
 * Git, offers to move the work itself. The move crosses every layer: main
 * replays the ticket's single WIP commit onto trunk and rewrites the checkout,
 * the store records the new base, and the card's notice goes away because
 * status now finds the ticket current. A conflict is the other half of the
 * contract: refused with the file named, nothing moved.
 *
 * The origin is a clone of the site on disk, moved ahead by the test; the
 * update that makes the ticket stale runs through the app too, so the state
 * the button meets is the one a contributor has. Nothing here reaches the
 * network.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { ticketTrunkNotice } = require( '../../../src/renderer/ticket-trunk-notice.cjs' );
const { makeSite, advanceOrigin, read, write, currentBranch, SUBSTRATE, SUBSTRATE_CONTENT, LOGIN, DOOMED } = require( '../helpers/git-site.cjs' );

const TICKET = '60001';
const MY_LOGIN = '<?php // my work on the ticket\n';
const NOTICE = 'Trunk has moved since this ticket started.';
const BUTTON = 'Update this ticket to the current trunk';

/**
 * Links the ticket, edits a file on it, and updates the site so trunk moves
 * ahead of the ticket's base: the state in which the notice appears.
 *
 * @param {Object} session
 * @param {Object} site
 * @param {Object} originChange Files to commit into the origin before the update.
 */
async function makeTicketBehindTrunk( session, site, originChange ) {
	const { page } = session;
	await ui.linkTicket( page, TICKET );
	write( site.dir, LOGIN, MY_LOGIN );
	// Park the edit on the ticket (unlink, then continue) so the update meets
	// a clean tree: the edit is the ticket's work, not something to save or
	// discard at the update's dirty-tree question.
	await ui.unlinkButton( page ).click();
	await ui.continueWorkingButton( page, TICKET ).click( { timeout: 30_000 } );
	await expect( ui.workItemNumber( page, TICKET ).first() ).toBeVisible( { timeout: 30_000 } );
	const newTip = advanceOrigin( site.origin, originChange );

	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();
	await expect( page.getByText( 'Updated to the latest trunk' ).first() ).toBeVisible( { timeout: 120_000 } );
	await expect( page.getByText( NOTICE ) ).toBeVisible( { timeout: 30_000 } );
	return newTip;
}

test( 'the notice moves the ticket onto the current trunk in one click, keeping the work and the substrate', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	await session.start( site.settings );
	const { page } = session;
	// Everything said to a screen reader from here on. The region that says
	// it holds one message at a time and the next one replaces it, so what
	// was said cannot be read off the page afterwards; and two messages in
	// one turn of the page leave only the second in the region, so what is
	// kept is what was put there, taken from the record of each change, and
	// not what the region holds when the observer is told.
	await page.evaluate( () => {
		window.__e2eSpoken = [];
		new window.MutationObserver( ( records ) => {
			for ( const record of records ) {
				const within = record.target.nodeType === 1 ? record.target : record.target.parentElement;
				if ( ! within || ! within.closest( '[aria-live]' ) ) continue;
				for ( const node of record.addedNodes ) {
					const text = node.textContent.trim();
					if ( text ) window.__e2eSpoken.push( text );
				}
			}
		} ).observe( document.body, { subtree: true, childList: true } );
	} );
	const newTip = await makeTicketBehindTrunk( session, site, { 'src/doomed.php': '<?php // trunk moved this\n' } );

	// INVARIANT — the notice is said as it appears, the sentence and what
	// can be done about it, and not only shown: it is the app telling a
	// contributor their ticket needs something, which nobody asked it for.
	const said = ticketTrunkNotice( { ticketId: TICKET, behind: true } );
	await expect.poll( () => page.evaluate( () => window.__e2eSpoken ) ).toContain( `${ said.title } ${ said.body }` );

	await page.getByRole( 'button', { name: BUTTON, exact: true } ).click();

	// INVARIANT — the ticket is current now, and says nothing more about it.
	await expect( page.getByText( NOTICE ) ).toHaveCount( 0, { timeout: 60_000 } );
	await expect( page.getByRole( 'alert' ) ).toHaveCount( 0 );

	// INVARIANT — the work survived, trunk's change arrived, the substrate
	// was never touched, and the ticket is still the one checked out.
	expect( read( site.dir, LOGIN ) ).toBe( MY_LOGIN );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // trunk moved this\n' );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );
	expect( currentBranch( site.dir ) ).toBe( `ticket/${ TICKET }` );

	// CHARACTERISATION — the registry holds the new base.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.branches[ `ticket/${ TICKET }` ].baseOid ).toBe( newTip );
} );

test( 'a move that would overlap trunk\'s changes is refused by name, and nothing moves', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	await session.start( site.settings );
	const { page } = session;
	await makeTicketBehindTrunk( session, site, { 'src/wp-login.php': '<?php // trunk rewrote the same line\n' } );
	const baseBefore = session.readSettings().siteMeta[ site.dir ].branches[ `ticket/${ TICKET }` ].baseOid;

	await page.getByRole( 'button', { name: BUTTON, exact: true } ).click();

	// INVARIANT — refused with the file, the notice still there, the work as
	// it was, and the base where it was.
	await expect( page.getByText( 'Trunk changed the same lines as your work in: src/wp-login.php', { exact: false } ) ).toBeVisible( { timeout: 60_000 } );
	await expect( page.getByText( NOTICE ) ).toBeVisible();
	expect( read( site.dir, LOGIN ) ).toBe( MY_LOGIN );
	expect( session.readSettings().siteMeta[ site.dir ].branches[ `ticket/${ TICKET }` ].baseOid ).toBe( baseBefore );
} );
