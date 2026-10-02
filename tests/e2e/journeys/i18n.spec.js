/**
 * The app in the pseudo-locale: every string that goes through `__()` comes out
 * accented and bracketed, so a string that did not is the one still in plain
 * English.
 *
 * Launched with `--lang=en-XA`, Chromium's pseudo-locale. Each screen below is
 * scanned for visible text and labels that are not bracketed; one that turns
 * up is a string nobody wrapped, and the failure names it. A screen joins this
 * file when its strings are wrapped.
 *
 * The English journeys keep asserting English text, which is the other half:
 * wrapping a string must not change what an English speaker sees.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const { pseudoLocalize } = require( '../../../src/renderer/pseudo-locale.cjs' );

// Names that stay as they are in every language.
const UNTRANSLATED = new Set( [ 'WordPress Core', 'Gutenberg' ] );

/**
 * Every visible text node, aria-label and placeholder inside `root` that is not
 * in the pseudo-locale.
 *
 * @param {Object} locator The region to scan.
 * @return {Promise<string[]>} The unwrapped strings.
 */
async function unwrapped( locator ) {
	const found = await locator.evaluate( ( root ) => {
		const visible = ( el ) => el && el.getClientRects().length > 0 && window.getComputedStyle( el ).visibility !== 'hidden';
		const texts = [];
		const walker = document.createTreeWalker( root, window.NodeFilter.SHOW_TEXT );
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			if ( visible( node.parentElement ) ) texts.push( node.textContent.trim() );
		}
		for ( const el of root.querySelectorAll( '[aria-label], [placeholder]' ) ) {
			if ( ! visible( el ) ) continue;
			for ( const attr of [ 'aria-label', 'placeholder' ] ) {
				if ( el.hasAttribute( attr ) ) texts.push( el.getAttribute( attr ).trim() );
			}
		}
		return texts;
	} );
	return found.filter( ( text ) => text && ! /^\[[\s\S]*\]$/.test( text ) && ! UNTRANSLATED.has( text ) );
}

test( 'the first-run screen and the create-site dialog are fully translatable', async ( { session } ) => {
	const { page } = await session.start( undefined, { lang: 'en-XA' } );

	const createButton = page.getByRole( 'button', { name: pseudoLocalize( 'Create site' ), exact: true } );
	await expect( createButton ).toBeVisible( { timeout: 30_000 } );
	await expect( page.locator( 'html' ) ).toHaveAttribute( 'lang', 'en-XA' );
	await expect( page ).toHaveTitle( pseudoLocalize( 'WordPress Contributor Toolkit' ) );

	// The window with no site in it, and its footer.
	expect( await unwrapped( page.locator( '#root' ) ) ).toEqual( [] );

	// The feedback popover.
	await page.getByRole( 'button', { name: pseudoLocalize( 'Give feedback' ), exact: true } ).click();
	const feedback = page.locator( '.components-popover' );
	await expect( feedback ).toBeVisible();
	expect( await unwrapped( feedback ) ).toEqual( [] );
	await page.keyboard.press( 'Escape' );

	// The create-site dialog, including the parts @wordpress/components draws
	// itself, such as its Close button.
	await createButton.click();
	const dialog = page.getByRole( 'dialog', { name: pseudoLocalize( 'Create a site' ) } );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByRole( 'button', { name: /^\[/ } ).first() ).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );

	// A validation error is wrapped too.
	await dialog.getByRole( 'button', { name: pseudoLocalize( 'Create site' ), exact: true } ).click();
	await expect( dialog.getByText( pseudoLocalize( 'Please provide a site name.' ), { exact: true } ) ).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );
} );

test( 'the sites list and the button that hides it are fully translatable', async ( { session } ) => {
	// One Gutenberg site whose update was left unfinished: its entry carries
	// the words of its dot, and the line under its name is a product's name,
	// which stays as it is. The site's own name is the contributor's and is
	// left out of the scan.
	const LABEL = 'my-site';
	const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );
	fs.mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
	const { page } = await session.start( {
		sites: [ dir ],
		siteMeta: { [ dir ]: { initialized: true, createdAt: new Date().toISOString(), label: LABEL, projectType: 'gutenberg', updateIncomplete: true, skipInitWizard: true } },
		preferences: {},
	}, { lang: 'en-XA' } );

	const list = page.getByRole( 'region', { name: pseudoLocalize( 'My sites' ), exact: true } );
	await expect( list ).toBeVisible( { timeout: 30_000 } );
	await expect( list.getByText( pseudoLocalize( 'Update incomplete — code is new, built assets are old' ), { exact: false } ) ).toHaveCount( 1 );
	expect( ( await unwrapped( list ) ).filter( ( text ) => text !== LABEL ) ).toEqual( [] );

	// The button is in the page's header, outside the list, and has its name
	// in both states.
	await page.getByRole( 'button', { name: pseudoLocalize( 'Hide sites list' ), exact: true } ).click();
	await expect( page.getByRole( 'button', { name: pseudoLocalize( 'Show sites list' ), exact: true } ) ).toBeVisible();
} );

test( 'the open site\'s details and its menu are fully translatable', async ( { session } ) => {
	// One site with an old trunk, so the details say its age. Its path and
	// its two dates are the machine's, and are left out of the scan.
	const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );
	fs.mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
	const created = new Date( Date.now() - 40 * 24 * 60 * 60 * 1000 );
	const { app, page } = await session.start( {
		sites: [ dir ],
		siteMeta: { [ dir ]: { initialized: true, createdAt: created.toISOString(), label: 'my-site', projectType: 'gutenberg', trunkDate: created.toISOString(), skipInitWizard: true } },
		preferences: {},
	}, { lang: 'en-XA' } );
	// No application is looked for, so the menu is the same on every machine.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'editor:list' );
		ipcMain.handle( 'editor:list', () => ( { detected: [ { name: 'Example Editor', path: '/example' } ] } ) );
	} );

	const details = page.getByRole( 'complementary' ).filter( { visible: true } );
	await expect( details.getByRole( 'heading', { name: pseudoLocalize( 'Details' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	// What is the machine's: the folder, and two dates, written the way the
	// app's own locale writes them, which is found here by the year in them.
	const year = String( created.getFullYear() );
	expect( ( await unwrapped( details ) ).filter( ( text ) => text !== dir && ! text.includes( year ) ) ).toEqual( [] );

	await page.getByRole( 'button', { name: pseudoLocalize( 'Site actions' ), exact: true } ).click();
	const menu = page.getByRole( 'menu', { name: pseudoLocalize( 'Site actions' ) } );
	await expect( menu.getByRole( 'menuitem', { name: pseudoLocalize( 'Rename…' ), exact: true } ) ).toBeVisible();
	await expect( menu.getByRole( 'menuitem' ) ).toHaveCount( 6 );
	expect( await unwrapped( menu ) ).toEqual( [] );

	// The applications, under "Open in". Scanned once the one application
	// has arrived, so that the list scanned is the whole list. Its name is its
	// own and is left as it is; the row beside it is the app's.
	// Rested on, as a pointer does, and not clicked: see site-header.spec.js.
	await menu.getByRole( 'menuitem', { name: pseudoLocalize( 'Open in' ), exact: true } ).hover();
	const application = page.getByRole( 'menuitem', { name: 'Example Editor', exact: true } );
	await expect( application ).toBeVisible();
	const applications = page.getByRole( 'menu' ).filter( { has: application } ).last();
	await expect( applications.getByRole( 'menuitem', { name: pseudoLocalize( 'Other application…' ), exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( applications ) ).filter( ( text ) => text !== 'Example Editor' ) ).toEqual( [] );
	await page.keyboard.press( 'Escape' );
	await page.keyboard.press( 'Escape' );
	await expect( page.getByRole( 'button', { name: pseudoLocalize( 'Hide details' ), exact: true } ) ).toBeVisible();
} );
