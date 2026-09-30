/**
 * Updating a site to the latest trunk, driven through the app (#385).
 *
 * The update crosses every layer at once: the main process fetches from the
 * site's own origin and resets the checkout, the renderer runs the install
 * and build steps and clears the marker that says the update is incomplete,
 * and the store keeps the new snapshot. Only a journey can say the whole
 * chain ends where the contributor expects it to.
 *
 * The origin is a clone of the site on disk, moved ahead by the test; nothing
 * here reaches the network. The lockfile is left alone so the install step is
 * the one the app names as skipped: an `npm install`, even of nothing, is not
 * what this journey is about.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, advanceOrigin, read, exists, currentBranch, SUBSTRATE, SUBSTRATE_CONTENT, LOGIN, TRUNK } = require( '../helpers/git-site.cjs' );

const NEWER_LOGIN = '<?php // newer trunk\n';

test( 'an update fetches from the site\'s origin, resets the checkout, rebuilds, and leaves the history whole', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const newTip = advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const { page } = await session.start( site.settings );
	await session.acceptConfirms();

	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();

	// INVARIANT — the chain ends with the app saying so, and with the summary
	// the guide describes: the install step was named as skipped.
	await expect( page.getByText( 'Updated to the latest trunk' ).first() ).toBeVisible( { timeout: 120_000 } );
	await expect( page.getByText( 'Dependencies unchanged', { exact: false } ).first() ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( 'Update incomplete', { exact: false } ) ).toHaveCount( 0 );

	// INVARIANT — the checkout is the origin's trunk now, still on trunk, and
	// the substrate survived the reset.
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	expect( currentBranch( site.dir ) ).toBe( TRUNK );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	// INVARIANT — the update fetched, it did not truncate: no shallow boundary,
	// and the commit the site started on is still behind the new tip.
	expect( exists( site.dir, path.join( '.git', 'shallow' ) ) ).toBe( false );
	expect( fs.readFileSync( path.join( site.dir, '.git', 'FETCH_HEAD' ), 'utf8' ) ).toContain( newTip );

	// CHARACTERISATION — the registry holds the new snapshot and no
	// incomplete-update marker.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.trunkOid ).toBe( newTip );
	expect( meta.updateIncomplete ).toBeFalsy();
} );

/**
 * The update run from a linked ticket, all the way back to trunk (#419).
 *
 * The journey above runs the same chain from trunk, where the flag that says
 * "the code is new but the built assets are old" is written and cleared in the
 * same place and nothing can disagree. From a ticket it is written after the
 * park, while the app is on trunk, and cleared after the return, while it is on
 * the ticket — two scopes, and the bug was that only one of them was ever
 * cleared. Nothing below trunk's own level can see it: the layer-3 test proves
 * the handlers write where they should, and this proves the contributor is not
 * looking at a red banner after a build that succeeded.
 *
 * The step that reveals it is the last one. Everything is quiet until Unlink
 * puts the site back on trunk, which is where the stale flag is read from.
 *
 * The tree is left clean deliberately: an uncommitted edit sends Update to
 * latest trunk through the dirty-tree modal, which discards before it updates
 * and is a different flow with its own coverage. Parking a clean ticket still
 * moves the checkout both ways, which is all this needs.
 */
test( 'an update run from a linked ticket leaves no incomplete marker behind on trunk', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const newTip = advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const { page } = await session.start( site.settings );
	await session.acceptConfirms();

	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.linkTicket( page, '60002' );
	expect( currentBranch( site.dir ) ).toBe( 'ticket/60002' );

	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();

	// INVARIANT — the chain ends where it does from trunk, and it ends with the
	// contributor back on their ticket rather than stranded on trunk.
	await expect( page.getByText( 'Updated to the latest trunk' ).first() ).toBeVisible( { timeout: 120_000 } );
	await expect( page.getByText( 'Update incomplete', { exact: false } ) ).toHaveCount( 0 );
	expect( currentBranch( site.dir ) ).toBe( 'ticket/60002' );
	// And the ticket is still measured from where it started: the update moved
	// trunk, it did not silently carry the branch forward. `branches:rebase` is
	// what does that, when the contributor asks for it.
	expect( read( site.dir, LOGIN ) ).not.toBe( NEWER_LOGIN );

	await ui.unlinkButton( page ).click();
	await expect( ui.ticketField( page ).first() ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — #419 itself. The build ran and succeeded minutes ago; trunk
	// must not be offering to retry it.
	expect( currentBranch( site.dir ) ).toBe( TRUNK );
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	await expect( page.getByText( 'Update incomplete', { exact: false } ) ).toHaveCount( 0 );
	await expect( ui.retryInstallButton( page ) ).toHaveCount( 0 );

	// CHARACTERISATION — the store's side of the same thing: the snapshot moved,
	// and neither scope is left claiming the site is mid-update.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.trunkOid ).toBe( newTip );
	expect( meta.updateIncomplete ).toBeFalsy();
	expect( meta.branches[ 'ticket/60002' ].updateIncomplete ).toBeFalsy();
} );
