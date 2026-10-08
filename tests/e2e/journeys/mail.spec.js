/**
 * Reading a mail the site sent, through the dialog a contributor uses (#553).
 *
 * A local WordPress sends its mail to the app instead of to the world: a
 * password reset, a comment notification. The list in the Email tray (#558)
 * is where they arrive and the dialog is where one is read, so this is the
 * only place a contributor can check what their change made WordPress send.
 * The dialog has to show the mail that was clicked, in both of its forms, and
 * give the list back when it closes.
 *
 * A mail is also markup the app did not write, shown inside the app. So the
 * last journey is the other half of reading one: what a mail links to, what
 * it submits and how it is styled end at the mail's own edge, and the window
 * around it stays the app. Only a journey can see that. It is decided by
 * Chromium, from how the frame the mail is drawn in was set up, and nothing
 * below this layer has a window.
 *
 * The dev server is what loads the list, and a journey does not run one: the
 * two long-running processes it starts are answered by stubs that never
 * finish, the way the documentation screenshots do it. The mail itself is
 * seeded in the store, where the app keeps what it has caught.
 *
 * The second journey is the list while the server runs (#554): mail arriving,
 * where it lands, whose it is, and what stopping, starting again and clearing
 * do to it. There is no mail server either, so the test says what the main
 * process says when one catches a mail, on the channels it says it on. It
 * leaves out what the real one does first, which is to write the mail to the
 * store, and that is why the mails it announces are gone after a restart.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

const RESET = {
	id: 'e2e-reset',
	subject: '[Test Site] Password Reset',
	from: 'WordPress <wordpress@example.test>',
	to: 'admin@example.test',
	cc: 'auditor@example.test',
	date: '2026-08-10T09:30:00.000Z',
	sentAt: '2026-08-10T09:30:00.000Z',
	// The two parts say different things on purpose: a mail has both, a reader
	// is shown the HTML one, and a dialog that showed the text part instead
	// would otherwise read the same.
	text: 'Plain text part: a password reset was requested.',
	html: '<p>Someone has requested a <strong>password reset</strong>.</p>',
	headers: {},
	raw: 'Subject: [Test Site] Password Reset\nX-Mailer: PHPMailer\n\nPlain text part: a password reset was requested.',
};
// No HTML part and nobody copied in: the dialog has to show the text, and no
// line for a field the mail does not have.
const COMMENT = {
	id: 'e2e-comment',
	subject: '[Test Site] Comment: "Hello world!"',
	from: 'WordPress <wordpress@example.test>',
	to: 'admin@example.test',
	date: '2026-08-10T09:00:00.000Z',
	sentAt: '2026-08-10T09:00:00.000Z',
	text: 'New comment on your post "Hello world!"',
	headers: {},
	raw: 'Subject: [Test Site] Comment: "Hello world!"\n\nNew comment on your post "Hello world!"',
};

// Everything a mail can bring that is aimed at the page around it: a style
// that would hide the dialog's own heading and tabs, a <base>, links with and
// without a target, and a form.
const SIGN_UP = {
	id: 'e2e-sign-up',
	subject: '[Test Site] Confirm your address',
	from: 'WordPress <wordpress@example.test>',
	to: 'admin@example.test',
	date: '2026-08-10T10:00:00.000Z',
	sentAt: '2026-08-10T10:00:00.000Z',
	text: 'Plain text part: confirm your address.',
	html: [
		'<style>h1, [role="tab"] { display: none !important; }</style>',
		'<base href="https://elsewhere.example.test/">',
		'<p>Confirm your address to finish signing up.</p>',
		'<p><a href="https://example.test/confirm">Confirm</a></p>',
		'<p><a href="https://example.test/site" target="_top">Visit the site</a></p>',
		'<p><a href="https://example.test/new" target="_blank">Open in a new window</a></p>',
		'<form action="https://example.test/subscribe" target="_top"><button>Subscribe</button></form>',
	].join( '' ),
	headers: {},
	raw: 'Subject: [Test Site] Confirm your address\n\nPlain text part: confirm your address.',
};

/**
 * Starts the app on a site that has caught these mails and presses "Start dev
 * server", which is what loads the list.
 *
 * @param {Object}   session
 * @param {Object[]} mails   What the store holds for the site.
 * @return {Promise<{app: Object, page: Object}>} The app and its window.
 */
async function openMailList( session, mails ) {
	const site = await makeSite( session );
	const { app, page } = await session.start( { ...site.settings, [ `siteMail:${ site.dir }` ]: mails } );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-mail' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async () => ( { ok: true } ) );
	} );
	await ui.startDevServerButton( page ).click();
	return { app, page };
}

test( 'a mail the site sent opens as the one that was clicked, in its rendered and its raw form, and closes back to the list', async ( { session } ) => {
	const { page } = await openMailList( session, [ RESET, COMMENT ] );

	const resetRow = page.getByRole( 'button', { name: /\[Test Site\] Password Reset$/ } );
	const commentRow = page.getByRole( 'button', { name: /\[Test Site\] Comment: "Hello world!"$/ } );
	// INVARIANT — the mail is in the tray along the bottom of the window
	// (#558), which is named and headed for it, and its rows are in it.
	const mail = await ui.openTray( page, 'Email' );
	await expect( mail.getByRole( 'heading', { level: 2, name: 'Email', exact: true } ) ).toBeVisible();
	await expect( mail.getByRole( 'button', { name: /\[Test Site\] Password Reset$/ } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( commentRow ).toBeVisible();
	// INVARIANT — and it is nowhere else: with the list loaded and the tray
	// put away there is no row on screen, on the page or anywhere.
	await ui.trayToggle( page, 'Email' ).click();
	await expect( mail ).toHaveCount( 0 );
	await expect( resetRow ).toBeHidden();
	await expect( commentRow ).toBeHidden();
	await ui.openTray( page, 'Email' );
	await expect( resetRow ).toBeVisible();

	// INVARIANT — the dialog is the mail that was clicked: titled with its
	// subject, with who sent it, who it went to and who was copied in.
	await resetRow.click();
	const dialog = page.getByRole( 'dialog', { name: RESET.subject } );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByText( `From: ${ RESET.from }`, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( `To: ${ RESET.to }`, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( `CC: ${ RESET.cc }`, { exact: true } ) ).toBeVisible();
	// The journeys run in en-US and UTC, so this is the whole string and not a
	// pattern a raw timestamp would also fit.
	await expect( dialog.getByText( 'Date: 8/10/2026, 9:30:00 AM', { exact: true } ) ).toBeVisible();

	// INVARIANT — it opens on the mail as a reader would see it: the HTML part,
	// rendered rather than shown as markup, and not the text part beside it.
	// The HTML part is a document of its own inside the dialog, so it is read
	// through its frame, and the text part is looked for on both sides.
	const rendered = dialog.frameLocator( 'iframe' );
	await expect( dialog.getByRole( 'tab', { name: 'Rendered', exact: true } ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( rendered.getByText( 'Someone has requested a password reset.', { exact: true } ) ).toBeVisible();
	await expect( rendered.getByText( '<strong>' ) ).toHaveCount( 0 );
	await expect( rendered.getByText( 'Plain text part' ) ).toHaveCount( 0 );
	await expect( dialog.getByText( 'Plain text part' ) ).toHaveCount( 0 );
	await expect( dialog.getByText( 'X-Mailer: PHPMailer' ) ).toHaveCount( 0 );

	// INVARIANT — and the other tab is the mail as it was sent, headers and all.
	await dialog.getByRole( 'tab', { name: 'Raw', exact: true } ).click();
	await expect( dialog.getByText( 'X-Mailer: PHPMailer' ) ).toBeVisible();
	// INVARIANT — on the surface the logs and the terminal are on: one look
	// for everything read as code (#557). The text's colour is not asked for,
	// since it is the one the dialog would give it anyway.
	expect( ( await ui.paintOf( dialog.getByText( 'X-Mailer: PHPMailer' ) ) ).behind )
		.toBe( await ui.tokenColour( page, 'var(--wpds-color-background-surface-neutral-weak)' ) );

	// INVARIANT — closing gives the list back, with both mails still in it.
	await page.keyboard.press( 'Escape' );
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( resetRow ).toBeVisible();
	await expect( commentRow ).toBeVisible();

	// INVARIANT — the next mail opened is that mail and nothing of the last
	// one: its own subject, no line for the copy it does not have, its text
	// where it has no HTML part, and back on the rendered form although the
	// last dialog was left on the raw one.
	await commentRow.click();
	const second = page.getByRole( 'dialog', { name: COMMENT.subject } );
	await expect( second ).toBeVisible();
	await expect( second.getByText( /^CC:/ ) ).toHaveCount( 0 );
	await expect( second.getByRole( 'tab', { name: 'Rendered', exact: true } ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( second.getByText( COMMENT.text, { exact: true } ) ).toBeVisible();
	await expect( second.getByText( 'password reset' ) ).toHaveCount( 0 );
	// The last mail's HTML part would be in a frame, which a search of the
	// dialog does not enter. This mail has no HTML part, so it has no frame.
	await expect( second.locator( 'iframe' ) ).toHaveCount( 0 );
} );

test( 'mail that arrives while the dev server runs joins the list newest first, for this site only; the list hears nothing once the server stops, hears each mail once after a restart, and can be cleared', async ( { session } ) => {
	const site = await makeSite( session );
	const mailKey = `siteMail:${ site.dir }`;
	const { app, page } = await session.start( { ...site.settings, [ mailKey ]: [ COMMENT ] } );
	// The two processes the dev server starts never finish, as above, and the
	// page the app opens when a server is up stays closed.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-mail' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async () => ( { ok: true } ) );
		ipcMain.removeHandler( 'url:open' );
		ipcMain.handle( 'url:open', () => true );
	} );
	// What the main process tells every window: that the mail server is up,
	// that it caught a mail, that the dev server has an address.
	const tell = ( channel, payload ) => app.evaluate( ( { BrowserWindow }, [ to, what ] ) => {
		for ( const win of BrowserWindow.getAllWindows() ) {
			win.webContents.send( to, what );
		}
	}, [ channel, payload ] );
	const caught = ( sitePath, subject, sentAt ) => tell( 'smtp:new-email', {
		sitePath,
		message: { ...COMMENT, id: `e2e-${ subject }`, subject, sentAt, date: sentAt },
	} );
	// Told and heard: the reply to a question asked after the telling arrives
	// after it, so by then the page has heard, whatever it did about it.
	const heard = () => page.evaluate( () => window.api.getSitesWithMeta() );
	const row = ( subject ) => page.getByRole( 'button', { name: new RegExp( ` ${ subject }$` ) } );
	const commentRow = page.getByRole( 'button', { name: /\[Test Site\] Comment: "Hello world!"$/ } );
	const notListening = page.getByText( 'SMTP will start with the dev server.', { exact: true } );
	const noMail = page.getByText( 'No mail yet. WordPress transactional email will appear here once the site sends any.', { exact: true } );
	const clearEmails = page.getByRole( 'button', { name: 'Clear emails', exact: true } );
	// The mail is in the tray, which is closed when the window opens.
	await ui.openTray( page, 'Email' );

	// CHARACTERISATION — before a server has run the list is empty, though
	// the store holds a mail: starting the server is what loads it. With
	// nothing in the list there is nothing to clear.
	await expect( notListening ).toBeVisible( { timeout: 30_000 } );
	await expect( noMail ).toBeVisible();
	await expect( clearEmails ).toBeDisabled();

	await ui.startDevServerButton( page ).click();
	await expect( commentRow ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the line above the list says where the mail server is
	// listening, once the main process says it is.
	await tell( 'smtp:started', { sitePath: site.dir, port: 2525 } );
	await expect( page.getByText( 'SMTP listening on 127.0.0.1:2525', { exact: true } ) ).toBeVisible();

	// INVARIANT — a mail caught for this site joins the list without anything
	// being clicked, and one caught for another site does not.
	await caught( `${ site.dir }-another`, 'Another site', '2026-08-10T11:00:00.000Z' );
	await caught( site.dir, 'Newer mail', '2026-08-10T10:00:00.000Z' );
	await expect( row( 'Newer mail' ) ).toBeVisible();
	await expect( row( 'Another site' ) ).toHaveCount( 0 );

	// INVARIANT — the list is ordered by when a mail was sent, newest first,
	// and not by when it arrived: a mail that arrives late but was sent early
	// goes to the bottom.
	await caught( site.dir, 'Older mail', '2026-08-10T08:00:00.000Z' );
	await expect( row( 'Older mail' ) ).toBeVisible();
	expect( await ui.inDocumentOrder( page, [ row( 'Newer mail' ), commentRow, row( 'Older mail' ) ] ) ).toBe( true );

	// INVARIANT — stopping the server stops the listening: the line says so,
	// and a mail caught afterwards does not join the list. The real mail
	// server stops with the dev server and would catch nothing; the test
	// says one was caught anyway, because that is the only way to see that
	// nothing is listening.
	await tell( 'playground:url', { sitePath: site.dir, url: 'http://127.0.0.1:9400/' } );
	await ui.stopDevServerButton( page ).click();
	await expect( notListening ).toBeVisible();
	await expect( ui.startDevServerButton( page ) ).toBeVisible();
	await caught( site.dir, 'While stopped', '2026-08-10T12:00:00.000Z' );
	await heard();
	await expect( row( 'While stopped' ) ).toHaveCount( 0 );

	// CHARACTERISATION — the next start loads the list from the store again,
	// so what the test only said was caught is gone and what the store holds
	// is back.
	await ui.startDevServerButton( page ).click();
	await expect( row( 'Newer mail' ) ).toHaveCount( 0, { timeout: 30_000 } );
	await expect( commentRow ).toBeVisible();

	// INVARIANT — after a restart the list hears each mail once. A listener
	// left over from the first run would add it a second time.
	await caught( site.dir, 'After restart', '2026-08-10T13:00:00.000Z' );
	await expect( row( 'After restart' ) ).toHaveCount( 1 );
	await heard();
	await expect( row( 'After restart' ) ).toHaveCount( 1 );

	// INVARIANT — clearing empties the list and what the store holds, and
	// leaves nothing to clear.
	await clearEmails.click();
	await expect( noMail ).toBeVisible();
	await expect.poll( () => session.readSettings()[ mailKey ] ).toEqual( [] );
	await expect( clearEmails ).toBeDisabled();
} );

test( 'a mail is read inside the app, and its links, its form and its styles do not reach the window around it', async ( { session } ) => {
	const { app, page } = await openMailList( session, [ SIGN_UP ] );
	// Nothing here may reach the contributor's browser: the function that
	// would open it records the address instead.
	await app.evaluate( ( { shell } ) => {
		global.e2eOpened = [];
		shell.openExternal = async ( url ) => {
			global.e2eOpened.push( url );
		};
	} );

	await ui.openTray( page, 'Email' );
	const row = page.getByRole( 'button', { name: /\[Test Site\] Confirm your address$/ } );
	await expect( row ).toBeVisible( { timeout: 30_000 } );
	const home = page.url();

	await row.click();
	const dialog = page.getByRole( 'dialog', { name: SIGN_UP.subject } );
	const mail = dialog.frameLocator( 'iframe' );
	const body = mail.getByText( 'Confirm your address to finish signing up.', { exact: true } );
	await expect( body ).toBeVisible();

	// INVARIANT — what the mail says about style applies to the mail. The
	// dialog around it keeps the heading and the tabs this one tries to hide.
	await expect( dialog.getByRole( 'heading', { name: SIGN_UP.subject, exact: true } ) ).toBeVisible();
	await expect( dialog.getByRole( 'tab', { name: 'Rendered', exact: true } ) ).toBeVisible();
	await expect( dialog.getByRole( 'tab', { name: 'Raw', exact: true } ) ).toBeVisible();

	// Everything in the mail that asks to go somewhere, pressed in turn: a
	// plain link, one aimed at the window, one aimed at a new window, and a
	// form aimed at the window. The plain link goes first on purpose. It is
	// the one that could replace the mail in its own frame, and then none of
	// the others would be there to press.
	await mail.getByRole( 'link', { name: 'Confirm', exact: true } ).click();
	await mail.getByRole( 'link', { name: 'Visit the site', exact: true } ).click();
	await mail.getByRole( 'link', { name: 'Open in a new window', exact: true } ).click();
	await mail.getByRole( 'button', { name: 'Subscribe', exact: true } ).click();

	// INVARIANT — the mail is still there to be read.
	await expect( body ).toBeVisible();

	// INVARIANT — and the app is still the app. Closing the dialog gives the
	// list back, in the one window there was, on the page it was on. By its
	// button: after a click in the mail the keyboard is the mail's, and Escape
	// is a key pressed in a document that may not answer it.
	await dialog.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( row ).toBeVisible();
	expect( await app.evaluate( ( { BrowserWindow } ) => BrowserWindow.getAllWindows().length ) ).toBe( 1 );
	expect( page.url() ).toBe( home );

	// CHARACTERISATION — a mail's links are not followed at all today, not
	// even into the browser.
	expect( await app.evaluate( () => global.e2eOpened ) ).toEqual( [] );
} );
