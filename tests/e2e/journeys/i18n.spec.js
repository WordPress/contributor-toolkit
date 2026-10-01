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
