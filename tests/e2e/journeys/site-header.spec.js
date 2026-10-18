/**
 * The open site's header and its details (#556).
 *
 * The page's header is the window's, and what is in it is the open site's:
 * the button that shows and hides the site's details, and the site's menu,
 * which holds everything that is done to a site as a whole. The window leaves
 * a place in the header and the open site's view fills it, so the thing to
 * hold is that the header always acts on the site that is open, and on no
 * other.
 *
 * The details are the facts about the checkout that do not change while a
 * contributor works. They can be put away, and that is the window's choice,
 * not one site's: it stays as it was left when another site is opened. Put
 * away, they are out of reach of a screen reader and the keyboard too.
 *
 * What the menu offers and when is `site-menu.cjs`'s, held by its unit tests.
 * Renaming, updating and deleting from the menu are `rename-site.spec.js`,
 * `trunk-update.spec.js` and `engine.spec.js`. This is the rest: copying the
 * path, and opening the folder.
 *
 * Nothing is opened. The three handlers that look for applications, open the
 * folder in one and show it in the file manager are answered by stubs that
 * keep what they were asked, so the journey says the same on a machine with
 * no editor installed as on one with five. What that leaves out is everything
 * the main process does before it opens anything: checking the application
 * it was named against a fresh look at the machine, which is what stops the
 * page from naming any program at all; asking which application through the
 * system's file dialog, and the answer when that is cancelled; and refusing a
 * folder that is not a listed site, or one still being set up. Those are the
 * main process's, with unit tests of their own.
 *
 * Copying is asked of a stand-in too: the clipboard is the person's who runs
 * the suite, so the page's write to it is replaced by one that keeps the
 * text. What that leaves out is the clipboard itself refusing. The sites are
 * folders with no checkout in them, which is all the header and the details
 * need of one.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );

const DAY = 24 * 60 * 60 * 1000;
const EDITOR = { name: 'Example Editor', path: path.join( os.tmpdir(), 'example-editor' ) };
// The name of the entry of a site whose trunk is thirty days old: what its
// mark says comes after the site's own name.
const OLD_TRUNK_ENTRY = 'old-trunk (WordPress code is 30 days old — update to latest trunk)';
// The applications are in a menu of their own, under the site's menu.
const applicationItem = ( page, name ) => page.getByRole( 'menuitem', { name, exact: true } );
// Opens that menu the way a pointer does, by resting on "Open in", and waits
// for it. Not by a click: the pointer arriving opens the menu a moment later
// by itself, and a click that lands after that closes it again.
async function openApplications( page ) {
	await page.getByRole( 'menuitem', { name: 'Open in', exact: true } ).hover();
	await applicationItem( page, 'Other application…' ).waitFor();
}

// The button that puts the details away and the one that brings them back:
// one button, named by what pressing it does.
const hideDetailsButton = ( page ) => page.getByRole( 'button', { name: 'Hide details', exact: true } );
const showDetailsButton = ( page ) => page.getByRole( 'button', { name: 'Show details', exact: true } );
// The open site's details. A site that is not open has details too, in its
// hidden view, which this does not find.
const details = ( page, label ) => page.getByRole( 'complementary', { name: `Details of ${ label }`, exact: true } );

/**
 * Settings for an app that knows the given sites, oldest first, each a folder
 * of its own with a trunk recent enough to have nothing to report.
 *
 * @param {Object}   session
 * @param {Object[]} sites   `{ label, ...meta }`.
 * @return {{dirs: string[], settings: Object}}
 */
function listedSites( session, sites ) {
	const settings = { sites: [], siteMeta: {}, preferences: {} };
	const dirs = sites.map( ( { label, ...meta }, index ) => {
		const dir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-site-' ) ) );
		fs.mkdirSync( path.join( dir, 'wp-content' ), { recursive: true } );
		settings.sites.push( dir );
		settings.siteMeta[ dir ] = {
			initialized: true,
			createdAt: new Date( Date.now() - ( sites.length - index ) * DAY ).toISOString(),
			label,
			trunkDate: new Date( Date.now() - DAY ).toISOString(),
			skipInitWizard: true,
			...meta,
		};
		return dir;
	} );
	return { dirs, settings };
}

/**
 * Stands in for the three handlers that touch other applications, and keeps
 * what each was asked. Opening a folder answers that it worked until
 * `answerOpenWith` says otherwise.
 *
 * @param {Object} app
 * @return {Promise<{asked: Function, answerOpenWith: Function}>}
 */
async function standInForApplications( app ) {
	await app.evaluate( ( { ipcMain }, editor ) => {
		const asked = { lists: 0, opens: [], shows: [] };
		global.__e2eApplications = asked;
		global.__e2eOpenAnswer = { ok: true };
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'editor:list', () => {
			asked.lists += 1;
			return { detected: [ editor ] };
		} );
		replace( 'editor:open', ( event, sitePath, editorPath ) => {
			asked.opens.push( { sitePath, editorPath } );
			return global.__e2eOpenAnswer;
		} );
		replace( 'dir:show', ( event, sitePath ) => {
			asked.shows.push( sitePath );
			return { ok: true };
		} );
	}, EDITOR );
	return {
		asked: () => app.evaluate( () => global.__e2eApplications ),
		answerOpenWith: ( answer ) => app.evaluate( ( electron, value ) => {
			global.__e2eOpenAnswer = value;
		}, answer ),
	};
}

// Replaces the page's write to the clipboard with one that keeps the text.
const standInForClipboard = ( page ) => page.evaluate( () => {
	window.__e2eCopied = [];
	navigator.clipboard.writeText = async ( text ) => {
		window.__e2eCopied.push( text );
	};
} );
const copied = ( page ) => page.evaluate( () => window.__e2eCopied );

test( 'the header\'s menu acts on the site that is open: it copies that site\'s path and opens that site\'s folder', async ( { session } ) => {
	const { dirs, settings } = listedSites( session, [ { label: 'older-site' }, { label: 'newer-site' } ] );
	const [ olderDir, newerDir ] = dirs;
	const { app, page } = await session.start( settings );
	const applications = await standInForApplications( app );
	await standInForClipboard( page );
	await expect( ui.siteHeading( page, 'newer-site' ) ).toBeVisible( { timeout: 30_000 } );
	const menu = page.getByRole( 'menu', { name: 'Site actions' } );

	const OWN_ITEMS = [ 'Rename…', 'Copy path', /^Show in /, 'Update to latest trunk', 'Open in', 'Delete site' ];

	// INVARIANT — the menu looks for applications as it opens, and its own
	// list does not wait for the answer.
	await ui.siteMenuButton( page ).click();
	await expect( menu.getByRole( 'menuitem' ) ).toHaveText( OWN_ITEMS );
	await expect.poll( async () => ( await applications.asked() ).lists ).toBe( 1 );

	// INVARIANT — copying the path puts the open site's path on the
	// clipboard, and says so where it will be seen with the menu gone.
	await menu.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	await expect( ui.toast( page, 'Copied the path' ) ).toBeVisible();
	expect( await copied( page ) ).toEqual( [ newerDir ] );
	await expect( menu ).toHaveCount( 0 );
	// INVARIANT — and says so once: the button in the details, which says it
	// on itself when it is the one pressed, has not changed. Read once and
	// not waited for: a button that had changed would change back by itself
	// a moment later, and it would have changed before the toast was raised.
	expect( await details( page, 'newer-site' ).getByRole( 'button', { name: 'Copied', exact: true } ).count() ).toBe( 0 );

	// INVARIANT — under "Open in" are the way to choose an application,
	// always, and each one that was found, by its name; and with them on
	// screen the menu's own list is what it was, so nothing a contributor was
	// about to press there has moved.
	await ui.siteMenuButton( page ).click();
	await openApplications( page );
	// CHARACTERISATION — the way to choose is first, where what arrives
	// later cannot move it. That a row never moves is the module's, with a
	// unit test that walks the lists before and after an answer.
	await expect( page.getByRole( 'menu', { name: 'Open in' } ).getByRole( 'menuitem' ) ).toHaveText( [ 'Other application…', EDITOR.name ] );
	await expect( menu.getByRole( 'menuitem' ) ).toHaveText( OWN_ITEMS );

	// INVARIANT — opening in a named application asks for this site's folder
	// in that application; "other application" asks with none named, which is
	// what makes the main process ask which.
	await applicationItem( page, EDITOR.name ).click();
	await expect.poll( async () => ( await applications.asked() ).opens ).toEqual( [ { sitePath: newerDir, editorPath: EDITOR.path } ] );
	await ui.siteMenuButton( page ).click();
	await openApplications( page );
	await applicationItem( page, 'Other application…' ).click();
	await expect.poll( async () => ( await applications.asked() ).opens ).toEqual( [
		{ sitePath: newerDir, editorPath: EDITOR.path },
		{ sitePath: newerDir, editorPath: null },
	] );

	// INVARIANT — with another site open, the same header acts on that one.
	await ui.sidebarEntry( page, 'older-site' ).click();
	await expect( ui.siteHeading( page, 'older-site' ) ).toBeVisible();
	await expect( page.getByRole( 'button', { name: 'Site actions', exact: true } ) ).toHaveCount( 1 );
	await ui.siteMenuButton( page ).click();
	// CHARACTERISATION — the file manager's name is the platform's.
	await menu.getByRole( 'menuitem', { name: /^Show in (Finder|Explorer|file manager)$/ } ).click();
	await expect.poll( async () => ( await applications.asked() ).shows ).toEqual( [ olderDir ] );
	await ui.siteMenuButton( page ).click();
	await menu.getByRole( 'menuitem', { name: 'Copy path', exact: true } ).click();
	await expect.poll( () => copied( page ) ).toEqual( [ newerDir, olderDir ] );
} );

test( 'an application that will not open the folder says why on the page, with the way to choose another', async ( { session } ) => {
	const { dirs, settings } = listedSites( session, [ { label: 'only-site' } ] );
	const siteDir = dirs[ 0 ];
	const { app, page } = await session.start( settings );
	const applications = await standInForApplications( app );
	await expect( ui.siteHeading( page, 'only-site' ) ).toBeVisible( { timeout: 30_000 } );
	await applications.answerOpenWith( { ok: false, reason: 'unlaunchable-editor' } );

	// The header does not scroll, so its menu can be used from the bottom of
	// the page, where the top of it, which is where a refusal is said, is out
	// of sight. With the terminal, the logs and the mail in the tray (#558)
	// a page is not much taller than a window, and the tray, which takes its
	// room from the page, is what makes this one long enough to scroll that
	// far: at its largest, half the window, on a screen of any height.
	await ui.openTray( page, 'Terminal' );
	await page.getByRole( 'separator', { name: 'Resize tray', exact: true } ).focus();
	await page.keyboard.press( 'End' );
	await ui.ticketField( page ).hover();
	await page.mouse.wheel( 0, 2000 );
	await expect( ui.ticketField( page ) ).not.toBeInViewport();

	// INVARIANT — the menu is gone by the time the answer comes, so the
	// refusal is said on the page, where it can be seen, and it carries the
	// way out with it.
	await ui.siteMenuButton( page ).click();
	await openApplications( page );
	await applicationItem( page, EDITOR.name ).click();
	const refusal = page.getByRole( 'alert' ).filter( { hasText: 'That application is no longer where it was. Choose another.' } );
	await expect( refusal ).toBeInViewport();
	await applications.answerOpenWith( { ok: true } );
	await refusal.getByRole( 'button', { name: 'Choose application…', exact: true } ).click();
	await expect.poll( async () => ( await applications.asked() ).opens ).toEqual( [
		{ sitePath: siteDir, editorPath: EDITOR.path },
		{ sitePath: siteDir, editorPath: null },
	] );
	// INVARIANT — and once an open has worked, the refusal is gone.
	await expect( refusal ).toHaveCount( 0 );
} );

test( 'the details say what the checkout is, copy its path, and can be put away for every site at once', async ( { session } ) => {
	const { dirs, settings } = listedSites( session, [
		{ label: 'old-trunk', projectType: 'gutenberg', trunkDate: new Date( Date.now() - 30 * DAY ).toISOString() },
		{ label: 'fresh-site' },
	] );
	const [ oldDir, freshDir ] = dirs;
	const { page } = await session.start( settings );
	await standInForClipboard( page );
	await expect( ui.siteHeading( page, 'fresh-site' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the details are the open site's: its folder, its project
	// with the PHP a server starts on and which debug constants are on, both
	// from the settings at their fallbacks (#559), and that its setup is
	// done. A recent trunk has no age to report.
	const fresh = details( page, 'fresh-site' );
	await expect( fresh.getByRole( 'heading', { name: 'Details', exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( freshDir, { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( 'WordPress Core · PHP 8.3', { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( 'WP_DEBUG · SCRIPT_DEBUG', { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( 'Initialized', { exact: true } ) ).toBeVisible();
	await expect( fresh.getByText( /days? old$/ ) ).toHaveCount( 0 );

	// INVARIANT — their button copies the path and says so itself, for the
	// moment it takes to notice.
	await fresh.getByRole( 'button', { name: 'Copy', exact: true } ).click();
	await expect( fresh.getByRole( 'button', { name: 'Copied', exact: true } ) ).toBeVisible();
	await expect( fresh.getByRole( 'status' ) ).toHaveText( 'Copied' );
	expect( await copied( page ) ).toEqual( [ freshDir ] );
	await expect( fresh.getByRole( 'button', { name: 'Copy', exact: true } ) ).toBeVisible();
	// INVARIANT — and the word is taken back, not replaced by another: a
	// screen reader is told that the path was copied, and nothing after.
	await expect( fresh.getByRole( 'status' ) ).toHaveText( '' );

	// INVARIANT — another site's details are that site's, and an old trunk
	// says how old.
	await ui.sidebarEntry( page, OLD_TRUNK_ENTRY ).click();
	await expect( ui.siteHeading( page, 'old-trunk' ) ).toBeVisible();
	const old = details( page, 'old-trunk' );
	await expect( old.getByText( oldDir, { exact: true } ) ).toBeVisible();
	await expect( old.getByText( 'Gutenberg · PHP 8.3', { exact: true } ) ).toBeVisible();
	await expect( old.getByText( '30 days old', { exact: true } ) ).toBeVisible();
	await expect( fresh ).toHaveCount( 0 );

	// INVARIANT — put away, the details are gone for a screen reader and for
	// the keyboard, the button says they are closed, and what it names is
	// still there to be brought back.
	await expect( hideDetailsButton( page ) ).toHaveAttribute( 'aria-expanded', 'true' );
	// The element is found by its id because that is what the button names:
	// the claim is about where `aria-controls` points.
	const controlled = await hideDetailsButton( page ).getAttribute( 'aria-controls' );
	expect( controlled ).toBeTruthy();
	await expect( page.locator( `[id="${ controlled }"]` ).getByRole( 'complementary' ) ).toBeVisible();
	await hideDetailsButton( page ).click();
	await expect( showDetailsButton( page ) ).toHaveAttribute( 'aria-expanded', 'false' );
	await expect( old ).toHaveCount( 0 );
	const hiddenCopy = page.locator( `[id="${ controlled }"]` ).getByRole( 'button', { name: 'Copy', exact: true, includeHidden: true } );
	await expect( hiddenCopy ).toHaveCount( 1 );
	await hiddenCopy.focus();
	await expect( hiddenCopy ).not.toBeFocused();

	// INVARIANT — it is the window's choice and not one site's: the other
	// site opens with its details put away too, and bringing them back there
	// brings them back here.
	await ui.sidebarEntry( page, 'fresh-site' ).click();
	await expect( ui.siteHeading( page, 'fresh-site' ) ).toBeVisible();
	await expect( fresh ).toHaveCount( 0 );
	await showDetailsButton( page ).click();
	await expect( fresh ).toBeVisible();
	await ui.sidebarEntry( page, OLD_TRUNK_ENTRY ).click();
	await expect( old ).toBeVisible();
} );

test( 'the details stay in view while the cards scroll for as long as they fit there, and scroll with the cards when they do not', async ( { session } ) => {
	// A site still in its setup, whose details are the facts alone and whose
	// cards are the taller of the two columns: details that stay put while
	// the cards scroll can only be told from details that go with them where
	// the cards are the taller. With the terminal, the logs and the mail gone
	// to the tray (#558) a site that is set up has it the other way round.
	// The site has no recorded creation date and no trunk date, so its
	// details have two rows fewer: the facts gained a Debugging row (#559),
	// and with every row the facts alone no longer fit over the tray at its
	// smallest on the runners' screens, which the first half below needs
	// them to, with a few pixels to spare and no more.
	const { settings } = listedSites( session, [ { label: 'in-setup', skipInitWizard: false, createdAt: null, trunkDate: null } ] );
	const { app, page } = await session.start( settings );
	// The window opens up to 1280×800, less on a smaller screen, and on a
	// screen that gives it all of that the tray at its largest still leaves
	// the page room for these details, which the second half needs it not
	// to. Sized here as the smallest screens the suite runs on size it, so
	// that both halves hold wherever the suite runs.
	await app.evaluate( ( { BrowserWindow } ) => {
		const win = BrowserWindow.getAllWindows()[ 0 ];
		const [ minWidth, minHeight ] = win.getMinimumSize();
		win.setSize( Math.max( 1024, minWidth ), Math.max( 700, minHeight ) );
	} );
	await expect.poll( () => page.evaluate( () => window.innerHeight ) ).toBeLessThanOrEqual( 700 );
	// Without the glide the app brings a site's next step into view with,
	// which would still be moving the page while this reads where it is.
	await page.emulateMedia( { reducedMotion: 'reduce' } );
	await expect( ui.siteHeading( page, 'in-setup' ) ).toBeVisible( { timeout: 30_000 } );
	// With the sites list put away the page has room for its two columns on
	// the smallest screen the suite runs on, where the window is the screen.
	// In one column the details are at the foot of the page, and none of
	// this applies.
	await page.getByRole( 'button', { name: 'Hide sites list', exact: true } ).click();
	const heading = details( page, 'in-setup' ).getByRole( 'heading', { name: 'Details', exact: true } );
	const firstCard = page.getByText( 'Initial setup checklist', { exact: true } );

	// INVARIANT — a site still in its setup has no server or build watch to
	// offer, in the header or in its details: the checklist is what starts
	// them the first time.
	await expect( ui.processMenuButton( page, 'Server stopped' ) ).toHaveCount( 0 );
	await expect( ui.reviewChangesButton( page ) ).toHaveCount( 0 );
	await expect( details( page, 'in-setup' ).getByRole( 'heading', { name: 'Server', exact: true } ) ).toHaveCount( 0 );

	// The room the page has is the tray's to give: it takes its own from the
	// page, and with it the cards are taller than the page and scroll. What
	// is to spare is read from the page's top, as what is between the foot
	// of the details and the tray. The details start a little way down the
	// page, by its own padding of 24px, and fit for as long as they are no
	// taller than the page, so they fit until there is less than that
	// padding to spare the other way.
	const tray = await ui.openTray( page, 'Terminal' );
	const edge = page.getByRole( 'separator', { name: 'Resize tray', exact: true } );
	const spareRoom = async () => {
		const box = await details( page, 'in-setup' ).boundingBox();
		return ( await tray.boundingBox() ).y - ( box.y + box.height );
	};
	// Read part of the way down the page, from its top, and not at its end,
	// both times: at its end a column that is held is pushed up by whatever
	// it lacks of the room under the cards, and one too tall to hold is
	// pushed out of view like one that was let go.
	const fromTheTop = async () => {
		await firstCard.scrollIntoViewIfNeeded();
		await heading.scrollIntoViewIfNeeded();
		await expect( heading ).toBeInViewport();
	};
	const scrollTheCards = async () => {
		await firstCard.hover();
		await page.mouse.wheel( 0, 100 );
		await expect( firstCard ).not.toBeInViewport();
	};

	// INVARIANT — details that fit stay in view while the cards scroll: the
	// first card has gone and they are still there. CHARACTERISATION — the
	// facts alone fit over the tray at its smallest on the smallest screens
	// the suite runs on, the runners', with a few pixels to spare. The room
	// is read with the page at its top, where the details are where the page
	// puts them. The tray is made smaller for as long as there is none to
	// spare, which is more than is asked: they fit until the page's own
	// padding above them, 24px, is what they are short of.
	await fromTheTop();
	await edge.focus();
	for ( let presses = 0; presses < 20 && ( await spareRoom() ) < 0; presses++ ) await page.keyboard.press( 'ArrowDown' );
	expect( await spareRoom() ).toBeGreaterThanOrEqual( -24 );
	await fromTheTop();
	await scrollTheCards();
	await expect( heading ).toBeInViewport();

	// INVARIANT — details taller than what is in view are let go: they move
	// with the cards, so their end can be reached by scrolling to it.
	// CHARACTERISATION — the tray at its largest, half the window, leaves
	// the page less room than these details need.
	await edge.focus();
	await page.keyboard.press( 'End' );
	await fromTheTop();
	await expect.poll( spareRoom ).toBeLessThan( -24 );
	await scrollTheCards();
	await expect( heading ).not.toBeInViewport();
} );

test( 'a header short of room keeps the site\'s name, and every action in it by its own name', async ( { session } ) => {
	const { settings } = listedSites( session, [ { label: 'a-site-with-a-name-longer-than-most' } ] );
	const { app, page } = await session.start( settings );
	await expect( ui.siteHeading( page, 'a-site-with-a-name-longer-than-most' ) ).toBeVisible( { timeout: 30_000 } );

	// Two widths, each with the sites list open: the width of the smallest
	// screen the suite runs on, where the header is short of room for the
	// processes' words, and the smallest the window can be made, where it is
	// short of room for the review button's too.
	const resizeTo = ( width ) => app.evaluate( ( { BrowserWindow }, wanted ) => {
		const win = BrowserWindow.getAllWindows()[ 0 ];
		const [ minWidth, minHeight ] = win.getMinimumSize();
		win.setSize( Math.max( wanted, minWidth ), Math.max( win.getSize()[ 1 ], minHeight ) );
	}, width );
	for ( const width of [ 1024, 0 ] ) {
		await resizeTo( width );
		await expect.poll( () => page.evaluate( () => window.innerWidth ) ).toBeLessThanOrEqual( Math.max( width, 800 ) );

		// INVARIANT — the site's name is still there. With two menus and a
		// button beside it (#557) it was the name that gave way, to nothing.
		await expect( ui.siteHeading( page, 'a-site-with-a-name-longer-than-most' ) ).toBeVisible();
		// INVARIANT — and everything in the header is still there under the
		// name it has with room: what gives way is clipped for the eye, and
		// nothing is taken from a screen reader or from a journey.
		const server = ui.processMenuButton( page, 'Server stopped' );
		await expect( server ).toBeVisible();
		await expect( ui.processMenuButton( page, 'Build stopped' ) ).toBeVisible();
		await expect( ui.reviewChangesButton( page ) ).toBeVisible();
		await expect( hideDetailsButton( page ) ).toBeVisible();
		await expect( ui.siteMenuButton( page ) ).toBeVisible();
		// INVARIANT — none of it has been pushed out of the window.
		for ( const control of [ ui.reviewChangesButton( page ), ui.siteMenuButton( page ), server ] ) {
			await expect( control ).toBeInViewport( { ratio: 1 } );
		}
	}
} );
