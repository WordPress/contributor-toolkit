/**
 * A Gutenberg site, seen through the app (#251).
 *
 * The same page as a Core site, told apart by a tag and by what it leaves
 * out: no Trac ticket card, no patch-file picker, and a ticket that arrives
 * from a link is turned away rather than linked. The decisions live in the
 * registry and the notice module; this is the one place that says the page
 * follows them.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const { makeSite, branches } = require( '../helpers/git-site.cjs' );

test( 'a Gutenberg site is tagged, shows no Trac-shaped cards, and turns a ticket link away', async ( { session } ) => {
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	const { app, page } = await session.start( site.settings );

	// INVARIANT — the row and the header say which kind of site this is.
	await expect( page.getByText( 'Gutenberg', { exact: true } ).first() ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — nothing on the page asks for a Trac ticket or a patch file.
	await expect( page.getByText( 'Check out a pull request', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( 'Trac ticket', { exact: true } ) ).toHaveCount( 0 );
	await expect( page.getByLabel( 'Trac ticket number or URL' ) ).toHaveCount( 0 );
	await expect( page.getByRole( 'button', { name: 'or choose a .diff / .patch file…' } ) ).toHaveCount( 0 );

	// INVARIANT — a ticket from a link is refused by name, with nothing to
	// confirm, and no ticket branch appears.
	await app.evaluate( ( { app: electronApp }, url ) => {
		electronApp.emit( 'open-url', { preventDefault() {} }, url );
	}, 'wpct://ticket/62281' );
	await expect( page.getByText( 'Ticket #62281 cannot be linked to' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByRole( 'button', { name: 'Link ticket', exact: true } ) ).toHaveCount( 0 );
	expect( branches( site.dir ) ).not.toContain( 'ticket/62281' );

	// CHARACTERISATION — hiding the note is this site's business; the ticket
	// is not consumed by it.
	await page.getByRole( 'button', { name: 'Hide', exact: true } ).click();
	await expect( page.getByText( 'Ticket #62281 cannot be linked to' ) ).toHaveCount( 0 );
} );
