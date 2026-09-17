/**
 * A Gutenberg site, seen through the app (#251).
 *
 * The same page as a Core site, told apart by a tag and by what it works on:
 * a GitHub issue where Core has a Trac ticket, on a branch under issue/, with
 * no patch-file picker, no Trac attachments and no "Attach to Trac", and a
 * Trac ticket that arrives from a link turned away rather than linked. The
 * decisions live in the registry, the work-item provider and the notice
 * module; this is the one place that says the page follows them.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const { makeSite, branches, addPullRequestToOrigin, currentBranch, read, LOGIN } = require( '../helpers/git-site.cjs' );

const PR = 7;
const PR_CONTENT = '<?php // pull request 7\n';

test( 'a Gutenberg site is tagged, works on a GitHub issue under issue/, and turns a ticket link away', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	site.settings.siteMeta[ site.dir ].projectType = 'gutenberg';
	addPullRequestToOrigin( site.origin, PR, { [ LOGIN ]: PR_CONTENT } );
	const { app, page } = await session.start( site.settings );
	// Trac stands in for itself: if anything on this site asks for the ticket
	// with the issue's number, the stub answers with a Core ticket's facts and
	// records the call, so the check below can fail by name.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'trac:list-attachments' );
		ipcMain.handle( 'trac:list-attachments', () => {
			global.__tracScrapes = ( global.__tracScrapes || 0 ) + 1;
			return { ok: true, status: 'ok', items: [], ticket: { summary: 'A CORE TICKET WITH THE SAME NUMBER', keywords: [] } };
		} );
	} );

	// INVARIANT — the row and the header say which kind of site this is.
	await expect( page.getByText( 'Gutenberg', { exact: true } ).first() ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the work-item card asks for a GitHub issue, and nothing on
	// the page asks for a Trac ticket or a patch file.
	await expect( page.getByText( 'GitHub issue', { exact: true } ).first() ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'Not sure yet? Browse good first issues on GitHub' } ) ).toBeVisible();
	await expect( page.getByText( 'Check out a pull request', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( 'Trac ticket', { exact: true } ) ).toHaveCount( 0 );
	await expect( page.getByLabel( 'Trac ticket number or URL' ) ).toHaveCount( 0 );
	await expect( page.getByRole( 'button', { name: 'or choose a .diff / .patch file…' } ) ).toHaveCount( 0 );

	// INVARIANT — a pull-request URL pasted where the issue goes is refused by
	// name, before anything is written.
	const field = page.getByLabel( 'GitHub issue number or URL' );
	await field.fill( 'https://github.com/WordPress/gutenberg/pull/4496' );
	await page.getByRole( 'button', { name: 'Link issue', exact: true } ).click();
	await expect( page.getByRole( 'alert' ).filter( { hasText: 'That is a pull request' } ) ).toBeVisible();
	expect( branches( site.dir ) ).toEqual( [ 'trunk' ] );

	// INVARIANT — linking an issue by URL names it on the card and gives it a
	// branch under issue/, the noun its upstream uses; the Trac-only pieces
	// stay off the linked card too.
	await field.fill( 'https://github.com/WordPress/gutenberg/issues/71234#issuecomment-1' );
	await page.getByRole( 'button', { name: 'Link issue', exact: true } ).click();
	await expect( page.getByText( 'Working on issue #71234', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByRole( 'button', { name: 'Open on GitHub', exact: true } ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'Read details from Trac' } ) ).toHaveCount( 0 );
	await expect( page.getByText( 'Trac attachments', { exact: true } ) ).toHaveCount( 0 );
	await expect( page.getByText( 'Attach to Trac', { exact: true } ) ).toHaveCount( 0 );
	expect( branches( site.dir ) ).toContain( 'issue/71234' );
	expect( branches( site.dir ) ).not.toContain( 'ticket/71234' );

	// INVARIANT — linking an issue by hand does not read the Core ticket that
	// shares its number: no Trac window, and nothing of that ticket on the
	// card (#251). On a Core site the same link would open Trac (#292).
	await expect( page.getByText( 'No pull requests cite this issue yet.' ) ).toBeVisible( { timeout: 30_000 } );
	expect( await app.evaluate( () => global.__tracScrapes || 0 ) ).toBe( 0 );
	await expect( page.getByText( 'A CORE TICKET WITH THE SAME NUMBER' ) ).toHaveCount( 0 );
	await expect( page.getByText( /file attachment, not a pull request/ ) ).toHaveCount( 0 );

	// INVARIANT — a pull request is checked out from the site's own
	// repository: a wordpress-develop URL is refused by name, a
	// WordPress/gutenberg one is fetched. While it is applied the card says so
	// and offers the way back, and the way back is the issue's branch.
	const prField = page.getByLabel( 'Pull request URL or number' );
	await prField.fill( `https://github.com/WordPress/wordpress-develop/pull/${ PR }` );
	await page.getByRole( 'button', { name: 'Apply PR', exact: true } ).last().click();
	await expect( page.getByRole( 'alert' ).filter( { hasText: 'Only WordPress/gutenberg pull requests' } ) ).toBeVisible();
	await prField.fill( `https://github.com/WordPress/gutenberg/pull/${ PR }` );
	await page.getByRole( 'button', { name: 'Apply PR', exact: true } ).last().click();
	await expect( page.getByText( `PR #${ PR } changes 1 file.`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await page.getByRole( 'button', { name: 'Apply and rebuild', exact: true } ).click();
	await expect.poll( () => currentBranch( site.dir ), { timeout: 60_000 } ).toBe( `pr/${ PR }` );
	await expect( page.getByText( `PR #${ PR } is applied.`, { exact: true } ) ).toBeVisible( { timeout: 60_000 } );
	await expect( page.getByText( 'Your issue changes are saved separately and return when you revert this PR.' ) ).toBeVisible();
	expect( read( site.dir, LOGIN ) ).toBe( PR_CONTENT );

	await page.getByRole( 'button', { name: 'Revert this PR', exact: true } ).click();
	await expect.poll( () => currentBranch( site.dir ), { timeout: 60_000 } ).toBe( 'issue/71234' );
	await expect( page.getByText( 'Working on issue #71234', { exact: true } ) ).toBeVisible();
	await expect( page.getByText( `PR #${ PR } is applied.`, { exact: true } ) ).toHaveCount( 0 );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // trunk\n' );

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
