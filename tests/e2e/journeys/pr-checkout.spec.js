/**
 * Trying a pull request as its own checkout, driven through the app (#458).
 *
 * The boundary this journey protects is ownership. Ticket work must leave the
 * worktree before the pull request arrives, and edits made while trying the PR
 * must stay with its local PR branch when the contributor goes back.
 */

const { gitOk } = require( '../../unit/helpers/git.cjs' );
const { test, expect } = require( '../helpers/app.cjs' );
const {
	makeSite,
	addPullRequestToOrigin,
	read,
	write,
	currentBranch,
	SUBSTRATE,
	SUBSTRATE_CONTENT,
	LOGIN,
	DOOMED,
} = require( '../helpers/git-site.cjs' );

const TICKET = '60001';
const PR = 7;
const TICKET_EDIT = '<?php // my ticket work\n';
const PR_CONTENT = '<?php // pull request 7\n';
const PR_EDIT = '<?php // my experiment on pull request 7\n';

async function linkTicket( page ) {
	await page.getByLabel( 'Trac ticket number or URL' ).first().fill( TICKET );
	await page.getByRole( 'button', { name: 'Link ticket', exact: true } ).first().click();
	await expect( page.getByText( `#${ TICKET }`, { exact: true } ).first() ).toBeVisible( { timeout: 30_000 } );
}

test( 'a PR checkout keeps ticket work and later PR edits on their own branches', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const prHead = addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { page } = await session.start( site.settings );
	await linkTicket( page );

	write( site.dir, DOOMED, TICKET_EDIT );
	await page.getByLabel( 'Pull request URL or number' ).fill( String( PR ) );
	await page.getByRole( 'button', { name: 'Apply PR', exact: true } ).click();

	await expect( page.getByText( `PR #${ PR } changes 1 file.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible();
	await page.getByRole( 'button', { name: 'Check out and rebuild', exact: true } ).click();

	await expect
		.poll( () => currentBranch( site.dir ), { timeout: 60_000 } )
		.toBe( `pr/${ PR }` );
	await expect( page.getByText( `PR #${ PR } is checked out.`, { exact: true } ) ).toBeVisible( { timeout: 60_000 } );
	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	write( site.dir, LOGIN, PR_EDIT );
	await page.getByRole( 'button', { name: `Back to ticket #${ TICKET }`, exact: true } ).click();

	await expect
		.poll( () => currentBranch( site.dir ), { timeout: 60_000 } )
		.toBe( `ticket/${ TICKET }` );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // trunk\n' );
	expect( read( site.dir, DOOMED ) ).toBe( TICKET_EDIT );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.currentBranch ).toBe( `ticket/${ TICKET }` );
	expect( meta.branches[ `ticket/${ TICKET }` ].appliedPatch ).toBeFalsy();
	expect( meta.branches[ `pr/${ PR }` ].headOid ).toBe( prHead );
	expect( gitOk( [ 'rev-parse', `pr/${ PR }` ], site.dir ) ).not.toBe( prHead );

	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: '<?php // pull request 7 moved\n' }, 'PR #7 moves' );
	await page.getByLabel( 'Pull request URL or number' ).fill( String( PR ) );
	await page.getByRole( 'button', { name: 'Apply PR', exact: true } ).click();
	await expect( page.getByText( `PR #${ PR } has moved on GitHub, but your copy has edits on top.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await page.getByRole( 'button', { name: 'Return to saved copy', exact: true } ).click();
	await expect.poll( () => currentBranch( site.dir ), { timeout: 60_000 } ).toBe( `pr/${ PR }` );
	expect( read( site.dir, LOGIN ) ).toBe( PR_EDIT );
} );

test( 'discarding loose trunk edits continues into the requested PR checkout', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { page } = await session.start( site.settings );
	const confirmsAnswered = await session.acceptConfirms();
	write( site.dir, DOOMED, TICKET_EDIT );

	await page.getByLabel( 'Pull request URL or number' ).fill( String( PR ) );
	await page.getByRole( 'button', { name: 'Apply PR', exact: true } ).click();
	await expect( page.getByText( `PR #${ PR } changes 1 file.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await page.getByRole( 'button', { name: 'Check out and rebuild', exact: true } ).click();

	const discard = page.getByRole( 'button', { name: `Discard them and check out PR #${ PR }`, exact: true } );
	await expect( discard ).toBeVisible( { timeout: 30_000 } );
	await discard.click();
	await expect
		.poll( () => currentBranch( site.dir ), { timeout: 60_000 } )
		.toBe( `pr/${ PR }` );

	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	expect( await confirmsAnswered() ).toBe( 1 );
} );
