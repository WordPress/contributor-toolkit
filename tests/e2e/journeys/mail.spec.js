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
	await expect( commentRow ).toBeVisible();

	// INVARIANT — the dialog is the mail that was clicked: titled with its
	// subject, with who sent it, who it went to and who was copied in.
	await resetRow.click();
	const dialog = page.getByRole( 'dialog', { name: RESET.subject } );
	await expect( dialog ).toBeVisible();
	await expect( dialog.getByText( `From: ${ RESET.from }`, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( `To: ${ RESET.to }`, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( `CC: ${ RESET.cc }`, { exact: true } ) ).toBeVisible();
	// The journeys run in en-GB and UTC, so this is the whole string and not a
	// pattern a raw timestamp would also fit.
	await expect( dialog.getByText( 'Date: 10/08/2026, 09:30:00', { exact: true } ) ).toBeVisible();

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
