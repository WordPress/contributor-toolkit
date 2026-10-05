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
