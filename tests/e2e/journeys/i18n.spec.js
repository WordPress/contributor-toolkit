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
const { makeSite, makePatchFile } = require( '../helpers/git-site.cjs' );
const { pseudoLocalize } = require( '../../../src/renderer/pseudo-locale.cjs' );

// Names that stay as they are in every language.
const UNTRANSLATED = new Set( [ 'WordPress Core', 'Gutenberg' ] );
// So do the names of WordPress's constants, which the details list (#559).
const CONSTANT_NAMES = /^(WP_DEBUG|SCRIPT_DEBUG)( · (WP_DEBUG|SCRIPT_DEBUG))*$/;

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
	return found.filter( ( text ) => text && ! /^\[[\s\S]*\]$/.test( text ) && ! UNTRANSLATED.has( text ) && ! CONSTANT_NAMES.test( text ) );
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

	// The create-site dialog, including the parts the design system draws
	// itself, such as its Close button.
	await createButton.click();
	const dialog = page.getByRole( 'dialog', { name: pseudoLocalize( 'Create site' ), exact: true } );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByRole( 'button', { name: /^\[/ } ).first() ).toBeVisible();
	expect( await unwrapped( dialog ) ).toEqual( [] );

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

test( 'the Help menu and the native file dialogs are translated in main', async ( { session } ) => {
	// Main's own strings, which the window never renders: they are only
	// translated if main applied the locale before it built them.
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings, { lang: 'en-XA' } );

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
