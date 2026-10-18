/**
 * What the site's page says above its cards (#557): the checklist a new site
 * is set up by, and the notices about the site as a whole.
 *
 * What each of them does is other journeys': the update of trunk is
 * trunk-update.spec.js's, a site the old engine made is legacy-site.spec.js's,
 * a merge left half done is merge-in-progress.spec.js's. This file is about
 * what is on the page: that the checklist is a list of steps, each with how
 * it stands and its button, and that a notice carries what can be done about
 * it and goes when it is dealt with.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const DAY = 24 * 60 * 60 * 1000;

test( 'a site still being set up shows the checklist: its steps in order, how each stands, the button for the next one, and a way out', async ( { session } ) => {
	// A site that is installed and built but has not been through the
	// checklist: three steps done, the last one to do.
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].skipInitWizard = false;
	const { page } = await session.start( site.settings );

	// INVARIANT — the checklist is a region of the page with a list in it,
	// one item a step, in the order they are done in.
	const checklist = page.getByRole( 'region', { name: 'Initial setup checklist', exact: true } );
	await expect( checklist ).toBeVisible( { timeout: 30_000 } );
	await expect( checklist.getByRole( 'heading', { level: 2, name: 'Initial setup checklist', exact: true } ) ).toBeVisible();
	const steps = checklist.getByRole( 'listitem' );
	await expect( steps ).toHaveCount( 4 );
	await expect( steps.nth( 1 ) ).toContainText( 'Install npm dependencies' );
	await expect( steps.nth( 2 ) ).toContainText( 'Run full build' );
	await expect( steps.nth( 3 ) ).toContainText( 'Start dev server & finish wizard' );

	// INVARIANT — each step says how it stands: the three that are done, and
	// the one that is next.
	for ( const done of [ 0, 1, 2 ] ) {
		await expect( steps.nth( done ).getByText( 'Completed', { exact: true } ) ).toBeVisible();
	}
	await expect( steps.nth( 3 ).getByText( 'Ready', { exact: true } ) ).toBeVisible();
	await expect( checklist.getByText( 'Completed', { exact: true } ) ).toHaveCount( 3 );

	// INVARIANT — the next step has the button that does it, and the ticket
	// card is not offered while the site is not ready for one.
	await expect( steps.nth( 3 ).getByRole( 'button', { name: 'Start dev server and finish the wizard', exact: true } ) ).toBeEnabled();
	await expect( ui.workItemHeading( page, 'Trac ticket' ) ).toHaveCount( 0 );

	// INVARIANT — the way out leaves the checklist for the site's own page,
	// for good.
	await checklist.getByRole( 'button', { name: 'Skip initialization wizard', exact: true } ).click();
	await expect( checklist ).toHaveCount( 0 );
	await expect( ui.workItemHeading( page, 'Trac ticket' ) ).toBeVisible();
	// CHARACTERISATION — which the store remembers.
	await page.evaluate( () => window.api.getSitesWithMeta() );
	expect( session.readSettings().siteMeta[ site.dir ].skipInitWizard ).toBe( true );
} );

test( 'a site whose code is old says so, why it matters, and has the way to update it beside what it says', async ( { session } ) => {
	// A site the app only knows from its list: with no repository to read
	// the date from, it keeps the one it was told, which is forty days old.
	const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );
	fs.mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
	const then = new Date( Date.now() - ( 40 * DAY ) ).toISOString();
	const { page } = await session.start( {
		sites: [ dir ],
		siteMeta: { [ dir ]: { initialized: true, createdAt: then, label: 'old-trunk', trunkDate: then, skipInitWizard: true } },
		preferences: {},
	} );

	// INVARIANT — the page says how old the code is and why that matters.
	const old = page.getByText( 'This site\'s WordPress code is 40 days old', { exact: true } );
	await expect( old ).toBeVisible( { timeout: 30_000 } );
	const notice = old.locator( '..' );
	await expect( notice.getByText( 'Patches you create now may not apply on Trac. Updating takes a few minutes.', { exact: true } ) ).toBeVisible();

	// INVARIANT — and the button that updates it is the notice's own, beside
	// what it says, and can be pressed.
	await expect( notice.getByRole( 'button', { name: 'Update to latest trunk', exact: true } ) ).toBeEnabled();

	// INVARIANT — it is what the page points at as the next thing to do: the
	// notice carries the mark the cue looks for, and is ringed.
	await expect( notice ).toHaveAttribute( 'data-next-action', 'update-trunk' );
	await expect( notice ).toHaveClass( /(^| )next-action-cue( |$)/ );

	// INVARIANT — and the ring can be seen against the notice, and is not
	// keyboard focus: it is drawn, not in the colour of the border a warning
	// notice already has, which is what it was drawn in when it could not be
	// told from that border, and not in the focus ring's colour, which is
	// what it was drawn in next, when it looked like focus.
	const ring = await notice.evaluate( ( el ) => {
		const style = window.getComputedStyle( el );
		return { style: style.outlineStyle, width: parseFloat( style.outlineWidth ), color: style.outlineColor, border: style.borderTopColor };
	} );
	expect( ring.style ).toBe( 'solid' );
	expect( ring.width ).toBeGreaterThan( 0 );
	expect( ring.color ).not.toBe( ring.border );
	expect( ring.color ).not.toBe( await ui.tokenColour( page, 'var(--wpds-color-stroke-focus)' ) );
} );
