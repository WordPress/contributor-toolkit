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
const ui = require( '../helpers/ui.cjs' );
const { makeSite, makePatchFile, write, LOGIN } = require( '../helpers/git-site.cjs' );
const { gitOk } = require( '../../unit/helpers/git.cjs' );
const { pseudoLocalize } = require( '../../../src/renderer/pseudo-locale.cjs' );

// Names that stay as they are in every language.
const UNTRANSLATED = new Set( [ 'WordPress Core', 'Gutenberg' ] );
// So do the names of WordPress's constants, which the details list (#559).
const CONSTANT_NAMES = /^(WP_DEBUG|SCRIPT_DEBUG)( · (WP_DEBUG|SCRIPT_DEBUG))*$/;

/**
 * Every visible text node, aria-label and placeholder inside `root` that is not
 * in the pseudo-locale.
 *
 * A sentence with an element in it (`createInterpolateElement`: a link, or a
 * word in bold) is several text nodes, and only the whole is bracketed. So a
 * text node counts as translated when the element around it, past any bold,
 * italic or code, holds one bracketed string from its first character to its
 * last. "[Foo] bar [Baz]" is two strings with English between, and is not.
 *
 * @param {Object} locator The region to scan.
 * @return {Promise<string[]>} The unwrapped strings.
 */
async function unwrapped( locator ) {
	const found = await locator.evaluate( ( root ) => {
		const visible = ( el ) => el && el.getClientRects().length > 0 && window.getComputedStyle( el ).visibility !== 'hidden';
		const wholeBracketed = ( text ) => {
			if ( ! text.startsWith( '[' ) || ! text.endsWith( ']' ) ) return false;
			let depth = 0;
			for ( let i = 0; i < text.length; i++ ) {
				if ( text[ i ] === '[' ) depth++;
				else if ( text[ i ] === ']' && --depth === 0 ) return i === text.length - 1;
			}
			return false;
		};
		const sentence = ( el ) => {
			while ( el !== root && [ 'STRONG', 'EM', 'B', 'I', 'CODE' ].includes( el.tagName ) ) el = el.parentElement;
			return el;
		};
		const texts = [];
		const walker = document.createTreeWalker( root, window.NodeFilter.SHOW_TEXT );
		for ( let node = walker.nextNode(); node; node = walker.nextNode() ) {
			if ( ! visible( node.parentElement ) ) continue;
			if ( wholeBracketed( sentence( node.parentElement ).textContent.trim() ) ) continue;
			texts.push( node.textContent.trim() );
		}
		for ( const el of root.querySelectorAll( '[aria-label], [placeholder]' ) ) {
			if ( ! visible( el ) ) continue;
			for ( const attr of [ 'aria-label', 'placeholder' ] ) {
				if ( el.hasAttribute( attr ) ) texts.push( el.getAttribute( attr ).trim() );
			}
		}
		return texts;
	} );
	return found.filter( ( text ) => text && ! /^\[[\s\S]*\]$/.test( text ) && ! UNTRANSLATED.has( text ) && ! CONSTANT_NAMES.test( text ) );
}

test( 'the first-run screen and the create-site dialog are fully translatable', async ( { session } ) => {
	const { page } = await session.start( undefined, { lang: 'en-XA' } );

	const createButton = page.getByRole( 'button', { name: pseudoLocalize( 'Create site' ), exact: true } );
	await expect( createButton ).toBeVisible( { timeout: 30_000 } );
	await expect( page.locator( 'html' ) ).toHaveAttribute( 'lang', 'en-XA' );
	await expect( page ).toHaveTitle( pseudoLocalize( 'WordPress Contributor Toolkit' ) );
	// The line a screen reader says before each announcement, which
	// @wordpress/a11y writes before the locale arrives (#648). It is hidden
	// until something is announced, so the scans below never see it.
	await expect( page.locator( '#a11y-speak-intro-text' ) ).toHaveText( pseudoLocalize( 'Notifications' ) );

	// The window with no site in it, and its footer.
	expect( await unwrapped( page.locator( '#root' ) ) ).toEqual( [] );

	// The feedback popover.
	await page.getByRole( 'button', { name: pseudoLocalize( 'Give feedback' ), exact: true } ).click();
	const feedback = page.locator( '.components-popover' );
	await expect( feedback ).toBeVisible();
	expect( await unwrapped( feedback ) ).toEqual( [] );
	await page.keyboard.press( 'Escape' );

	// The create-site dialog, including the parts the design system draws
	// itself, such as its Close button.
	await createButton.click();
	const dialog = page.getByRole( 'dialog', { name: pseudoLocalize( 'Create site' ), exact: true } );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByRole( 'button', { name: /^\[/ } ).first() ).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );
	// The folder's button is the app's own, not a file input, whose button
	// and "No file chosen" Chromium draws in its own language, where the scan
	// cannot see them (#655).
	await expect( dialog.getByRole( 'button', { name: `${ pseudoLocalize( 'Location' ) } ${ pseudoLocalize( 'Choose folder…' ) }`, exact: true } ) ).toHaveText( pseudoLocalize( 'Choose folder…' ) );

	// A validation error is wrapped too.
	await dialog.getByRole( 'button', { name: pseudoLocalize( 'Create site' ), exact: true } ).click();
	await expect( dialog.getByText( pseudoLocalize( 'Please provide a site name.' ), { exact: true } ) ).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );
} );

test( 'the settings dialog is fully translatable, on both of its tabs', async ( { session } ) => {
	const { page } = await session.start( undefined, { lang: 'en-XA' } );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Settings' ), exact: true } ).click();
	const dialog = page.getByRole( 'dialog', { name: pseudoLocalize( 'Settings' ), exact: true } );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByText( pseudoLocalize( 'Not set: the create-site dialog asks each time.' ), { exact: true } ) ).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );
	await expect( dialog.getByRole( 'button', { name: `${ pseudoLocalize( 'New sites go here' ) } ${ pseudoLocalize( 'Choose folder…' ) }`, exact: true } ) ).toHaveText( pseudoLocalize( 'Choose folder…' ) );

	// The Sites tab, once it has the PHP versions: their numbers are not
	// words and stay as they are.
	await dialog.getByRole( 'tab', { name: pseudoLocalize( 'Sites' ), exact: true } ).click();
	await expect( dialog.getByRole( 'radio', { name: '8.3', exact: true } ) ).toBeChecked();
	expect( ( await unwrapped( dialog ) ).filter( ( text ) => ! /^\d+\.\d+$/.test( text ) ) ).toEqual( [] );

	// The Account tab, once it has read the GitHub account: the line about it
	// is main's answer put into words here.
	await dialog.getByRole( 'tab', { name: pseudoLocalize( 'Account' ), exact: true } ).click();
	// Which line depends on whether this build has a GitHub client id.
	await expect(
		dialog.getByText( pseudoLocalize( 'Sign-in is not set up in this build.' ), { exact: true } )
			.or( dialog.getByText( pseudoLocalize( 'Not signed in. The app asks you to sign in when you open a pull request.' ), { exact: true } ) )
	).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );

	// A refusal is wrapped too.
	await dialog.getByLabel( pseudoLocalize( 'WordPress.org username' ), { exact: true } ).fill( 'jane doe' );
	await dialog.getByRole( 'button', { name: pseudoLocalize( 'Save' ), exact: true } ).click();
	await expect( dialog.getByRole( 'alert' ) ).toBeVisible();
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

	// By the site's name in its own, which is not translated: the tray is a
	// part of the window of the same kind (#558).
	const details = page.getByRole( 'complementary', { name: /my-site/ } ).filter( { visible: true } );
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

	// A confirmation in the window's corner, and the button that dismisses
	// it: copying the path says it was copied.
	await page.getByRole( 'button', { name: pseudoLocalize( 'Site actions' ), exact: true } ).click();
	await menu.getByRole( 'menuitem', { name: pseudoLocalize( 'Copy path' ), exact: true } ).click();
	const toasts = page.getByLabel( pseudoLocalize( 'Notifications' ), { exact: true } );
	await expect( toasts.getByText( pseudoLocalize( 'Copied the path' ), { exact: true } ) ).toBeVisible();
	await expect( toasts.getByRole( 'button', { name: /^\[/ } ) ).toBeVisible();
	expect( await unwrapped( toasts ) ).toEqual( [] );
	await expect( page.getByRole( 'button', { name: pseudoLocalize( 'Hide details' ), exact: true } ) ).toBeVisible();
} );

test( 'the open site\'s two processes are fully translatable, in the header and in the details, stopped, starting and running', async ( { session } ) => {
	// A Core site, built, so that its server starts as it is asked to and
	// its build watch with it. Nothing is run: the server and the script are
	// answered by stand-ins, as in dev-server.spec.js, and the test says what
	// the main process would say.
	const URL = 'http://127.0.0.1:9400/';
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		const answers = {
			'playground:start': () => ( { ok: true } ),
			'playground:stop': () => ( { ok: true } ),
			'npm:run-script': () => ( { runId: 'e2e-run-1' } ),
			'npm:kill': () => ( { ok: true } ),
			'url:open': () => true,
		};
		global.__e2eAsked = [];
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, () => {
				global.__e2eAsked.push( channel );
				return answer();
			} );
		}
	} );
	// Both have been asked for, and the page has had its answers: only then
	// is it listening for what the test says of them.
	const serverAndWatchAsked = async () => {
		await expect.poll( () => app.evaluate( () => global.__e2eAsked ) ).toEqual( expect.arrayContaining( [ 'playground:start', 'npm:run-script' ] ) );
		await page.evaluate( () => window.api.getSitesWithMeta() );
	};
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( to, what );
	}, [ channel, payload ] );

	const menuButton = ( label ) => ui.processMenuButton( page, pseudoLocalize( label ) );
	const item = ( label ) => page.getByRole( 'menuitem', { name: pseudoLocalize( label ), exact: true } );
	// By the site's name in its own, which is not translated: the tray is a
	// part of the window of the same kind (#558).
	const details = page.getByRole( 'complementary', { name: /e2e-site/ } ).filter( { visible: true } );
	// What is the machine's, or the server's own, in the details: the
	// folder, the dates, which are found by the year in them, the name the
	// server's admin has, and the dots that stand for its password.
	const year = String( new Date().getFullYear() );
	const inDetails = async () => ( await unwrapped( details ) ).filter( ( text ) => text !== site.dir && ! text.includes( year ) && text !== 'admin' && ! /^•+$/.test( text ) );
	// A sentence with something put into it: the sentence is translated and
	// what is put in is not.
	const said = ( sentence, value ) => pseudoLocalize( sentence ).replace( /%[sd]/, value );
	// A menu of the header, open: there is one at a time.
	const inMenu = () => unwrapped( page.getByRole( 'menu' ) );
	// A menu that was closed has gone before the next thing is done. The
	// design system's menu, opened again while it is still on its way out,
	// can miss the Escape that follows: at the speed of a test, about one
	// time in two, and a second Escape closes it.
	const menuGone = () => expect( page.getByRole( 'menu' ) ).toHaveCount( 0 );

	// Stopped. The header's two menus and its review button are found by
	// their names in the pseudo-locale, which is the claim; the rest is
	// scanned.
	await expect( menuButton( 'Server stopped' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( menuButton( 'Build stopped' ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: pseudoLocalize( 'Review & submit changes' ), exact: true } ) ).toBeVisible();
	await expect( details.getByText( pseudoLocalize( 'Development server offline' ), { exact: true } ) ).toBeVisible();
	expect( await inDetails() ).toEqual( [] );
	await menuButton( 'Build stopped' ).click();
	await expect( item( 'Start build watch' ) ).toBeVisible();
	expect( await inMenu() ).toEqual( [] );
	await page.keyboard.press( 'Escape' );
	await menuGone();

	// Starting: the section says how long it has been, the watch, which on
	// Core starts with the server, says what it watches, and the menu's one
	// item says what is happening.
	await menuButton( 'Server stopped' ).click();
	await item( 'Start development server' ).click();
	await menuGone();
	await serverAndWatchAsked();
	await expect( details.getByText( /^\[.*\(\d+s\)~+\]$/ ) ).toBeVisible();
	await expect( details.getByText( said( 'Edits in %s are compiled as they are saved.', 'src/' ), { exact: true } ) ).toBeVisible();
	expect( await inDetails() ).toEqual( [] );
	await menuButton( 'Server starting…' ).click();
	await expect( item( 'Starting development server…' ) ).toBeVisible();
	expect( await inMenu() ).toEqual( [] );
	await page.keyboard.press( 'Escape' );
	await menuGone();

	// Running, with the watch watching: the links, the credentials and the
	// watch's sentence, and a menu with the links in it.
	await tell( 'playground:url', { sitePath: site.dir, url: URL } );
	await expect( details.getByRole( 'link', { name: pseudoLocalize( 'Database' ), exact: true } ) ).toBeVisible();
	await expect( menuButton( 'Build watching' ) ).toBeVisible();
	await details.getByRole( 'button', { name: pseudoLocalize( 'Show password' ), exact: true } ).click();
	await expect( details.getByRole( 'button', { name: pseudoLocalize( 'Hide password' ), exact: true } ) ).toBeVisible();
	expect( ( await inDetails() ).filter( ( text ) => text !== 'password' ) ).toEqual( [] );
	await menuButton( 'Server running' ).click();
	await expect( item( 'Stop development server' ) ).toBeVisible();
	await expect( page.getByRole( 'menuitem' ) ).toHaveCount( 3 );
	expect( await inMenu() ).toEqual( [] );
	await page.keyboard.press( 'Escape' );
	await menuGone();

	// A watch that ended by itself says so in a sentence of its own.
	await tell( 'npm:run-script:done', { runId: 'e2e-run-1', code: 3 } );
	await expect( details.getByText( said( 'The build watch ended by itself, with exit code %d. Its last lines are in the Logs.', '3' ), { exact: true } ) ).toBeVisible();
	expect( ( await inDetails() ).filter( ( text ) => text !== 'password' ) ).toEqual( [] );
} );

test( 'the work-item card is fully translatable, with nothing linked and with a ticket and its lists', async ( { session } ) => {
	// What GitHub and Trac say is theirs and stays as they wrote it: the
	// ticket's summary and its facts, a pull request's title, a file's name,
	// whoever uploaded it. They are answered by stand-ins, as in
	// ticket-card.spec.js, and left out of the scan by name.
	const THEIRS = [ '#60001', 'A summary from Trac', 'reviewing', 'defect (bug)', 'has-patch', '#7', 'A title from GitHub', '60001.diff', '·' ];
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: global.__e2ePrs || { status: 'ok', items: [ { number: 7, title: 'A title from GitHub', state: 'merged', url: 'https://github.com/WordPress/wordpress-develop/pull/7', commitDate: '2026-08-24T12:00:00Z' } ] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: { summary: 'A summary from Trac', status: 'reviewing', resolution: '', type: 'defect (bug)', milestone: '7.2', component: { label: 'General', url: '' }, keywords: [ { label: 'has-patch' } ], opened: { relative: '4 weeks ago', absolute: '' } }, items: [ { filename: '60001.diff', url: 'https://core.trac.wordpress.org/attachment/ticket/60001/60001.diff', applyable: true, author: 'janedoe' } ] } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	const card = ui.workItemCard( page, pseudoLocalize( 'Trac ticket' ) );
	const inCard = async () => ( await unwrapped( card ) ).filter( ( text ) => ! THEIRS.includes( text ) );

	// Nothing linked.
	await expect( card ).toBeVisible( { timeout: 30_000 } );
	await expect( card.getByRole( 'button', { name: pseudoLocalize( 'Browse good first bugs on Trac' ), exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// A ticket, with what Trac said of it, a pull request and an attachment.
	await card.getByLabel( pseudoLocalize( 'Ticket number or URL' ), { exact: true } ).fill( '60001' );
	await card.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } ).click();
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 2, { timeout: 30_000 } );
	await expect( card.getByText( pseudoLocalize( 'Merged' ), { exact: true } ) ).toBeVisible();
	await expect( card.getByRole( 'button', { name: `${ pseudoLocalize( 'Refresh' ) } ${ pseudoLocalize( 'Trac attachments' ) }`, exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// A list that could not be read, and one with nothing in it.
	await app.evaluate( () => {
		global.__e2ePrs = { status: 'offline', items: [], cachedAt: null };
	} );
	await card.getByRole( 'button', { name: `${ pseudoLocalize( 'Refresh' ) } ${ pseudoLocalize( 'Linked pull requests' ) }`, exact: true } ).click();
	await expect( card.getByText( pseudoLocalize( 'Could not reach GitHub.' ), { exact: true } ) ).toBeVisible();
	await expect( card.getByText( pseudoLocalize( 'No cached list to fall back on.' ), { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );
	await app.evaluate( () => {
		global.__e2ePrs = { status: 'ok', items: [] };
	} );
	await card.getByRole( 'button', { name: `${ pseudoLocalize( 'Refresh' ) } ${ pseudoLocalize( 'Linked pull requests' ) }`, exact: true } ).click();
	await expect( card.getByText( pseudoLocalize( 'No pull requests cite this ticket yet.' ), { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );
} );

test( 'the apply card and its preview are fully translatable', async ( { session } ) => {
	// A Core site, which is offered both ways in. The patch's own name and
	// the file it changes are the contributor's and the checkout's, and are
	// left out of the scan.
	const site = await makeSite( session );
	const { page } = await session.start( site.settings, { lang: 'en-XA' } );
	const patch = makePatchFile( session, 'a.patch', [ { file: 'wp-login.php', from: '<?php // trunk', to: '<?php // patched' } ] );
	const card = ui.card( page, pseudoLocalize( 'Apply a patch or PR' ) );

	// Each way in, under its tab.
	await expect( card ).toBeVisible( { timeout: 30_000 } );
	await expect( card.getByRole( 'button', { name: pseudoLocalize( 'Apply PR' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( card ) ).toEqual( [] );
	await card.getByRole( 'tab', { name: pseudoLocalize( 'Diff' ), exact: true } ).click();
	const choose = card.getByRole( 'button', { name: pseudoLocalize( 'Choose a .diff or .patch file…' ), exact: true } );
	await expect( choose ).toBeVisible();
	expect( await unwrapped( card ) ).toEqual( [] );

	// The preview of a patch file: its title, what it changes, and its two
	// buttons. A sentence with the file's name in it is translated around
	// the name.
	await session.answerFileDialog( [ patch ] );
	await choose.click();
	const preview = page.getByRole( 'dialog' );
	await expect( preview.getByRole( 'button', { name: pseudoLocalize( 'Apply and rebuild' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( preview.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( preview ) ).filter( ( text ) => text !== 'src/wp-login.php' ) ).toEqual( [] );
} );

test( 'the list of a site\'s tickets is fully translatable, with a ticket linked and with none', async ( { session } ) => {
	// What GitHub and Trac would say of a ticket is answered by stand-ins
	// that say nothing: this is about the list, and no journey should wait on
	// either. A ticket's number is the ticket's, and is left out of the scan.
	const NUMBERS = [ '#60001', '#60002' ];
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: null, items: [] } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	const ticket = ui.workItemCard( page, pseudoLocalize( 'Trac ticket' ) );
	const link = async ( number ) => {
		await ticket.getByLabel( pseudoLocalize( 'Ticket number or URL' ), { exact: true } ).fill( number );
		await ticket.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } ).click();
		await expect( ticket.getByText( `#${ number }`, { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	};
	const unlink = ticket.getByRole( 'button', { name: pseudoLocalize( 'Unlink' ), exact: true } );
	const inList = async ( list ) => ( await unwrapped( list ) ).filter( ( text ) => ! NUMBERS.includes( text ) );

	// One ticket parked and another linked: the other tickets.
	await expect( ticket ).toBeVisible( { timeout: 30_000 } );
	await link( '60001' );
	await unlink.click();
	await link( '60002' );
	const others = page.getByRole( 'region', { name: pseudoLocalize( 'Other tickets on this site' ), exact: true } );
	await expect( others.getByRole( 'button', { name: `${ pseudoLocalize( 'Switch' ) } #60001`, exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( others.getByRole( 'button', { name: `${ pseudoLocalize( 'Delete this ticket’s work' ) } #60001`, exact: true } ) ).toBeVisible();
	await expect( others.getByText( pseudoLocalize( 'Edited just now' ), { exact: true } ) ).toBeVisible();
	expect( await inList( others ) ).toEqual( [] );

	// None linked: every ticket of the site.
	await unlink.click();
	const yours = page.getByRole( 'region', { name: pseudoLocalize( 'Your tickets on this site' ), exact: true } );
	await expect( yours.getByRole( 'button', { name: `${ pseudoLocalize( 'Continue working' ) } #60002`, exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( yours.getByRole( 'listitem' ) ).toHaveCount( 2 );
	expect( await inList( yours ) ).toEqual( [] );
} );

test( 'the rename dialog and the questions asked before a deletion are fully translatable', async ( { session } ) => {
	// The site's name is the contributor's and a ticket's number is the
	// ticket's: each is in a sentence that is translated around it.
	const site = await makeSite( session, { label: 'first-name' } );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: null, items: [] } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	const siteMenu = page.getByRole( 'button', { name: pseudoLocalize( 'Site actions' ), exact: true } );
	await expect( siteMenu ).toBeVisible( { timeout: 30_000 } );

	// The rename dialog, and its complaint.
	await siteMenu.click();
	await page.getByRole( 'menuitem', { name: pseudoLocalize( 'Rename…' ), exact: true } ).click();
	const rename = page.getByRole( 'dialog', { name: pseudoLocalize( 'Rename site' ), exact: true } );
	await expect( rename ).toBeVisible();
	expect( await unwrapped( rename ) ).toEqual( [] );
	await rename.getByLabel( pseudoLocalize( 'Site name' ), { exact: true } ).fill( '' );
	await rename.getByRole( 'button', { name: pseudoLocalize( 'Rename' ), exact: true } ).click();
	await expect( rename.getByRole( 'alert' ) ).toHaveText( pseudoLocalize( 'Site name cannot be empty.' ) );
	expect( await unwrapped( rename ) ).toEqual( [] );
	await page.keyboard.press( 'Escape' );
	await expect( rename ).toHaveCount( 0 );

	// The question before a site is deleted.
	const question = page.getByRole( 'alertdialog' );
	await siteMenu.click();
	await page.getByRole( 'menuitem', { name: pseudoLocalize( 'Delete site' ), exact: true } ).click();
	await expect( question ).toHaveAccessibleName( pseudoLocalize( 'Delete %s?' ).replace( '%s', 'first-name' ) );
	await expect( question.getByRole( 'button', { name: pseudoLocalize( 'Delete site' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( question ) ).toEqual( [] );
	await question.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ).click();
	await expect( question ).toHaveCount( 0 );

	// The question before a ticket's work is deleted.
	const ticket = ui.workItemCard( page, pseudoLocalize( 'Trac ticket' ) );
	await ticket.getByLabel( pseudoLocalize( 'Ticket number or URL' ), { exact: true } ).fill( '60001' );
	await ticket.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } ).click();
	await ticket.getByRole( 'button', { name: pseudoLocalize( 'Unlink' ), exact: true } ).click();
	await page.getByRole( 'button', { name: `${ pseudoLocalize( 'Delete this ticket’s work' ) } #60001`, exact: true } ).click();
	await expect( question ).toHaveAccessibleName( pseudoLocalize( 'Delete all work on ticket #%d?' ).replace( '%d', '60001' ) );
	expect( await unwrapped( question ) ).toEqual( [] );
} );

test( 'the app menu and the native file dialogs are translated in main', async ( { session } ) => {
	// Main's own strings, which the window never renders: they are only
	// translated if main applied the locale before it built them.
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );

	// Every menu and every item in it that is not a separator, the ones a
	// role does the work of included: a role's own label is Electron's
	// English (#657). The app menu on macOS is titled with the app's name.
	const untranslated = await app.evaluate( ( { Menu } ) => {
		const walk = ( items, where ) => items.flatMap( ( item ) => {
			const here = `${ where } › ${ item.label }`;
			const bracketed = item.type === 'separator' || item.role === 'appmenu' || /^\[.*\]$/.test( item.label );
			return [ ...( bracketed ? [] : [ here ] ), ...( item.submenu ? walk( item.submenu.items, here ) : [] ) ];
		} );
		return walk( Menu.getApplicationMenu().items, 'menu' );
	} );
	expect( untranslated ).toEqual( [] );

	const help = await app.evaluate( ( { Menu } ) => Menu.getApplicationMenu().items
		.find( ( item ) => item.role === 'help' ).submenu.items
		.filter( ( item ) => item.type === 'normal' && ! item.role )
		.map( ( item ) => item.label ) );
	expect( help ).toEqual( [ pseudoLocalize( 'Open App Log' ), pseudoLocalize( 'Show Logs Folder' ) ] );
	expect( await app.evaluate( ( { Menu } ) => Menu.getApplicationMenu().getMenuItemById( 'settings' ).label ) ).toBe( pseudoLocalize( 'Settings…' ) );

	// The dialog is answered the way answerFileDialog does, and says what it
	// was asked with. Cancelled, so the card is left as it was.
	await app.evaluate( ( { dialog } ) => {
		dialog.showOpenDialog = async ( ...args ) => {
			global.__e2eDialog = args.at( -1 );
			return { canceled: true, filePaths: [] };
		};
	} );
	const card = ui.card( page, pseudoLocalize( 'Apply a patch or PR' ) );
	await expect( card ).toBeVisible( { timeout: 30_000 } );
	await card.getByRole( 'tab', { name: pseudoLocalize( 'Diff' ), exact: true } ).click();
	await card.getByRole( 'button', { name: pseudoLocalize( 'Choose a .diff or .patch file…' ), exact: true } ).click();
	await expect.poll( () => app.evaluate( () => global.__e2eDialog ) ).toMatchObject( {
		title: pseudoLocalize( 'Choose a patch file' ),
		filters: [ { name: pseudoLocalize( 'Patch Files' ) }, { name: pseudoLocalize( 'All Files' ) } ],
	} );
} );

/**
 * A site with an edit to review, started in the pseudo-locale, with what Trac
 * and GitHub would say of a ticket answered by stand-ins that say nothing.
 *
 * @param {Object}  session
 * @param {Object}  [options]
 * @param {string}  [options.trunkDate]   When the site's trunk commit was made.
 * @param {string}  [options.branch]      A branch to switch to before the app starts, recorded as starting at trunk.
 * @param {boolean} [options.edit]        Whether to leave an edit to review; true by default.
 * @param {Object}  [options.meta]        More of the site's record.
 * @param {Object}  [options.preferences] The app's preferences, such as a remembered WordPress.org username.
 * @return {Promise<Object>} The site, the app and the page.
 */
async function siteWithEdit( session, { trunkDate, branch, edit = true, meta = {}, preferences = {} } = {} ) {
	const site = await makeSite( session, { trunkDate } );
	if ( branch ) {
		gitOk( [ 'switch', '-q', '-c', branch ], site.dir );
		site.settings.siteMeta[ site.dir ].branches = { [ branch ]: { baseOid: site.baseOid, headOid: site.baseOid, returnTo: 'trunk' } };
	}
	Object.assign( site.settings.siteMeta[ site.dir ], meta );
	Object.assign( site.settings.preferences, preferences );
	if ( edit ) write( site.dir, LOGIN, MY_EDIT );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: null, items: [] } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	return { site, app, page };
}

const MY_EDIT = '<?php // my fix\n';

/**
 * Opens "Review & submit changes" and waits for what it says first.
 *
 * @param {Object} page
 * @param {string} [first] The text to wait for: the destinations' heading by default.
 * @return {Promise<Object>} The dialog.
 */
async function openReview( page, first = 'Where this patch goes' ) {
	await page.getByRole( 'button', { name: pseudoLocalize( 'Review & submit changes' ), exact: true } ).click();
	const dialog = page.getByRole( 'dialog', { name: pseudoLocalize( 'Review & submit changes' ), exact: true } );
	await expect( dialog.getByText( pseudoLocalize( first ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	return dialog;
}

/**
 * What is not translated in the dialog, leaving out what is not this batch's:
 * the diff's own lines, which are the checkout's, the pull request card, which
 * is #625's, and the Copy button, whose labels are #630's.
 *
 * @param {Object} dialog
 * @return {Promise<string[]>}
 */
async function unwrappedInReview( dialog ) {
	const notOurs = [
		...await unwrapped( dialog.locator( '.patch-diff-code' ) ),
		...await unwrapped( dialog.locator( '.destination-group' ).first() ),
		'Copy',
	];
	return ( await unwrapped( dialog ) ).filter( ( text ) => ! notOurs.includes( text ) );
}

test( 'the Review & submit dialog is fully translatable: an old trunk, the diff, the mentor form, and Trac without and with a ticket', async ( { session } ) => {
	// A trunk 30 days old, so the dialog warns about it.
	const { site, page } = await siteWithEdit( session, { trunkDate: new Date( Date.now() - 30 * 24 * 60 * 60 * 1000 ).toISOString() } );

	// No ticket linked: the Trac card asks for one.
	let dialog = await openReview( page );
	await expect( dialog.getByText( pseudoLocalize( "This site's WordPress code is %d days old — this patch may not apply on Trac. Consider updating to the latest trunk first." ).replace( '%d', '30' ), { exact: true } ) ).toBeVisible();
	await expect( dialog.getByLabel( pseudoLocalize( 'Trac ticket number or URL' ), { exact: true } ) ).toBeVisible();
	await expect( dialog.getByRole( 'button', { name: pseudoLocalize( 'Remember this' ), exact: true } ) ).toBeVisible();
	expect( await unwrappedInReview( dialog ) ).toEqual( [] );
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );

	// A ticket linked. The edit is put back first: linking over edits asks
	// what to do with them, and that question is #629's.
	gitOk( [ 'checkout', '-q', '--', LOGIN ], site.dir );
	const ticket = ui.workItemCard( page, pseudoLocalize( 'Trac ticket' ) );
	await ticket.getByLabel( pseudoLocalize( 'Ticket number or URL' ), { exact: true } ).fill( '60001' );
	await ticket.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } ).click();
	await expect( ticket.getByRole( 'button', { name: pseudoLocalize( 'Unlink' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	write( site.dir, LOGIN, MY_EDIT );
	dialog = await openReview( page );
	await expect( dialog.getByRole( 'button', { name: pseudoLocalize( 'Save, then open #%d' ).replace( '%d', '60001' ), exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( pseudoLocalize( 'Your changes for ticket #%d' ).replace( '%d', '60001' ), { exact: true } ) ).toBeVisible();
	expect( await unwrappedInReview( dialog ) ).toEqual( [] );
} );

test( 'the Review & submit dialog is fully translatable over someone else\'s pull request', async ( { session } ) => {
	// The app reads a checked-out pull request from the branch's name.
	const { page } = await siteWithEdit( session, { branch: 'pr/7' } );
	const dialog = await openReview( page );
	// The refusal and what is still allowed, one alert.
	await expect( dialog.getByRole( 'alert' ) ).toContainText( pseudoLocalize( 'You can still use <strong>Save</strong> to keep an unattributed copy of your edits.' ).replace( /<\/?strong>/g, '' ) );
	await expect( dialog.getByText( pseudoLocalize( 'Your changes on top of PR #%d' ).replace( '%d', '7' ), { exact: true } ) ).toBeVisible();
	expect( await unwrappedInReview( dialog ) ).toEqual( [] );
} );

test( 'the Review & submit dialog is fully translatable with nothing to send, the diff pane included', async ( { session } ) => {
	const { page } = await siteWithEdit( session, { edit: false } );
	const dialog = await openReview( page, 'There is nothing to send yet — this site has no changes against its copy of trunk.' );
	await expect( dialog.locator( '.patch-diff-code' ) ).toHaveText( pseudoLocalize( 'No changes.' ) );
	// The whole dialog, the pane's box included: with no diff in it, there
	// is nothing in the box that is the checkout's.
	expect( ( await unwrapped( dialog ) ).filter( ( text ) => text !== 'Copy' ) ).toEqual( [] );
} );

test( 'the mentor card is fully translatable once the contributor\'s name and event are remembered', async ( { session } ) => {
	// An event name with markup in it is the contributor's own text, and
	// goes into the sentence as it is.
	const EVENT = 'WordCamp <Test> & Co';
	const { page } = await siteWithEdit( session, { preferences: { wporgHandle: 'janedoe', contributionEvent: EVENT } } );
	const dialog = await openReview( page );
	await expect( dialog.getByRole( 'button', { name: pseudoLocalize( 'Save patch as %s' ).replace( '%s', 'janedoe' ), exact: true } ) ).toBeVisible();
	await expect( dialog.locator( 'strong', { hasText: EVENT } ) ).toHaveText( EVENT );
	await expect( dialog.getByRole( 'button', { name: pseudoLocalize( 'Change these' ), exact: true } ) ).toBeVisible();
	expect( await unwrappedInReview( dialog ) ).toEqual( [] );
} );

for ( const [ named, label ] of [ [ 'by its name', '60001.diff' ], [ 'with no name on record', undefined ] ] ) {
	test( `the Review & submit dialog is fully translatable over someone else's applied patch, ${ named }`, async ( { session } ) => {
		const appliedPatch = { appliedAt: new Date().toISOString(), files: [ 'src/wp-login.php' ], text: 'x', ...( label ? { label } : {} ) };
		const { page } = await siteWithEdit( session, { meta: { appliedPatch } } );
		const dialog = await openReview( page );
		// What is in bold: the sentence without the brackets the pseudo-locale
		// puts around the whole string, outside the bold.
		const sentence = label ? '<strong><label /> is part of this checkout.</strong>' : '<strong>The patch you applied is part of this checkout.</strong>';
		const bold = pseudoLocalize( sentence ).replace( /^\[<strong>|<\/strong>~*\]$/g, '' ).replace( '<label />', label );
		await expect( dialog.getByRole( 'alert' ).locator( 'strong' ).first() ).toHaveText( bold );
		expect( await unwrappedInReview( dialog ) ).toEqual( [] );
	} );
}

test( 'the Open a pull request card is fully translatable, from signing in to the pull request it opened', async ( { session } ) => {
	// GitHub is answered at the IPC seam, as in open-pull-request.spec.js.
	// What is GitHub's stays as it is and is left out of the scan: the code
	// to type, the fork and the branch, each of which is its own element.
	const CODE = 'ABCD-1234';
	const BRANCH = 'trac-60001';
	const THEIRS = [ CODE, 'janedoe/wordpress-develop', BRANCH ];
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eLogin = null;
		global.__e2ePr = null;
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: null, items: [] } ),
			'url:open': () => true,
			'github:account': () => ( { ok: true, login: global.__e2eLogin, configured: true, testMode: null } ),
			'github:sign-in': () => ( { ok: true, userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' } ),
			'github:open-pr': () => global.__e2ePr,
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	const answerPr = ( result ) => app.evaluate( ( _, value ) => {
		global.__e2ePr = value;
	}, result );

	// A ticket, so the signed-in card offers its form.
	const ticket = ui.workItemCard( page, pseudoLocalize( 'Trac ticket' ) );
	await ticket.getByLabel( pseudoLocalize( 'Ticket number or URL' ), { exact: true } ).fill( '60001' );
	await ticket.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } ).click();
	await expect( ticket.getByRole( 'button', { name: pseudoLocalize( 'Unlink' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	write( site.dir, LOGIN, '<?php // my fix\n' );

	// The rest of the dialog is #624's: only the card is scanned, found by
	// its heading.
	await page.getByRole( 'button', { name: pseudoLocalize( 'Review & submit changes' ), exact: true } ).click();
	const card = page.getByRole( 'dialog' ).getByText( pseudoLocalize( 'Open a pull request' ), { exact: true } ).locator( '..' );
	const inCard = async () => ( await unwrapped( card ) ).filter( ( text ) => ! THEIRS.includes( text ) );
	const button = ( label ) => card.getByRole( 'button', { name: pseudoLocalize( label ), exact: true } );

	// Signed out: the ask, then declining it, then asked again.
	await expect( button( 'Sign in with GitHub' ) ).toBeVisible( { timeout: 30_000 } );
	expect( await inCard() ).toEqual( [] );
	await button( 'Not now' ).click();
	await expect( button( 'Show this again' ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );
	await button( 'Show this again' ).click();

	// The code to type in the browser, and the wait for it.
	await button( 'Sign in with GitHub' ).click();
	await expect( card.getByText( CODE, { exact: true } ) ).toBeVisible();
	await expect( card.getByText( pseudoLocalize( 'Waiting for you to finish in the browser…' ), { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// GitHub's answer arrives: signed in, with the form.
	await app.evaluate( ( { BrowserWindow } ) => {
		global.__e2eLogin = 'janedoe';
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'github:sign-in:done', { ok: true, login: 'janedoe' } );
	} );
	await expect( button( 'Open pull request' ) ).toBeVisible();
	await expect( card.getByRole( 'button', { name: 'janedoe/wordpress-develop', exact: true } ) ).toBeVisible();
	await card.locator( 'summary' ).click();
	expect( await inCard() ).toEqual( [] );

	// A failure the card words itself.
	await answerPr( { ok: false, reason: 'rate-limited', error: 'not shown' } );
	await button( 'Open pull request' ).click();
	await expect( card.getByText( pseudoLocalize( 'GitHub is rate-limiting this connection. It usually clears within the hour.' ), { exact: true } ) ).toBeVisible();
	await expect( button( 'Save the patch file instead' ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// A dry run's result.
	await answerPr( { ok: true, dryRun: true, url: `https://github.com/janedoe/wordpress-develop/tree/${ BRANCH }`, branch: BRANCH } );
	await button( 'Open pull request' ).click();
	await expect( card.getByRole( 'button', { name: BRANCH, exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// A pull request opened from a checkout that was behind trunk. A result
	// stays until the dialog opens again, so it is closed and opened first:
	// by its Close button, since the button pressed is gone and took the
	// focus with it.
	await page.getByRole( 'dialog' ).getByRole( 'button', { name: pseudoLocalize( 'Close' ), exact: true } ).click();
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Review & submit changes' ), exact: true } ).click();
	await answerPr( { ok: true, url: 'https://github.com/WordPress/wordpress-develop/pull/9', number: 9, branch: BRANCH, exactBase: false } );
	await button( 'Open pull request' ).click();
	await expect( button( 'Copy the link' ) ).toBeVisible();
	await expect( card.getByRole( 'button', { name: pseudoLocalize( 'Open #%s to comment' ).replace( '%s', '60001' ), exact: true } ) ).toBeVisible();
	// The link in the sentence is part of it: the scan stops at the link, so
	// the sentence around it is checked whole and the link left out.
	const opened = card.locator( '.success-text' );
	await expect( opened ).toHaveText( /^\[.*\]$/ );
	const link = ( await opened.getByRole( 'button' ).textContent() ).trim();
	expect( ( await inCard() ).filter( ( text ) => text !== link ) ).toEqual( [] );
} );

test( 'the Open a pull request card on a Gutenberg site is fully translatable, in the words that are Gutenberg\'s own', async ( { session } ) => {
	// The card's words that differ by project: the ask when signed out, the
	// notes help and the fold with the form, and the loop-back once the pull
	// request exists. The issue is linked in the site's record rather than
	// through its card, which is the Core test's.
	const ISSUE = '71234';
	const BRANCH = `fix/issue-${ ISSUE }`;
	const THEIRS = [ 'janedoe/gutenberg', BRANCH ];
	const site = await makeSite( session );
	Object.assign( site.settings.siteMeta[ site.dir ], { projectType: 'gutenberg', tracTicket: ISSUE } );
	write( site.dir, LOGIN, '<?php // my fix\n' );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eLogin = null;
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'url:open': () => true,
			'github:account': () => ( { ok: true, login: global.__e2eLogin, configured: true, testMode: null } ),
			'github:sign-in': () => ( { ok: true, userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device' } ),
			'github:open-pr': () => ( { ok: true, url: 'https://github.com/WordPress/gutenberg/pull/9', number: 9, branch: 'fix/issue-71234', exactBase: true } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Review & submit changes' ), exact: true } ).click();
	const card = page.getByRole( 'dialog' ).getByText( pseudoLocalize( 'Open a pull request' ), { exact: true } ).locator( '..' );
	const inCard = async () => ( await unwrapped( card ) ).filter( ( text ) => ! THEIRS.includes( text ) );
	const button = ( label ) => card.getByRole( 'button', { name: pseudoLocalize( label ), exact: true } );

	// Signed out: what the app cannot do for a contributor on GitHub.
	await expect( card.getByText( pseudoLocalize( 'It cannot create the GitHub account for you.' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( await inCard() ).toEqual( [] );

	// Signed in, with the form and its fold open.
	await button( 'Sign in with GitHub' ).click();
	await expect( card.getByText( 'ABCD-1234', { exact: true } ) ).toBeVisible();
	await app.evaluate( ( { BrowserWindow } ) => {
		global.__e2eLogin = 'janedoe';
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'github:sign-in:done', { ok: true, login: 'janedoe' } );
	} );
	await expect( button( 'Open pull request' ) ).toBeVisible();
	await card.locator( 'summary' ).click();
	await expect( card.getByText( pseudoLocalize( 'How pull requests work in Gutenberg' ), { exact: true } ) ).toBeVisible();
	await expect( card.getByText( pseudoLocalize( 'Goes at the top of the description. The Fixes line that links the issue and your WordPress.org username are added underneath.' ), { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// The pull request it opened, and the line back to the issue.
	await button( 'Open pull request' ).click();
	await expect( card.getByText( pseudoLocalize( 'The Fixes line already lists it on the issue. A comment there still tells the people watching it.' ), { exact: true } ) ).toBeVisible();
	const opened = card.locator( '.success-text' );
	await expect( opened ).toHaveText( /^\[.*\]$/ );
	const link = ( await opened.getByRole( 'button' ).textContent() ).trim();
	expect( ( await inCard() ).filter( ( text ) => text !== link ) ).toEqual( [] );
} );

test( 'the setup checklist is fully translatable, with steps done and one ready', async ( { session } ) => {
	// Installed and built, but not through the checklist: three steps done
	// and the last one ready.
	const built = await makeSite( session );
	built.settings.siteMeta[ built.dir ].skipInitWizard = false;
	const { page } = await session.start( built.settings, { lang: 'en-XA' } );
	const checklist = page.getByRole( 'region', { name: pseudoLocalize( 'Initial setup checklist' ), exact: true } );
	await expect( checklist.getByText( pseudoLocalize( 'Ready' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( checklist.getByText( pseudoLocalize( 'Completed' ), { exact: true } ) ).toHaveCount( 3 );
	expect( await unwrapped( checklist ) ).toEqual( [] );
} );

test( 'the checklist after a failed install is fully translatable', async ( { session } ) => {
	// No node_modules and no build, and the last install failed.
	const site = await makeSite( session );
	fs.rmSync( path.join( site.dir, 'node_modules' ), { recursive: true, force: true } );
	fs.rmSync( path.join( site.dir, 'build' ), { recursive: true, force: true } );
	Object.assign( site.settings.siteMeta[ site.dir ], { skipInitWizard: false, installFailed: true } );
	const { page } = await session.start( site.settings, { lang: 'en-XA' } );
	const checklist = page.getByRole( 'region', { name: pseudoLocalize( 'Initial setup checklist' ), exact: true } );
	await expect( checklist.getByRole( 'button', { name: pseudoLocalize( 'Retry %s' ).replace( '%s', 'npm install' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( checklist.getByText( pseudoLocalize( 'Failed' ), { exact: true } ) ).toBeVisible();
	await expect( checklist.getByText( pseudoLocalize( 'Locked' ), { exact: true } ) ).toHaveCount( 2 );
	expect( await unwrapped( checklist ) ).toEqual( [] );
} );

test( 'the trunk banners, the question before an update over edits, and the update card are fully translatable', async ( { session } ) => {
	// A trunk 30 days old, with an edit in it.
	const site = await makeSite( session, { trunkDate: new Date( Date.now() - 30 * 24 * 60 * 60 * 1000 ).toISOString() } );
	write( site.dir, LOGIN, MY_EDIT );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );

	// The stale banner.
	const stale = page.locator( '[data-next-action="update-trunk"]' );
	await expect( stale.getByText( pseudoLocalize( "This site's WordPress code is %d days old" ).replace( '%d', '30' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( await unwrapped( stale ) ).toEqual( [] );

	// The question an update asks over edits, with each answer chosen.
	await stale.getByRole( 'button', { name: pseudoLocalize( 'Update to latest trunk' ), exact: true } ).click();
	const question = page.getByRole( 'dialog', { name: pseudoLocalize( 'Update to latest trunk?' ), exact: true } );
	await expect( question.getByRole( 'button', { name: pseudoLocalize( 'Save patch & update' ), exact: true } ) ).toBeVisible();
	await expect( question.getByText( pseudoLocalize( "You've changed %d file in this site. Resetting to trunk would throw them away." ).replace( '%d', '1' ), { exact: true } ) ).toBeVisible();
	// The file's path is the checkout's.
	const inQuestion = async () => ( await unwrapped( question ) ).filter( ( text ) => text !== 'src/wp-login.php' );
	expect( await inQuestion() ).toEqual( [] );
	await question.getByRole( 'button', { name: new RegExp( pseudoLocalize( 'Discard them' ).replace( /[[\]()~]/g, '\\$&' ) ) } ).click();
	await expect( question.getByRole( 'button', { name: pseudoLocalize( 'Discard & update' ), exact: true } ) ).toBeVisible();
	expect( await inQuestion() ).toEqual( [] );

	// The question a discard asks before it does.
	await question.getByRole( 'button', { name: pseudoLocalize( 'Discard & update' ), exact: true } ).click();
	const discard = ui.confirmDialog( page );
	await expect( discard ).toHaveAccessibleName( pseudoLocalize( 'Discard all local changes?' ) );
	await expect( discard.getByRole( 'button', { name: pseudoLocalize( 'Discard changes' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( discard ) ).toEqual( [] );
	await discard.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ).click();
	await expect( discard ).toHaveCount( 0 );
	await question.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ).click();
	await expect( question ).toHaveCount( 0 );

	// The update under way, on its first step. The fetch is a stand-in that
	// never finishes, so the card stays where it is.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'git:update-trunk' );
		ipcMain.handle( 'git:update-trunk', () => ( { updateId: 'e2e-update' } ) );
	} );
	gitOk( [ 'checkout', '-q', '--', LOGIN ], site.dir );
	await stale.getByRole( 'button', { name: pseudoLocalize( 'Update to latest trunk' ), exact: true } ).click();
	const card = page.locator( '[data-next-action="updating"]' );
	await expect( card.getByText( pseudoLocalize( 'step %1$d of %2$d' ).replace( '%1$d', '1' ).replace( '%2$d', '3' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( card.getByText( pseudoLocalize( 'Fetching and resetting to trunk…' ), { exact: true } ) ).toBeVisible();
	expect( await unwrapped( card ) ).toEqual( [] );
} );

test( 'the banner after an update that did not finish is fully translatable', async ( { session } ) => {
	const site = await makeSite( session );
	site.settings.siteMeta[ site.dir ].updateIncomplete = true;
	const { page } = await session.start( site.settings, { lang: 'en-XA' } );
	const banner = page.locator( '[data-next-action="retry-install-build"]' );
	await expect( banner.getByRole( 'button', { name: pseudoLocalize( 'Retry install & build' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( await unwrapped( banner ) ).toEqual( [] );
} );

/**
 * The lines the visible terminal shows, each whole.
 *
 * The terminal draws a row per line of its width, and a line longer than
 * that, as a pseudo-localised one often is, goes on in the rows after it.
 * A translated line opens with `[` and closes with `]`, so a row is joined
 * to the line before it while that line is open. A row that does not open
 * with `[` and follows a closed line is a line of its own, and a string
 * nobody wrapped.
 *
 * @param {Object} screen The terminal's rows.
 * @return {Promise<string[]>} The non-empty lines, trimmed.
 */
async function terminalLines( screen ) {
	const rows = await screen.evaluate( ( element ) => [ ...element.children ].map( ( row ) => row.textContent.replace( /\u00a0/g, ' ' ).trimEnd() ) );
	const lines = [];
	for ( const row of rows ) {
		const last = lines.length ? lines[ lines.length - 1 ].trim() : '';
		if ( last.startsWith( '[' ) && ! last.endsWith( ']' ) ) lines[ lines.length - 1 ] += row;
		else lines.push( row );
	}
	return lines.map( ( line ) => line.trim() ).filter( Boolean );
}

test( 'the Terminal is fully translatable: what it prints, a command it does not know, and the hints under it', async ( { session } ) => {
	// A built site, so that the hints under the terminal offer their
	// commands.
	const site = await makeSite( session );
	const { page } = await session.start( site.settings, { lang: 'en-XA' } );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Toggle Terminal' ), exact: true } ).click();
	const tray = page.getByRole( 'complementary', { name: pseudoLocalize( 'Terminal' ), exact: true } );
	const screen = tray.locator( '.xterm-rows' ).filter( { visible: true } );
	// What is typed at the prompt is the contributor's, and the prompt is a
	// `$`: a line that starts with one is left out. Every other line is one
	// translated string from its first character to its last, so English
	// after a translated string is caught too.
	const whole = ( line ) => {
		let depth = 0;
		for ( let i = 0; i < line.length; i++ ) {
			if ( line[ i ] === '[' ) depth++;
			else if ( line[ i ] === ']' && --depth === 0 ) return i === line.length - 1;
		}
		return false;
	};
	const printed = async () => ( await terminalLines( screen ) ).filter( ( line ) => ! line.startsWith( '$' ) && ! ( line.startsWith( '[' ) && whole( line ) ) );

	// The banner and the help it prints as it starts. Waited for by its last
	// line: xterm draws only the rows on screen, and on a short window the
	// help's first lines, longer in the pseudo-locale, have already scrolled
	// out of them.
	await expect( screen ).toContainText( pseudoLocalize( 'Run them here whenever you change files or add a dependency afterwards.' ), { timeout: 30_000 } );
	expect( await printed() ).toEqual( [] );

	// The help asked for, and a command it does not know. The terminal's
	// input is named by xterm, in the words the app gives it.
	const input = page.getByRole( 'textbox', { name: pseudoLocalize( 'Terminal input' ), exact: true } );
	await input.pressSequentially( 'help', { delay: 10 } );
	await input.press( 'Enter' );
	await input.pressSequentially( 'frobnicate', { delay: 10 } );
	await input.press( 'Enter' );
	await expect( screen ).toContainText( pseudoLocalize( 'Try "%s" for the list of supported commands.' ).replace( '%s', 'help' ) );
	expect( await terminalLines( screen ) ).toContain( pseudoLocalize( 'Unsupported command: %s' ).replace( '%s', 'frobnicate' ) );
	expect( await printed() ).toEqual( [] );

	// The hints under it, on a built site: a sentence each, with the command
	// in it a link that types it, and the command's own words left as they
	// are.
	const notes = tray.locator( '.tray-notes' ).filter( { visible: true } );
	await expect( notes.getByRole( 'button', { name: 'npm run build', exact: true } ) ).toBeVisible();
	await expect( notes.getByRole( 'button', { name: 'npm install', exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( notes ) ).filter( ( text ) => ! [ 'npm run build', 'npm install' ].includes( text ) ) ).toEqual( [] );
} );

test( 'the Logs are fully translatable: their tabs, the notes in an empty pane, and what the app writes in the server\'s and the watch\'s', async ( { session } ) => {
	// A Core site, built. The server and the watch are answered by
	// stand-ins, as in the processes test above: the watch starts, and the
	// server refuses, with a reason that is the stand-in's and left out.
	const REFUSAL = 'the stand-in server refused';
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain }, refusal ) => {
		const answers = {
			'playground:start': () => ( { ok: false, error: refusal } ),
			'playground:stop': () => ( { ok: true } ),
			'npm:run-script': () => ( { runId: 'e2e-run-1' } ),
			'npm:kill': () => ( { ok: true } ),
			'url:open': () => true,
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	}, REFUSAL );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Toggle Logs' ), exact: true } ).click();
	const tray = page.getByRole( 'complementary', { name: pseudoLocalize( 'Logs' ), exact: true } );
	const tab = ( label ) => tray.getByRole( 'tab', { name: label, exact: true } );
	// debug.log's path, once there is one, is the machine's.
	const inTray = async () => ( await unwrapped( tray ) ).filter( ( text ) => ! text.startsWith( site.dir ) );

	// The watch's pane and debug.log's, empty: each says what fills it.
	await tab( pseudoLocalize( 'Build watch' ) ).click();
	await expect( tray.locator( '.log-pane-note' ) ).toBeVisible( { timeout: 30_000 } );
	expect( await inTray() ).toEqual( [] );
	await tab( pseudoLocalize( 'Debug.log' ) ).click();
	await expect( tray.getByText( pseudoLocalize( 'The log file appears once the dev server has run.' ), { exact: true } ) ).toBeVisible();
	expect( await inTray() ).toEqual( [] );

	// The server started: the watch starts with it, and the server's
	// refusal brings the Logs up on the server's tab.
	await ui.processMenuButton( page, pseudoLocalize( 'Server stopped' ) ).click();
	await page.getByRole( 'menuitem', { name: pseudoLocalize( 'Start development server' ), exact: true } ).click();
	await expect( tray.getByText( pseudoLocalize( 'Dev server failed to start: %s' ).replace( '%s', REFUSAL ), { exact: true } ) ).toBeVisible();
	expect( await inTray() ).toEqual( [] );

	// The watch's pane, with what the app said of its start, and then of
	// its end.
	await tab( pseudoLocalize( 'Build watch (watching)' ) ).click();
	await expect( tray.getByText( pseudoLocalize( 'Running %s…' ).replace( '%s', 'npm run grunt -- _watch' ), { exact: true } ) ).toBeVisible();
	expect( await inTray() ).toEqual( [] );
	await app.evaluate( ( { BrowserWindow } ) => {
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'npm:run-script:done', { runId: 'e2e-run-1', code: 3 } );
	} );
	await expect( tab( pseudoLocalize( 'Build watch (exited %d)' ).replace( '%d', '3' ) ) ).toBeVisible();
	await expect( tray.getByText( pseudoLocalize( '%1$s exited with code %2$s' ).replace( '%1$s', 'npm run grunt -- _watch' ).replace( '%2$s', '3' ), { exact: true } ) ).toBeVisible();
	expect( await inTray() ).toEqual( [] );
} );

test( 'the apply card is fully translatable when a patch or a pull request will not go on, and once a patch is applied', async ( { session } ) => {
	// Real patches applied by the real engine, so the sentence about a file
	// that moved on is main's, in main's locale. What is the checkout's own
	// stays as it is and is left out of the scan: the file's path, the line of
	// code the panel names a place by, and the patch's lines.
	const { read } = require( '../helpers/git-site.cjs' );
	const FILE = 'src/wp-login.php';
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	const card = ui.card( page, pseudoLocalize( 'Apply a patch or PR' ) );
	await expect( card ).toBeVisible( { timeout: 30_000 } );
	await card.getByRole( 'tab', { name: pseudoLocalize( 'Diff' ), exact: true } ).click();
	const choose = card.getByRole( 'button', { name: pseudoLocalize( 'Choose a .diff or .patch file…' ), exact: true } );
	const preview = page.getByRole( 'dialog' );
	const apply = preview.getByRole( 'button', { name: pseudoLocalize( 'Apply and rebuild' ), exact: true } );
	// "Near" and the line of code the place is found by are one sentence, cut
	// at the code so that the code can go where a translation wants it: the
	// pieces either side of it are bracketed only together.
	const near = pseudoLocalize( 'Near %s' ).split( '%s' ).map( ( piece ) => piece.trim() );
	const codeOf = async ( region ) => ( await region.locator( 'code, pre' ).allTextContents() ).map( ( text ) => text.trim() );
	const inCard = async () => {
		const theirs = [ FILE, ...near, ...( await codeOf( card ) ) ];
		return ( await unwrapped( card ) ).filter( ( text ) => ! theirs.includes( text ) );
	};

	// A patch whose line the contributor has already changed: the preview
	// says whose work it would land on, and applying it fails in that file.
	write( site.dir, LOGIN, '<?php // I got here first\n' );
	const misfit = makePatchFile( session, 'misfit.patch', [ { file: 'wp-login.php', from: '<?php // trunk', to: '<?php // patched' } ] );
	await session.answerFileDialog( [ misfit ] );
	await choose.click();
	await expect( apply ).toBeVisible( { timeout: 30_000 } );
	await expect( preview.getByText( pseudoLocalize( 'You have your own edits to %s. Save a patch of your work first if you want a copy.' ).replace( '%s', FILE ), { exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( preview ) ).filter( ( text ) => text !== FILE ) ).toEqual( [] );
	await apply.click();
	const failure = card.getByRole( 'alert' ).filter( { hasText: pseudoLocalize( 'The checkout was not changed.' ) } );
	await expect( failure ).toBeVisible( { timeout: 60_000 } );
	await expect( failure ).toContainText( FILE );
	expect( await inCard() ).toEqual( [] );
	await failure.getByRole( 'button', { name: pseudoLocalize( 'Dismiss' ), exact: true } ).click();
	await expect( failure ).toHaveCount( 0 );

	// A pull request address from somewhere else, refused before anything is
	// asked of GitHub. The card gives a sentence a full stop when it ends
	// without one, which a bracketed one always does, and that full stop is
	// translated too (#630): the whole line is one translated string.
	await card.getByRole( 'tab', { name: pseudoLocalize( 'Pull request' ), exact: true } ).click();
	await card.getByLabel( pseudoLocalize( 'Pull request URL or number' ), { exact: true } ).fill( 'https://gitlab.com/WordPress/wordpress-develop/pull/7' );
	await card.getByRole( 'button', { name: pseudoLocalize( 'Apply PR' ), exact: true } ).click();
	const elsewhere = pseudoLocalize( '%s.' ).replace( '%s', pseudoLocalize( 'Only github.com pull requests are supported.' ) );
	await expect( card.getByText( elsewhere, { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// A pull request's preview, read from a stand-in for its fetch: what it
	// changes, and that dependencies will be installed.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'git:preview-pr' );
		ipcMain.handle( 'git:preview-pr', ( _event, _sitePath, number ) => ( {
			ok: true, number, headOid: 'a'.repeat( 40 ), files: [ { kind: 'modify', path: 'src/wp-login.php' }, { kind: 'modify', path: 'package-lock.json' } ], needsInstall: true, exists: false, moved: false, hasEdits: false, returnTo: 'trunk',
		} ) );
	} );
	await card.getByLabel( pseudoLocalize( 'Pull request URL or number' ), { exact: true } ).fill( '7' );
	await card.getByRole( 'button', { name: pseudoLocalize( 'Apply PR' ), exact: true } ).click();
	await expect( preview.getByText( pseudoLocalize( 'PR #%1$d changes %2$d files.' ).replace( '%1$d', '7' ).replace( '%2$d', '2' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( ( await unwrapped( preview ) ).filter( ( text ) => ! [ FILE, 'package-lock.json' ].includes( text ) ) ).toEqual( [] );
	await preview.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ).click();
	await expect( preview ).toHaveCount( 0 );

	// A patch that fits, once it is applied: the notice that names it.
	write( site.dir, LOGIN, '<?php // trunk\n' );
	const fitting = makePatchFile( session, 'fitting.patch', [ { file: 'wp-login.php', from: '<?php // trunk', to: '<?php // patched' } ] );
	await card.getByRole( 'tab', { name: pseudoLocalize( 'Diff' ), exact: true } ).click();
	await session.answerFileDialog( [ fitting ] );
	await choose.click();
	await apply.click();
	const revert = card.getByRole( 'button', { name: pseudoLocalize( 'Revert this patch' ), exact: true } );
	await expect( revert ).toBeVisible( { timeout: 60_000 } );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // patched\n' );
	await expect( card.getByText( /^\[fitting\.patch / ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );
} );

// The ticket and branch notices (#629) read and write the checkout itself, so
// these journeys build theirs with the same helpers the English ones use.
const gitSite = require( '../helpers/git-site.cjs' );
const { git, commitFiles } = require( '../../unit/helpers/git.cjs' );

/**
 * A string as the pseudo-locale shows it, with its placeholders filled in
 * order, as `sprintf` fills them.
 *
 * @param {string}             text
 * @param {...(string|number)} values
 * @return {string}
 */
function filled( text, ...values ) {
	let out = pseudoLocalize( text );
	for ( const value of values ) out = out.replace( /%(?:\d\$)?[sd]/, String( value ) );
	return out;
}

/**
 * The words of a link inside a translated sentence, as the pseudo-locale
 * shows them: accented, and without the sentence's brackets, which are the
 * sentence's and not the link's.
 *
 * @param {string} text
 * @return {string}
 */
function inSentence( text ) {
	return pseudoLocalize( text ).replace( /^\[/, '' ).replace( /~*\]$/, '' );
}

test( 'the ticket card\'s questions and notices are fully translatable: a refused number, loose edits on trunk, the edits carried or saved, and a trunk that moved', async ( { session } ) => {
	// A ticket's number is the ticket's, and is left out of the scan. So are
	// the two links inside the changes note: their words are part of its
	// sentence, which is checked whole.
	const NUMBERS = [ '#60001', '#60002' ];
	const LINKS = [ inSentence( 'review and submit' ), inSentence( 'discard your changes' ) ];
	const site = await gitSite.makeSite( session );
	const savedTo = path.join( session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-saved-' ) ) ), 'trunk-edits.diff' );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain, dialog }, saveTo ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', ticket: null, items: [] } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
		dialog.showSaveDialog = async () => ( { canceled: false, filePath: saveTo } );
	}, savedTo );
	const question = ui.confirmDialog( page );
	const card = ui.workItemCard( page, pseudoLocalize( 'Trac ticket' ) );
	const field = card.getByLabel( pseudoLocalize( 'Ticket number or URL' ), { exact: true } );
	const linkButton = card.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } );
	const button = ( name ) => card.getByRole( 'button', { name, exact: true } );
	const unlink = button( pseudoLocalize( 'Unlink' ) );
	const inCard = async () => ( await unwrapped( card ) ).filter( ( text ) => ! NUMBERS.includes( text ) && ! LINKS.includes( text ) );

	// A number that is not one: main's refusal.
	await expect( card ).toBeVisible( { timeout: 30_000 } );
	await field.fill( 'not-a-ticket' );
	await linkButton.click();
	await expect( card.getByText( filled( 'Enter a ticket number like 62281, or a %s ticket URL.', 'core.trac.wordpress.org' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( await inCard() ).toEqual( [] );

	// Loose edits on trunk, then a ticket: the question about them. Its
	// discard asks first, in words of its own.
	gitSite.write( site.dir, gitSite.LOGIN, '<?php // loose\n' );
	await field.fill( '60001' );
	await linkButton.click();
	const carry = button( filled( 'Take these edits into #%s', 60001 ) );
	await expect( carry ).toBeVisible( { timeout: 30_000 } );
	await expect( card.getByText( filled( 'You have %d uncommitted change on this site, not on any ticket yet. What should happen to them?', 1 ), { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );
	await button( pseudoLocalize( 'Discard them and start clean' ) ).click();
	await expect( question ).toHaveAccessibleName( pseudoLocalize( 'Discard the uncommitted edits on trunk?' ) );
	await expect( question.getByRole( 'button', { name: pseudoLocalize( 'Discard edits' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( question ) ).toEqual( [] );
	await question.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ).click();
	await expect( question ).toHaveCount( 0 );

	// Carried: where they went, and the note about them on the ticket, whose
	// sentence holds its two links. The note's discard asks first too.
	await carry.click();
	await expect( card.getByText( filled( 'Your %1$d uncommitted change came along into #%2$s, and will go into its patch.', 1, 60001 ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	const discard = button( LINKS[ 1 ] );
	await expect( discard ).toBeVisible( { timeout: 30_000 } );
	await expect( discard.locator( 'xpath=..' ) ).toHaveText( filled( 'You have %1$d unsubmitted change for ticket #%2$s. You can <review>review and submit</review> or <discard>discard your changes</discard>.', 1, 60001 ).replace( /<\/?(?:review|discard)>/g, '' ) );
	await expect( card.getByText( pseudoLocalize( 'Unlinking this ticket doesn\'t affect your local changes for this ticket — they remain attached to it in this site, ready for when you link it again.' ), { exact: true } ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );
	await discard.click();
	await expect( question ).toHaveAccessibleName( pseudoLocalize( 'Discard all local changes?' ) );
	await expect( question.getByRole( 'button', { name: pseudoLocalize( 'Discard changes' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( question ) ).toEqual( [] );
	await question.getByRole( 'button', { name: pseudoLocalize( 'Cancel' ), exact: true } ).click();
	await expect( question ).toHaveCount( 0 );

	// Parked, with trunk moved on under it: the notice that offers the move.
	await unlink.click();
	await expect( linkButton ).toBeVisible( { timeout: 30_000 } );
	gitSite.write( site.dir, gitSite.DOOMED, '<?php // trunk moved this\n' );
	commitFiles( site.dir, [ gitSite.DOOMED ], 'trunk moves on' );
	await page.getByRole( 'button', { name: `${ pseudoLocalize( 'Continue working' ) } #60001`, exact: true } ).click();
	await expect( card.getByText( pseudoLocalize( 'Trunk has moved since this ticket started.' ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( button( pseudoLocalize( 'Update this ticket to the current trunk' ) ) ).toBeVisible();
	expect( await inCard() ).toEqual( [] );

	// Loose edits on trunk again, saved as a patch before another ticket
	// starts clean: where they went.
	await unlink.click();
	await expect( linkButton ).toBeVisible( { timeout: 30_000 } );
	gitSite.write( site.dir, gitSite.LOGIN, '<?php // loose again\n' );
	await field.fill( '60002' );
	await linkButton.click();
	await button( pseudoLocalize( 'Save them as a patch, then start clean…' ) ).click( { timeout: 30_000 } );
	await expect( card.getByText( filled( 'Your edits were saved to %s and are no longer in the working tree.', savedTo ), { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( await inCard() ).toEqual( [] );
} );

test( 'what a ticket from a link says is fully translatable, with no site to put it in', async ( { session } ) => {
	const { app, page } = await session.start( undefined, { lang: 'en-XA' } );
	await expect( page.getByRole( 'button', { name: pseudoLocalize( 'Create site' ), exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await app.evaluate( ( { app: electronApp }, url ) => {
		electronApp.emit( 'open-url', { preventDefault() {} }, url );
	}, 'wpct://ticket/62281' );
	const notice = page.getByRole( 'status' ).filter( { hasText: filled( 'Ticket #%s is ready to link.', 62281 ) } );
	await expect( notice ).toBeVisible( { timeout: 30_000 } );
	await expect( notice.getByRole( 'button', { name: pseudoLocalize( 'Dismiss' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( notice ) ).toEqual( [] );
} );

test( 'what a ticket from a link says is fully translatable, on a Core site that can take it and on a Gutenberg site that cannot', async ( { session } ) => {
	// Two sites: the link asks to be linked on the Core one, and is refused
	// by name on the Gutenberg one. The sites' names are in the sentences,
	// which are each one string.
	const core = await gitSite.makeSite( session, { label: 'core-site' } );
	const gutenberg = await gitSite.makeSite( session, { label: 'gutenberg-site' } );
	const settings = {
		sites: [ core.dir, gutenberg.dir ],
		siteMeta: {
			...core.settings.siteMeta,
			[ gutenberg.dir ]: { ...gutenberg.settings.siteMeta[ gutenberg.dir ], projectType: 'gutenberg' },
		},
		preferences: {},
	};
	const { app, page } = await session.start( settings, { lang: 'en-XA' } );
	const arrive = () => app.evaluate( ( { app: electronApp }, url ) => {
		electronApp.emit( 'open-url', { preventDefault() {} }, url );
	}, 'wpct://ticket/62281' );

	// The Core site: the question, and its two answers.
	await ui.sidebarEntry( page, 'core-site' ).click( { timeout: 30_000 } );
	await expect( page.getByRole( 'heading', { name: 'core-site', exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await arrive();
	const ask = page.getByRole( 'status' ).filter( { hasText: filled( 'Link ticket #%1$s to %2$s?', 62281, 'core-site' ) } );
	await expect( ask ).toBeVisible( { timeout: 30_000 } );
	await expect( ask.getByRole( 'button', { name: pseudoLocalize( 'Link ticket' ), exact: true } ) ).toBeVisible();
	await expect( ask.getByRole( 'button', { name: pseudoLocalize( 'Not now' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( ask ) ).toEqual( [] );
	await ask.getByRole( 'button', { name: pseudoLocalize( 'Not now' ), exact: true } ).click();
	await expect( ask ).toHaveCount( 0 );

	// The Gutenberg site: the refusal, and the button that hides it.
	await ui.sidebarEntry( page, 'gutenberg-site' ).click();
	await expect( page.getByRole( 'heading', { name: 'gutenberg-site', exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await arrive();
	const refused = page.getByRole( 'status' ).filter( { hasText: filled( 'Ticket #%1$s cannot be linked to %2$s.', 62281, 'gutenberg-site' ) } );
	await expect( refused ).toBeVisible( { timeout: 30_000 } );
	await expect( refused.getByRole( 'button', { name: pseudoLocalize( 'Hide' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( refused ) ).toEqual( [] );
} );

test( 'the notices for a merge left open by a terminal and for a site an earlier version made are fully translatable', async ( { session } ) => {
	// A merge stopped on its conflict, made by the bundled Git the way a
	// terminal would make it (as in merge-in-progress.spec.js), and a site
	// shaped the way the old engine cloned it (as in legacy-site.spec.js).
	const merging = await gitSite.makeSite( session, { label: 'merging-site' } );
	gitOk( [ 'checkout', '-q', '-b', 'mentor/fix' ], merging.dir );
	gitSite.write( merging.dir, gitSite.LOGIN, '<?php // the mentor\'s fix\n' );
	commitFiles( merging.dir, [ gitSite.LOGIN ], 'the mentor\'s fix' );
	gitOk( [ 'checkout', '-q', 'trunk' ], merging.dir );
	gitSite.write( merging.dir, gitSite.LOGIN, '<?php // trunk moved too\n' );
	commitFiles( merging.dir, [ gitSite.LOGIN ], 'trunk moves' );
	expect( git( [ '-c', 'user.name=mentor', '-c', 'user.email=mentor@example.com', 'merge', 'mentor/fix' ], merging.dir ).status ).toBe( 1 );
	const legacy = await gitSite.makeSite( session, { label: 'legacy-site', legacy: true } );
	const { page } = await session.start( {
		sites: [ merging.dir, legacy.dir ],
		siteMeta: { ...merging.settings.siteMeta, ...legacy.settings.siteMeta },
		preferences: {},
	}, { lang: 'en-XA' } );

	await ui.sidebarEntry( page, 'merging-site' ).click( { timeout: 30_000 } );
	const merge = page.getByRole( 'alert' ).filter( { hasText: pseudoLocalize( 'A merge started outside the app is in progress.' ) } );
	await expect( merge ).toBeVisible( { timeout: 30_000 } );
	await expect( merge.getByText( filled(
		'It has conflicts in %1$s. Finish it from a terminal (%2$s) or abandon it (%3$s) before using the app on this site. Until then, linking tickets, applying patches, discarding changes and updating trunk are refused here.',
		'src/wp-login.php',
		filled( 'resolve the files, then git add them and run %s', 'git commit' ),
		'git merge --abort'
	), { exact: true } ) ).toBeVisible();
	expect( await unwrapped( merge ) ).toEqual( [] );

	await ui.sidebarEntry( page, 'legacy-site' ).click();
	const old = page.getByRole( 'alert' ).filter( { hasText: pseudoLocalize( 'This site was created by an earlier version of the app.' ) } );
	await expect( old ).toBeVisible( { timeout: 30_000 } );
	await expect( old.getByRole( 'button', { name: pseudoLocalize( 'Create site' ), exact: true } ) ).toBeVisible();
	expect( await unwrapped( old ) ).toEqual( [] );
} );

test( 'what the window says when a folder will not open is fully translatable, for each reason', async ( { session } ) => {
	// The application is answered by a stand-in, as in site-header.spec.js,
	// and each attempt to open the folder with it by the reason under test.
	// The application's name is its own, and the operating system's reason
	// is quoted inside the app's sentence.
	const site = await gitSite.makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eOpenAnswer = null;
		const answers = {
			'editor:list': () => ( { detected: [ { name: 'Example Editor', path: '/example' } ] } ),
			'editor:open': () => {
				if ( global.__e2eOpenAnswer === 'throw' ) throw new Error( 'stand-in failure' );
				return global.__e2eOpenAnswer;
			},
			'dir:show': () => ( { ok: false, reason: 'open-failed', error: 'stand-in reason' } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	} );
	const menuButton = page.getByRole( 'button', { name: pseudoLocalize( 'Site actions' ), exact: true } );
	await expect( menuButton ).toBeVisible( { timeout: 30_000 } );
	const menu = page.getByRole( 'menu', { name: pseudoLocalize( 'Site actions' ) } );
	const openWith = async ( answer ) => {
		await app.evaluate( ( electron, value ) => {
			global.__e2eOpenAnswer = value;
		}, answer );
		await menuButton.click();
		// Rested on, as a pointer does, and not clicked: see site-header.spec.js.
		await menu.getByRole( 'menuitem', { name: pseudoLocalize( 'Open in' ), exact: true } ).hover();
		await page.getByRole( 'menuitem', { name: 'Example Editor', exact: true } ).click();
	};
	const notice = ( text ) => page.getByRole( 'alert' ).filter( { has: page.getByText( text, { exact: true } ) } );
	const scanned = async ( text ) => {
		await expect( notice( text ) ).toBeVisible( { timeout: 30_000 } );
		expect( await unwrapped( notice( text ) ) ).toEqual( [] );
	};

	await openWith( { ok: false, reason: 'unknown-editor' } );
	await scanned( pseudoLocalize( 'That application is no longer where it was. Choose another.' ) );
	await expect( notice( pseudoLocalize( 'That application is no longer where it was. Choose another.' ) ).getByRole( 'button', { name: pseudoLocalize( 'Choose application…' ), exact: true } ) ).toBeVisible();

	// Picked with the button the notice offers: not an application at all.
	await app.evaluate( () => {
		global.__e2eOpenAnswer = { ok: false, reason: 'unlaunchable-editor' };
	} );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Choose application…' ), exact: true } ).click();
	await scanned( pseudoLocalize( 'That is not an application this app can open a folder in.' ) );

	await openWith( { ok: false, reason: 'spawn-failed', error: 'stand-in reason' } );
	await scanned( filled( 'The application would not start: %s', 'stand-in reason' ) );
	await openWith( { ok: false, reason: 'spawn-failed' } );
	await scanned( filled( 'The application would not start: %s', pseudoLocalize( 'unknown error' ) ) );
	await openWith( { ok: false, reason: 'unregistered-site' } );
	await scanned( pseudoLocalize( 'This app has no record of that folder, so it will not open it.' ) );
	await openWith( { ok: false, reason: 'something-else' } );
	await scanned( pseudoLocalize( 'Could not open the folder.' ) );
	// A handler that throws: Electron's own words for that are quoted, so
	// the notice is found by the start of the app's sentence.
	await openWith( 'throw' );
	const unreachable = page.getByRole( 'alert' ).filter( { hasText: pseudoLocalize( 'Could not reach the app\'s main process: %s' ).split( '%s' )[ 0 ] } );
	await expect( unreachable ).toBeVisible( { timeout: 30_000 } );
	expect( await unwrapped( unreachable ) ).toEqual( [] );

	// The file manager's own refusal, from the menu's other way in.
	await menuButton.click();
	await menu.getByRole( 'menuitem', { name: /^\[Šĥóŵ íñ / } ).click();
	await scanned( filled( 'The file manager would not open the folder: %s', 'stand-in reason' ) );
} );

test( 'a mail the site sent is fully translatable, on its Rendered and its Raw tab', async ( { session } ) => {
	// One mail in the store, loaded when the server starts, which is answered
	// by stand-ins as in mail.spec.js. What the mail says is the site's, and
	// is left out of the scan.
	const MAIL = {
		id: 'e2e-reset',
		subject: '[Test Site] Password Reset',
		from: 'WordPress <wordpress@example.test>',
		to: 'admin@example.test',
		cc: 'auditor@example.test',
		date: '2026-08-10T09:30:00.000Z',
		sentAt: '2026-08-10T09:30:00.000Z',
		text: 'A password reset was requested.',
		html: '<p>Someone has requested a <strong>password reset</strong>.</p>',
		headers: {},
		raw: 'Subject: [Test Site] Password Reset\nX-Mailer: PHPMailer\n\nA password reset was requested.',
	};
	// No subject: the dialog has to be titled by the app instead.
	const UNTITLED = { ...MAIL, id: 'e2e-untitled', subject: '', cc: undefined, sentAt: '2026-08-10T09:00:00.000Z', date: '2026-08-10T09:00:00.000Z' };
	const theMails = ( text ) => [ MAIL.subject, MAIL.from, MAIL.to, MAIL.cc, MAIL.raw, 'Someone has requested a password reset.' ].some( ( part ) => part.includes( text ) ) || text.includes( '2026' );
	const site = await makeSite( session );
	const { app, page } = await session.start( { ...site.settings, [ `siteMail:${ site.dir }` ]: [ MAIL, UNTITLED ] }, { lang: 'en-XA' } );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-mail' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async () => ( { ok: true } ) );
	} );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Start development server' ), exact: true } ).click( { timeout: 30_000 } );
	await page.getByRole( 'button', { name: pseudoLocalize( 'Toggle Email' ), exact: true } ).click();
	await page.getByRole( 'button', { name: /\[Test Site\] Password Reset$/ } ).click( { timeout: 30_000 } );

	const dialog = page.getByRole( 'dialog', { name: MAIL.subject } );
	await expect( dialog.getByRole( 'tab', { name: pseudoLocalize( 'Rendered' ), exact: true } ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( dialog.getByText( pseudoLocalize( 'CC:' ), { exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( dialog ) ).filter( ( text ) => ! theMails( text ) ) ).toEqual( [] );
	// The HTML part is drawn in a frame, named by its title, which is an
	// attribute unwrapped() does not collect.
	await expect( dialog.locator( 'iframe' ) ).toHaveAttribute( 'title', pseudoLocalize( 'Mail' ) );

	await dialog.getByRole( 'tab', { name: pseudoLocalize( 'Raw' ), exact: true } ).click();
	await expect( dialog.getByText( 'X-Mailer: PHPMailer' ) ).toBeVisible();
	expect( ( await unwrapped( dialog ) ).filter( ( text ) => ! theMails( text ) ) ).toEqual( [] );

	await page.keyboard.press( 'Escape' );
	await page.getByRole( 'button', { name: new RegExp( `${ pseudoLocalize( '(no subject)' ).replace( /[[\]()]/g, '\\$&' ) }$` ) } ).click();
	const untitled = page.getByRole( 'dialog', { name: pseudoLocalize( 'Email' ), exact: true } );
	await expect( untitled ).toBeVisible();
	expect( ( await unwrapped( untitled ) ).filter( ( text ) => ! theMails( text ) ) ).toEqual( [] );
} );

test( 'the Playground web server is fully translatable, stopped, starting, running and after it exits', async ( { session } ) => {
	// The server is offered only where a build ships it, which a checkout
	// does not, and the page asks as it mounts: so the stand-ins are in
	// place before the window is. Starting is never answered; the test says
	// what the main process would say instead. With no site, the server is
	// above the middle of the window, and that is what is scanned.
	const URL = 'http://127.0.0.1:39372/';
	await session.start( undefined, { lang: 'en-XA' } );
	const { app, page } = await session.restart( { beforeWindow: ( launched ) => launched.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'playground-web:available' );
		ipcMain.handle( 'playground-web:available', () => true );
		ipcMain.removeHandler( 'playground-web:start' );
		ipcMain.handle( 'playground-web:start', () => new Promise( () => {} ) );
	} ) } );
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( to, what );
	}, [ channel, payload ] );
	const notices = page.locator( '.page-body-notices' );
	const SERVER_OUTPUT = 'listening for requests';

	await page.getByRole( 'button', { name: pseudoLocalize( 'Start Playground web server' ), exact: true } ).click( { timeout: 30_000 } );
	await expect( page.getByText( pseudoLocalize( 'Playground web server' ), { exact: true } ) ).toBeVisible();
	await expect( page.getByText( pseudoLocalize( 'Starting…' ), { exact: true } ).first() ).toBeVisible();
	expect( await unwrapped( notices ) ).toEqual( [] );
	// The button says it is starting through a live region, outside the
	// notices, so that is read on its own.
	await expect( page.locator( '#a11y-speak-polite' ) ).toHaveText( pseudoLocalize( 'Starting the Playground web server' ) );

	await tell( 'playground-web:log', { type: 'stdout', data: `${ SERVER_OUTPUT }\n` } );
	await tell( 'playground-web:url', { url: URL } );
	await expect( page.getByRole( 'button', { name: pseudoLocalize( 'Stop Playground web server' ), exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( notices ) ).filter( ( text ) => text !== URL && text !== SERVER_OUTPUT ) ).toEqual( [] );

	await tell( 'playground-web:stopped', { code: 1 } );
	await expect( page.getByText( pseudoLocalize( 'Stopped' ), { exact: true } ) ).toBeVisible();
	await expect( page.getByText( pseudoLocalize( 'Server exited with code %d' ).replace( '%d', '1' ), { exact: true } ) ).toBeVisible();
	expect( ( await unwrapped( notices ) ).filter( ( text ) => text !== SERVER_OUTPUT ) ).toEqual( [] );
} );
