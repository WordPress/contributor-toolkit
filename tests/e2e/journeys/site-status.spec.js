/**
 * What the sites list says about a site follows the site's status (#94, #554).
 *
 * The list is drawn from what the window keeps for every site, which it read
 * once, from the store, as it opened. A site's status is read later and from
 * the checkout itself, and it is the one that is right: the store's copy of a
 * trunk's date is whatever was true the last time anyone looked. So each
 * site's view reports what its status found to the window, and the list is
 * redrawn from that. Nothing else carries the answer across: the main process
 * writes the same date to the store, which the window reads again only when
 * a site is created or deleted.
 *
 * The checkout is real, made a moment ago, so its trunk is recent, and the
 * store is seeded to say otherwise.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const DAY = 24 * 60 * 60 * 1000;

test( 'a site the store calls old loses that mark in the sites list once its status has read the checkout', async ( { session } ) => {
	const site = await makeSite( session, { label: 'status-site' } );
	site.settings.siteMeta[ site.dir ].trunkDate = new Date( Date.now() - 30 * DAY ).toISOString();
	const { page } = await session.start( site.settings );
	await expect( ui.siteHeading( page, 'status-site' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the entry ends up with the name of a site that has nothing
	// to report. While the list still goes by the store's date, the entry's
	// name carries what its mark says, and `ui.sidebarEntry` does not find it.
	await expect( ui.sidebarEntry( page, 'status-site' ) ).toBeVisible();
	// CHARACTERISATION — and the store was put right too, by the main process.
	await expect.poll( () => {
		const stored = session.readSettings().siteMeta[ site.dir ].trunkDate;
		return Date.now() - new Date( stored ).getTime() < DAY;
	} ).toBe( true );
} );
