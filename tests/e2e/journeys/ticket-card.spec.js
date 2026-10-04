/**
 * The work-item card (#557): what a site says of the Trac ticket it is
 * working on, and the work that already exists on that ticket.
 *
 * Linking, unlinking and switching between tickets are Git operations and
 * are `ticket-branches.spec.js`; the move onto the current trunk is
 * `ticket-rebase.spec.js`; applying what the card lists is `patch-apply.spec.js`
 * and `pr-checkout.spec.js`; a Gutenberg site's card, which is about a GitHub
 * issue, is `gutenberg-site.spec.js`. This file is the card as a reader: what
 * it shows of the ticket, of its pull requests and of its attachments, what
 * it says when one of those could not be read, and that every way out of the
 * app goes through the main process.
 *
 * Nothing reaches the network. The pull requests are GitHub's and the
 * ticket's facts and attachments are Trac's, read by the main process; here
 * the three handlers that would ask for them, and the one that opens a page
 * in the browser, are stand-ins that keep what they were asked and answer
 * what the test set. What that leaves out: the main process's own cache of
 * the last list GitHub gave, which is what a failed read falls back on, is
 * answered by the stand-in too; and Trac's window, with its human-check, is
 * never opened.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, currentBranch } = require( '../helpers/git-site.cjs' );
const { ticketActionDisabledReason } = require( '../../../src/renderer/ticket-actions.cjs' );

const TICKET = '60001';
const TICKET_URL = `https://core.trac.wordpress.org/ticket/${ TICKET }`;
const COMPONENT_URL = 'https://core.trac.wordpress.org/query?component=General';
const pullRequest = ( number, rest ) => ( { number, url: `https://github.com/WordPress/wordpress-develop/pull/${ number }`, ...rest } );
const PULL_REQUESTS = [
	pullRequest( 13245, { title: 'Docs: correct the default', state: 'open', commitDate: '2026-08-24T12:00:00Z' } ),
	pullRequest( 13012, { title: 'Docs: list the values', state: 'closed', updatedAt: '2026-06-11T12:00:00Z' } ),
	pullRequest( 12990, { title: 'An earlier attempt', state: 'merged' } ),
];
const ATTACHMENT_URL = `https://core.trac.wordpress.org/attachment/ticket/${ TICKET }/${ TICKET }.diff`;
const FROM_TRAC = {
	ok: true,
	status: 'ok',
	ticket: {
		summary: 'Inconsistent documentation for a filter',
		status: 'reviewing',
		resolution: '',
		type: 'defect (bug)',
		milestone: '7.2',
		component: { label: 'General', url: COMPONENT_URL },
		keywords: [ { label: 'has-patch', url: 'https://core.trac.wordpress.org/query?keywords=~has-patch' } ],
		opened: { relative: '4 weeks ago', absolute: 'Sep 1, 2026' },
	},
	items: [ { filename: `${ TICKET }.diff`, url: ATTACHMENT_URL, applyable: true, author: 'janedoe', dateText: '6 weeks ago', sizeText: '3.2 KB' } ],
};
// A date as the app writes it: the suite runs in en-US, on this machine's
// clock.
const day = ( iso ) => new Date( iso ).toLocaleDateString( 'en-US' );

// The stand-ins.
function install( app ) {
	return app.evaluate( ( { ipcMain }, [ prs, trac ] ) => {
		const state = { asked: { prs: 0, trac: 0, opened: [] }, prs, trac };
		global.__e2eTicket = state;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'git:list-ticket-patches', () => {
			state.asked.prs += 1;
			return { ok: true, prs: state.prs };
		} );
		replace( 'trac:list-attachments', () => {
			state.asked.trac += 1;
			return state.trac;
		} );
		replace( 'url:open', ( event, url ) => {
			state.asked.opened.push( url );
			return true;
		} );
	}, [ { status: 'ok', items: PULL_REQUESTS }, FROM_TRAC ] );
}

// What the test uses to set the stand-ins' answers and read what they were
// asked.
function standIns( app, page ) {
	return {
		asked: () => app.evaluate( () => global.__e2eTicket.asked ),
		gitHubAnswers: ( prs ) => app.evaluate( ( electron, value ) => {
			global.__e2eTicket.prs = value;
		}, prs ),
		tracAnswers: ( trac ) => app.evaluate( ( electron, value ) => {
			global.__e2eTicket.trac = value;
		}, trac ),
		// Told and heard: the reply to a question asked after an answer has
		// gone out arrives after it.
		heard: () => page.evaluate( () => window.api.getSitesWithMeta() ),
	};
}

async function standIn( app, page ) {
	await install( app );
	return standIns( app, page );
}

test( 'the card links a ticket, says what Trac and GitHub say of it, and sends every way out through the main process', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const outside = await standIn( app, page );
	const card = ui.workItemCard( page, 'Trac ticket' );
	const button = ( name ) => card.getByRole( 'button', { name, exact: true } );
	const said = ( text ) => card.getByText( text, { exact: true } );

	// INVARIANT — with nothing linked the card asks for a ticket, and its
	// button has nothing to link until something is typed.
	await expect( card ).toBeVisible( { timeout: 30_000 } );
	await expect( said( 'Link the ticket you’re working on.' ) ).toBeVisible();
	await expect( ui.linkTicketButton( card ) ).toBeDisabled();
	await expect( button( 'Unlink' ) ).toHaveCount( 0 );

	// INVARIANT — a newcomer with no ticket is sent to where one can be
	// found, in the browser.
	await button( 'Browse good first bugs on Trac' ).click();
	await expect.poll( async () => ( await outside.asked() ).opened ).toEqual( [ 'https://core.trac.wordpress.org/tickets/good-first-bugs' ] );

	// INVARIANT — linking reads the ticket's pull requests and the ticket
	// itself, once each, with nothing more pressed.
	await ui.linkTicket( page, TICKET );
	await expect( said( 'Linked pull requests' ) ).toBeVisible();
	await expect( said( 'Trac attachments' ) ).toBeVisible();
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 4 );
	await outside.heard();
	expect( await outside.asked() ).toMatchObject( { prs: 1, trac: 1 } );

	// INVARIANT — the ticket is its number and what Trac calls it, and that
	// is the way to it on Trac.
	const ticket = button( `#${ TICKET } ${ FROM_TRAC.ticket.summary }` );
	await expect( ticket ).toHaveAttribute( 'title', 'Open in Trac' );
	await ticket.click();
	await expect.poll( async () => ( await outside.asked() ).opened ).toHaveLength( 2 );
	expect( ( await outside.asked() ).opened[ 1 ] ).toBe( TICKET_URL );

	// INVARIANT — under it, what Trac said of the ticket: its status, and
	// the facts a contributor would otherwise find out on Trac (#292).
	await expect( said( 'reviewing' ) ).toBeVisible();
	await expect( card.getByText( 'defect (bug)' ) ).toBeVisible();
	await expect( card.getByText( 'Milestone: 7.2' ) ).toBeVisible();
	await expect( card.getByText( 'Opened 4 weeks ago' ) ).toHaveAttribute( 'title', 'Sep 1, 2026' );
	await expect( button( 'has-patch' ) ).toBeVisible();
	await button( 'Component: General' ).click();
	await expect.poll( async () => ( await outside.asked() ).opened ).toHaveLength( 3 );
	expect( ( await outside.asked() ).opened[ 2 ] ).toBe( COMPONENT_URL );
	// Read, so there is nothing left to read.
	await expect( ui.readTicketDetailsButton( card ) ).toHaveCount( 0 );
	await expect( button( 'Show Trac attachments' ) ).toHaveCount( 0 );

	// INVARIANT — each pull request says its number, its state in a word,
	// and when it last moved, and its title is the way to it.
	const row = ( text ) => card.getByRole( 'listitem' ).filter( { hasText: text } );
	await expect( row( '#13245' ).getByText( 'Open', { exact: true } ) ).toBeVisible();
	await expect( row( '#13245' ).getByText( `Last commit ${ day( PULL_REQUESTS[ 0 ].commitDate ) }`, { exact: true } ) ).toBeVisible();
	await expect( row( '#13012' ).getByText( 'Closed', { exact: true } ) ).toBeVisible();
	await expect( row( '#13012' ).getByText( `Updated ${ day( PULL_REQUESTS[ 1 ].updatedAt ) }`, { exact: true } ) ).toBeVisible();
	await expect( row( '#12990' ).getByText( 'Merged', { exact: true } ) ).toBeVisible();
	await row( '#13245' ).getByRole( 'button', { name: 'Docs: correct the default', exact: true } ).click();
	await expect.poll( async () => ( await outside.asked() ).opened ).toHaveLength( 4 );
	expect( ( await outside.asked() ).opened[ 3 ] ).toBe( PULL_REQUESTS[ 0 ].url );

	// INVARIANT — an attachment says who uploaded it, when and how large,
	// and its name is the way to it on Trac.
	await expect( row( `${ TICKET }.diff` ).getByText( 'by janedoe · 6 weeks ago · 3.2 KB', { exact: true } ) ).toBeVisible();
	await row( `${ TICKET }.diff` ).getByRole( 'button', { name: `${ TICKET }.diff`, exact: true } ).click();
	await expect.poll( async () => ( await outside.asked() ).opened ).toHaveLength( 5 );
	expect( ( await outside.asked() ).opened[ 4 ] ).toBe( ATTACHMENT_URL );
	// INVARIANT — and each of the four can be read before it is applied.
	await expect( ui.readPatchButton( card ) ).toHaveCount( 4 );
} );

test( 'a list that could not be read says why and keeps what it had, and an empty one says it is empty', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const outside = await standIn( app, page );
	const card = ui.workItemCard( page, 'Trac ticket' );
	const button = ( name ) => card.getByRole( 'button', { name, exact: true } );
	await ui.linkTicket( page, TICKET );
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 4 );

	// INVARIANT — GitHub out of reach is said, with when the list on screen
	// was read, and that list stays: it is what there is to go on.
	const cachedAt = '2026-09-30T12:00:00Z';
	await outside.gitHubAnswers( { status: 'offline', items: PULL_REQUESTS.slice( 0, 1 ), cachedAt } );
	await button( 'Refresh Linked pull requests' ).click();
	await expect( card.getByText( 'Could not reach GitHub.', { exact: true } ) ).toBeVisible();
	await expect( card.getByText( /^Showing what was last seen .+\.$/ ) ).toBeVisible();
	await expect( card.getByRole( 'listitem' ).filter( { hasText: '#13245' } ) ).toHaveCount( 1 );
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 2 );

	// INVARIANT — with nothing to fall back on, that is said instead, and
	// no row is shown.
	await outside.gitHubAnswers( { status: 'rate-limited', items: [], cachedAt: null } );
	await button( 'Refresh Linked pull requests' ).click();
	await expect( card.getByText( 'GitHub is rate-limiting this connection.', { exact: true } ) ).toBeVisible();
	await expect( card.getByText( 'No cached list to fall back on.', { exact: true } ) ).toBeVisible();
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 1 );

	// INVARIANT — a ticket nobody has opened a pull request for says so,
	// and what failed before is no longer said.
	await outside.gitHubAnswers( { status: 'ok', items: [] } );
	await button( 'Refresh Linked pull requests' ).click();
	await expect( card.getByText( 'No pull requests cite this ticket yet.', { exact: true } ) ).toBeVisible();
	await expect( card.getByText( /rate-limiting/ ) ).toHaveCount( 0 );

	// INVARIANT — Trac's window closed before it answered is said as that,
	// and the attachments are not said to be none.
	await outside.tracAnswers( { ok: true, status: 'closed', items: [] } );
	await button( 'Refresh Trac attachments' ).click();
	await expect( card.getByText( /^The Trac window was closed before the attachments finished loading\./ ) ).toBeVisible();
	await expect( card.getByText( 'No patch files attached to this ticket.', { exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — a ticket with no patch file on it says so.
	await outside.tracAnswers( { ok: true, status: 'no-attachments', items: [] } );
	await button( 'Refresh Trac attachments' ).click();
	await expect( card.getByText( 'No patch files attached to this ticket.', { exact: true } ) ).toBeVisible();
	await expect( card.getByText( /Trac window was closed/ ) ).toHaveCount( 0 );
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 0 );
} );

test( 'a site opened with a ticket already linked waits to be asked before it goes to Trac', async ( { session } ) => {
	const site = await makeSite( session );
	const first = await session.start( site.settings );
	await standIn( first.app, first.page );
	await ui.linkTicket( first.page, TICKET );
	await expect( ui.workItemCard( first.page, 'Trac ticket' ).getByRole( 'listitem' ) ).toHaveCount( 4 );

	// This site reads its ticket's pull requests as it opens, so the
	// stand-ins go in before its window is waited for.
	const { app, page } = await session.restart( { beforeWindow: install } );
	const outside = standIns( app, page );
	const card = ui.workItemCard( page, 'Trac ticket' );
	const button = ( name ) => card.getByRole( 'button', { name, exact: true } );

	// INVARIANT — the ticket is still linked, and its pull requests are read
	// again with nothing pressed. That read was answered here and not by
	// GitHub: were the stand-ins late, the count would be none.
	await expect( button( `#${ TICKET }` ) ).toBeVisible( { timeout: 30_000 } );
	await expect( card.getByRole( 'listitem' ) ).toHaveCount( 3 );
	expect( ( await outside.asked() ).prs ).toBe( 1 );

	// INVARIANT — and Trac has not been asked: reading it opens a window and
	// may ask for a human, which is not something to do to someone who only
	// opened the app. The card offers to, in both places where what Trac
	// knows would be. With the stand-ins there from the start, the count is
	// of every question the page has asked.
	await expect( ui.readTicketDetailsButton( card ) ).toBeVisible();
	await expect( button( 'Show Trac attachments' ) ).toBeVisible();
	await outside.heard();
	expect( ( await outside.asked() ).trac ).toBe( 0 );

	// INVARIANT — asked once, from either place, it fills in both.
	await ui.readTicketDetailsButton( card ).click();
	await expect( button( `#${ TICKET } ${ FROM_TRAC.ticket.summary }` ) ).toBeVisible();
	await expect( card.getByRole( 'listitem' ).filter( { hasText: `${ TICKET }.diff` } ) ).toHaveCount( 1 );
	await expect( ui.readTicketDetailsButton( card ) ).toHaveCount( 0 );
	await expect( button( 'Show Trac attachments' ) ).toHaveCount( 0 );
	expect( ( await outside.asked() ).trac ).toBe( 1 );
} );

test( 'while the site is being built the card\'s actions are held, say why, and come back', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// The terminal is in the tray, which is closed when the window opens.
	await ui.openTray( page, 'Terminal' );
	const outside = await standIn( app, page );
	// A build that runs until the test says it has ended.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', () => ( { runId: 'e2e-run-1' } ) );
	} );
	const card = ui.workItemCard( page, 'Trac ticket' );
	const unlink = ui.unlinkButton( card );
	await ui.linkTicket( page, TICKET );
	await expect( unlink ).toBeEnabled();

	const terminal = ui.terminalInput( page );
	const buildHint = ui.terminalHint( page, 'npm run build' );
	await expect( buildHint ).toBeVisible();
	await terminal.pressSequentially( 'npm run build', { delay: 10 } );
	await terminal.press( 'Enter' );

	// INVARIANT — unlinking moves the checkout to another branch, which a
	// build must not have happen under it, so the button is held and its
	// reason is its description (#409). Held the accessible way: it can
	// still be reached and read, and pressing it does nothing. A press that
	// got through would be turned away at once, a command being under way,
	// before anything is asked of the main process, and the card would say
	// so: that it says nothing is what shows the press went nowhere.
	const reason = ticketActionDisabledReason( { building: true } );
	await expect( unlink ).toBeDisabled();
	await expect( unlink ).toHaveAccessibleDescription( reason );
	await unlink.focus();
	await expect( unlink ).toBeFocused();
	await unlink.click( { force: true } );
	await outside.heard();
	await expect( card.getByRole( 'alert' ) ).toHaveCount( 0 );
	expect( currentBranch( site.dir ) ).toBe( `ticket/${ TICKET }` );
	await expect( ui.workItemNumber( card, TICKET ) ).toBeVisible();

	// INVARIANT — the build over, the button is the same button, still
	// holding the focus it was given, and it unlinks.
	await app.evaluate( ( { BrowserWindow } ) => {
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'npm:run-script:done', { runId: 'e2e-run-1', code: 0 } );
	} );
	await expect( unlink ).toBeEnabled();
	await expect( unlink ).toHaveAccessibleDescription( '' );
	await expect( unlink ).toBeFocused();
	// The button comes back as the build ends, and the terminal a moment
	// later, once the site's status has been read again: until then a press
	// is turned away, a command still being under way. The hint under the
	// terminal is a link again when that moment has passed. That the two do
	// not come back together is the app's and is older than this card; the
	// journey waits it out and does not pin it either way.
	await expect( buildHint ).toBeVisible();
	await unlink.click();
	await expect.poll( () => currentBranch( site.dir ) ).toBe( 'trunk' );

	// INVARIANT — and with nothing linked the field and its button are held
	// by the same thing, with the same sentence.
	await expect( ui.ticketField( card ) ).toBeEnabled();
	// The switch holds the terminal too, and gives it back the same way.
	await expect( buildHint ).toBeVisible();
	await terminal.pressSequentially( 'npm run build', { delay: 10 } );
	await terminal.press( 'Enter' );
	await expect( ui.ticketField( card ) ).toBeDisabled();
	await expect( ui.linkTicketButton( card ) ).toBeDisabled();
	await expect( ui.linkTicketButton( card ) ).toHaveAccessibleDescription( reason );
} );
