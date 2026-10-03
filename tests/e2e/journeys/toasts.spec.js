/**
 * The window's confirmations (#253, #557): the notices in its corner that say
 * an action worked, or that one the contributor is no longer looking at did
 * not.
 *
 * What each action says is its own journey's. This file is about the stack:
 * that a confirmation is shown and said, once; that one for something that
 * worked goes by itself and one for something that did not stays; and that
 * either can be dismissed.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );
const { deleteFailureMessage, TOAST_LIFETIME_MS } = require( '../../../src/renderer/confirmations.cjs' );

// Less time than a confirmation lasts, for what must not be answered by a
// confirmation running out.
const QUICKLY = 2_000;

/**
 * Records what is said to a screen reader from here on, with how it is said,
 * as ticket-rebase.spec.js records it.
 *
 * @param {Object} page
 * @return {Promise<Function>} Reads back what was said: `'polite: …'` or `'assertive: …'` each.
 */
async function listen( page ) {
	await page.evaluate( () => {
		window.__e2eSpoken = [];
		new window.MutationObserver( ( records ) => {
			for ( const record of records ) {
				const within = record.target.nodeType === 1 ? record.target : record.target.parentElement;
				const region = within && within.closest( '[aria-live]' );
				if ( ! region ) continue;
				for ( const node of record.addedNodes ) {
					const text = node.textContent.trim();
					if ( text ) window.__e2eSpoken.push( `${ region.getAttribute( 'aria-live' ) }: ${ text }` );
				}
			}
		} ).observe( document.body, { subtree: true, childList: true } );
	} );
	return () => page.evaluate( () => window.__e2eSpoken );
}

test( 'a confirmation is shown in the corner and said once, goes by itself when its time is up, and can be dismissed before', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	// The page's clock can be moved by the test from here on, so that a
	// confirmation's time can pass without being waited for. It still runs
	// by itself as well, so what must not be the passing of time's doing is
	// asked with less time to wait than a confirmation lasts.
	await page.clock.install();
	const spoken = await listen( page );
	const copyPath = async () => {
		await ui.siteMenuButton( page ).click();
		await page.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	};
	const copied = ui.toast( page, 'Copied the path' );
	const stack = page.getByRole( 'region', { name: 'Notifications', exact: true } );

	// INVARIANT — what worked is said in the window's corner, in a region a
	// screen reader can go to, and to the ear politely, once.
	await copyPath();
	await expect( copied ).toBeVisible();
	await expect( stack.getByText( 'Copied the path', { exact: true } ) ).toBeVisible();
	await expect.poll( spoken ).toContain( 'polite: Copied the path' );

	// INVARIANT — it stays for as long as it takes to read. Half its time
	// on it is there: asked straight after it appeared, so that the time a
	// slow machine takes over the steps in between is not counted with it.
	await page.clock.fastForward( TOAST_LIFETIME_MS / 2 );
	await expect( copied ).toBeVisible();

	// INVARIANT — the same thing done again while it is still said is not
	// shown twice, nor said twice. A second one would be both as it
	// appeared, so both are read at once, after a round trip.
	await copyPath();
	await page.evaluate( () => window.api.getSitesWithMeta() );
	expect( await copied.count() ).toBe( 1 );
	expect( ( await spoken() ).filter( ( said ) => said.endsWith( 'Copied the path' ) ) ).toHaveLength( 1 );

	// INVARIANT — and then it goes by itself.
	await page.clock.fastForward( TOAST_LIFETIME_MS );
	await expect( copied ).toHaveCount( 0, { timeout: QUICKLY } );

	// INVARIANT — and it can be dismissed before that, by its own button,
	// which goes with it: the focus is left on the stack, and not at the top
	// of the document.
	await copyPath();
	await expect( copied ).toBeVisible();
	await stack.getByRole( 'button', { name: 'Dismiss', exact: true } ).click();
	await expect( copied ).toHaveCount( 0, { timeout: QUICKLY } );
	await expect( stack ).toBeFocused();
} );

test( 'what did not work is said at once, and stays until it is dismissed', async ( { session } ) => {
	const site = await makeSite( session, { label: 'kept-site' } );
	const { app, page } = await session.start( site.settings );
	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	// A deletion the system refuses, which is what the app says in a
	// confirmation of this kind today.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'sites:delete' );
		ipcMain.handle( 'sites:delete', ( _event, sitePath ) => ( { ok: false, reason: 'remove-failed', path: sitePath, code: 'EBUSY' } ) );
	} );
	await page.clock.install();
	const spoken = await listen( page );
	const failure = deleteFailureMessage( { ok: false, reason: 'remove-failed', path: site.dir, code: 'EBUSY' } );
	const said = ui.toast( page, failure );

	await ui.siteMenuButton( page ).click();
	await ui.deleteSiteMenuItem( page ).click();
	await ui.confirmYesButton( page, 'Delete site' ).click();

	// INVARIANT — it is shown, and said to the ear at once, not when the
	// screen reader has finished what it was saying.
	await expect( said ).toBeVisible();
	await expect.poll( spoken ).toContain( `assertive: ${ failure }` );

	// INVARIANT — it does not go by itself: a minute later it is still
	// there, to be read by whoever looked away.
	await page.clock.fastForward( 60_000 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( said ).toBeVisible();

	// INVARIANT — a confirmation of something that worked joins it, nearer
	// the corner, and goes by itself without taking it along.
	await ui.siteMenuButton( page ).click();
	await page.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	const copied = ui.toast( page, 'Copied the path' );
	await expect( copied ).toBeVisible();
	expect( await ui.inDocumentOrder( page, [ said, copied ] ) ).toBe( true );

	// INVARIANT — what a notice's button is called, when the pointer rests
	// on it, is over the notice above it and not under it: what is topmost
	// where the tooltip is drawn is the tooltip, at each of its corners.
	// Its middle would not say: it falls in the gap between two notices.
	await ui.toasts( page ).getByRole( 'button', { name: 'Dismiss', exact: true } ).last().hover();
	const tooltip = page.getByText( 'Dismiss', { exact: true } );
	await expect( tooltip ).toBeVisible();
	expect( await tooltip.evaluate( ( tip ) => {
		const box = tip.getBoundingClientRect();
		const corners = [ [ box.left + 1, box.top + 1 ], [ box.right - 1, box.top + 1 ], [ box.left + 1, box.bottom - 1 ], [ box.right - 1, box.bottom - 1 ] ];
		return corners.map( ( [ x, y ] ) => {
			const topmost = document.elementFromPoint( x, y );
			return topmost === tip || tip.contains( topmost ) || topmost.contains( tip );
		} );
	} ) ).toEqual( [ true, true, true, true ] );
	await page.mouse.move( 5, 5 );
	await page.clock.fastForward( TOAST_LIFETIME_MS + 1000 );
	await expect( copied ).toHaveCount( 0, { timeout: QUICKLY } );
	await expect( said ).toBeVisible();

	// INVARIANT — it goes when it is dismissed.
	await ui.toasts( page ).getByRole( 'button', { name: 'Dismiss', exact: true } ).click();
	await expect( said ).toHaveCount( 0 );
} );
