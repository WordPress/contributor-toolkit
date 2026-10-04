/**
 * Reading a mail the site sent, through the dialog a contributor uses (#553).
 *
 * A local WordPress sends its mail to the app instead of to the world: a
 * password reset, a comment notification. The list under "Mail" is where they
 * arrive and the dialog is where one is read, so this is the only place a
 * contributor can check what their change made WordPress send. The dialog has
 * to show the mail that was clicked, in both of its forms, and give the list
 * back when it closes.
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

test( 'a mail the site sent opens as the one that was clicked, in its rendered and its raw form, and closes back to the list', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( { ...site.settings, [ `siteMail:${ site.dir }` ]: [ RESET, COMMENT ] } );
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', async () => ( { runId: 'e2e-mail' } ) );
		ipcMain.removeHandler( 'playground:start' );
		ipcMain.handle( 'playground:start', async () => ( { ok: true } ) );
	} );
	await ui.startDevServerButton( page ).click();

	const resetRow = page.getByRole( 'button', { name: /\[Test Site\] Password Reset$/ } );
	const commentRow = page.getByRole( 'button', { name: /\[Test Site\] Comment: "Hello world!"$/ } );
	await expect( resetRow ).toBeVisible( { timeout: 30_000 } );
	// INVARIANT — the mail is a region of the page, named by its heading,
	// and its rows are in it (#557).
	const mail = page.getByRole( 'region', { name: 'Mail', exact: true } );
	await expect( mail.getByRole( 'heading', { level: 2, name: 'Mail', exact: true } ) ).toBeVisible();
	await expect( mail.getByRole( 'button', { name: /\[Test Site\] Password Reset$/ } ) ).toBeVisible();
	// INVARIANT — and it is the last of the three panels under the cards:
	// the terminal, then the logs, then the mail.
	expect( await ui.inDocumentOrder( page, [ 'Terminal', 'Logs', 'Mail' ].map( ( name ) => page.getByRole( 'region', { name, exact: true } ) ) ) ).toBe( true );
	await expect( commentRow ).toBeVisible();

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
	await expect( dialog.getByRole( 'tab', { name: 'Rendered', exact: true } ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( dialog.getByText( 'Someone has requested a password reset.', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( '<strong>' ) ).toHaveCount( 0 );
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

	// CHARACTERISATION — before a server has run the list is empty, though
	// the store holds a mail: starting the server is what loads it.
	await expect( notListening ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( 'No emails yet.', { exact: true } ) ).toBeVisible();

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

	// INVARIANT — clearing empties the list and what the store holds.
	await page.getByRole( 'button', { name: 'Clear emails', exact: true } ).click();
	await expect( page.getByText( 'No emails yet.', { exact: true } ) ).toBeVisible();
	await expect.poll( () => session.readSettings()[ mailKey ] ).toEqual( [] );
} );
