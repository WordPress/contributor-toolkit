/**
 * The apply card (#557): where a patch file or a pull request is brought
 * into a checkout, and the dialog that shows what one would change before it
 * is applied.
 *
 * What applying and reverting do to the checkout is `patch-apply.spec.js`,
 * and a pull request's checkout is `pr-checkout.spec.js`; a Gutenberg site,
 * which takes no patch files, is `gutenberg-site.spec.js`. This file is the
 * card and its dialog as things to use: that the preview is a gate that can
 * be left without anything written, that a failure is said where it can be
 * read and not behind the preview, and that the card keeps the place it was
 * left in.
 *
 * The patches are real files applied by the real engine to a real checkout.
 * What is stood in for is what the ticket's lists would ask the network for:
 * GitHub's pull requests, Trac's attachments and the download of one, which
 * answer what the test set.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, makePatchFile, addPullRequestToOrigin, read, write, currentBranch, LOGIN, DOOMED } = require( '../helpers/git-site.cjs' );
const { applyHeldReason } = require( '../../../src/renderer/apply-card.cjs' );

const TICKET = '60001';
const PATCH = `ticket-${ TICKET }.patch`;
const TRUNK_LOGIN = '<?php // trunk';
const PATCHED_LOGIN = '<?php // fixed by the patch';
const ATTACHMENT_URL = `https://core.trac.wordpress.org/attachment/ticket/${ TICKET }/${ PATCH }`;

/**
 * Answers for the ticket's lists, so that linking a ticket asks nothing of
 * the network: no pull requests, and on Trac one attachment, which is the
 * patch given.
 *
 * @param {Object} app
 * @param {string} patchText What downloading the attachment gives.
 */
async function standIn( app, patchText ) {
	await app.evaluate( ( { ipcMain }, [ url, name, text ] ) => {
		const answers = {
			'git:list-ticket-patches': () => ( { ok: true, prs: { status: 'ok', items: [] } } ),
			'trac:list-attachments': () => ( { ok: true, status: 'ok', items: [ { filename: name, url, applyable: true } ] } ),
			'trac:fetch-attachment': () => ( { ok: true, text } ),
		};
		for ( const [ channel, answer ] of Object.entries( answers ) ) {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, answer );
		}
	}, [ ATTACHMENT_URL, PATCH, patchText ] );
}

test( 'a patch is shown in a dialog before it is applied, which can be left with nothing written, and the card keeps the tab it was left on', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const patch = makePatchFile( session, PATCH, [ { file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN } ] );
	await standIn( app, fs.readFileSync( patch, 'utf8' ) );
	await ui.linkTicket( page, TICKET );

	const card = ui.card( page, 'Apply a patch or PR' );
	const preview = page.getByRole( 'dialog', { name: `Apply ${ PATCH }`, exact: true } );

	// INVARIANT — a Core site is offered both ways in, the pull request's
	// first, and with nothing typed there is no pull request to ask for.
	await expect( ui.pullRequestTab( card ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( ui.patchFileTab( card ) ).toHaveAttribute( 'aria-selected', 'false' );
	await expect( ui.applyPrButton( card ) ).toBeDisabled();

	// INVARIANT — a patch that was chosen is shown, not applied: the dialog
	// names it, says how much it changes and which files, and nothing has
	// been written.
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFile( page );
	await expect( preview ).toBeVisible( { timeout: 30_000 } );
	await expect( preview.getByText( `${ PATCH } changes 1 file.`, { exact: true } ) ).toBeVisible();
	await expect( preview.getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible();
	expect( read( site.dir, LOGIN ) ).toBe( `${ TRUNK_LOGIN }\n` );

	// INVARIANT — leaving it, by its button or by Escape, applies nothing
	// and gives the card back as it was: on the tab the file was chosen
	// from, with the button to choose another.
	await preview.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
	await expect( preview ).toHaveCount( 0 );
	await expect( ui.patchFileTab( card ) ).toHaveAttribute( 'aria-selected', 'true' );
	await expect( ui.choosePatchFileButton( card ) ).toBeEnabled();
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFileButton( card ).click();
	await expect( preview ).toBeVisible();
	await page.keyboard.press( 'Escape' );
	await expect( preview ).toHaveCount( 0 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	expect( read( site.dir, LOGIN ) ).toBe( `${ TRUNK_LOGIN }\n` );
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0 );

	// INVARIANT — applied from the dialog, the patch is on disk, the card
	// says it is applied, and the dialog has gone. The card is still on the
	// tab it was left on, though its fields went while the apply ran.
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFileButton( card ).click();
	await ui.applyAndRebuildButton( preview ).click();
	// INVARIANT — the button that opened the dialog went with the fields, so
	// focus has nothing to go back to: it goes to the card, on its header,
	// and a keyboard does not start again from the top of the window.
	await expect( card.getByRole( 'button', { name: 'Apply a patch or PR', exact: true } ) ).toBeFocused();
	await expect( ui.revertPatchButton( card ) ).toBeVisible( { timeout: 60_000 } );
	expect( read( site.dir, LOGIN ) ).toBe( `${ PATCHED_LOGIN }\n` );
	await expect( preview ).toHaveCount( 0 );
	await expect( ui.patchFileTab( card ) ).toHaveAttribute( 'aria-selected', 'true' );
} );

test( 'a patch that does not fit closes its preview and says why on the card, which opens itself to say it', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const patch = makePatchFile( session, PATCH, [ { file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN } ] );
	await standIn( app, fs.readFileSync( patch, 'utf8' ) );
	await ui.linkTicket( page, TICKET );
	// The contributor has already edited the line the patch expects to find.
	const mine = '<?php // I got here first\n';
	write( site.dir, LOGIN, mine );

	const card = ui.card( page, 'Apply a patch or PR' );
	const fold = card.getByRole( 'button', { name: 'Apply a patch or PR', exact: true } );
	const preview = page.getByRole( 'dialog', { name: `Apply ${ PATCH }`, exact: true } );
	const failure = card.getByRole( 'alert' ).filter( { hasText: 'The checkout was not changed.' } );

	// INVARIANT — the card can be folded away, and folded it has no fields.
	await expect( ui.prField( card ) ).toBeVisible();
	await fold.click();
	await expect( fold ).toHaveAttribute( 'aria-expanded', 'false' );
	await expect( ui.prField( card ) ).toBeHidden();

	// INVARIANT — the ticket's own patch is read from its row, into the same
	// dialog, which says before anything is written whose work it would
	// land on.
	await ui.readPatchButton( page ).click();
	await expect( preview ).toBeVisible( { timeout: 30_000 } );
	await expect( preview.getByRole( 'alert' ).filter( { hasText: 'You have your own edits to src/wp-login.php' } ) ).toBeVisible();
	await ui.applyAndRebuildButton( preview ).click();

	// INVARIANT — the refusal is where it can be read: the preview has gone,
	// and the folded card has opened to say what went wrong. Nothing was
	// written.
	await expect( failure ).toBeVisible( { timeout: 60_000 } );
	await expect( preview ).toHaveCount( 0 );
	await expect( fold ).toHaveAttribute( 'aria-expanded', 'true' );
	await expect( failure ).toContainText( 'src/wp-login.php' );
	expect( read( site.dir, LOGIN ) ).toBe( mine );

	// INVARIANT — and the patch that failed holds nothing: the ticket's rows
	// can be read again, and a pull request asked for.
	await expect( ui.readPatchButton( page ) ).toBeEnabled();
	await expect( ui.prField( card ) ).toBeEnabled();

	// INVARIANT — once the failure has been read and dismissed the card goes
	// back to how it was left, folded.
	await failure.getByRole( 'button', { name: 'Dismiss', exact: true } ).click();
	await expect( failure ).toHaveCount( 0 );
	await expect( fold ).toHaveAttribute( 'aria-expanded', 'false' );
	await expect( ui.prField( card ) ).toBeHidden();
} );

test( 'a preview read for one site is not shown over another, and is there when its own site is opened again', async ( { session } ) => {
	// Two sites, and a pull request on the first one's origin. Reading it is
	// held until the test lets it go, which is how a slow GitHub is stood in
	// for: the handler is the app's own, reached through the map Electron
	// keeps them in, which is not part of its interface.
	const first = await makeSite( session, { label: 'first-site', origin: true } );
	addPullRequestToOrigin( first.origin, 7, { [ LOGIN ]: '<?php // pull request 7\n' } );
	const second = await makeSite( session, { label: 'second-site' } );
	const { app, page } = await session.start( {
		sites: [ ...first.settings.sites, ...second.settings.sites ],
		siteMeta: { ...first.settings.siteMeta, ...second.settings.siteMeta },
		preferences: {},
	} );
	await app.evaluate( ( { ipcMain } ) => {
		const reads = ipcMain._invokeHandlers.get( 'git:preview-pr' );
		const held = { read: false };
		global.__e2ePreview = held;
		held.wait = new Promise( ( resolve ) => {
			held.letGo = resolve;
		} );
		ipcMain.removeHandler( 'git:preview-pr' );
		ipcMain.handle( 'git:preview-pr', async ( ...args ) => {
			await held.wait;
			const answer = await reads( ...args );
			held.read = true;
			return answer;
		} );
	} );
	const preview = page.getByRole( 'dialog', { name: 'Apply PR #7', exact: true } );

	await ui.sidebarEntry( page, 'first-site' ).click();
	await expect( ui.siteHeading( page, 'first-site' ) ).toBeVisible( { timeout: 30_000 } );
	// Every site's view is in the window at once: the card is the one that
	// can be seen.
	const card = ui.card( page, 'Apply a patch or PR' );
	await ui.prField( card ).fill( '7' );
	await ui.applyPrButton( card ).click();

	// INVARIANT — the contributor has gone to the other site when the
	// preview arrives, and it does not open there: its button would apply to
	// a site that is not the one on screen. Read once the main process has
	// answered and the page has had the answer.
	await ui.sidebarEntry( page, 'second-site' ).click();
	await expect( ui.siteHeading( page, 'second-site' ) ).toBeVisible();
	await app.evaluate( () => global.__e2ePreview.letGo() );
	await expect.poll( () => app.evaluate( () => global.__e2ePreview.read ), { timeout: 30_000 } ).toBe( true );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	// The first site's view, out of sight, has taken the preview in: its
	// field is held for as long as a patch that was read is waiting.
	const held = () => page.getByLabel( 'Pull request URL or number' ).evaluateAll( ( fields ) => fields.filter( ( field ) => field.disabled ).length );
	await expect.poll( held ).toBe( 1 );
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );

	// INVARIANT — it was kept, and is shown where it belongs.
	await ui.sidebarEntry( page, 'first-site' ).click();
	await expect( preview ).toBeVisible();
	await expect( preview.getByText( 'PR #7 changes 1 file.', { exact: true } ) ).toBeVisible();
} );

test( 'a patch cannot be applied while a command runs in the terminal, and the dialog says why', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const patch = makePatchFile( session, PATCH, [ { file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN } ] );
	// A command that runs until the test says it has ended. Nothing is run:
	// the stand-in answers with the run's name and starts no process, so
	// nothing is printed, and the end is said by the test, on the channel
	// and in the shape the main process says it.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', () => ( { runId: 'e2e-run-1' } ) );
	} );
	const preview = page.getByRole( 'dialog', { name: `Apply ${ PATCH }`, exact: true } );
	const apply = ui.applyAndRebuildButton( preview );

	const terminal = ui.terminalInput( page );
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );
	await terminal.pressSequentially( 'npm run test', { delay: 10 } );
	await terminal.press( 'Enter' );
	await expect( ui.terminalHint( page, 'npm run build' ) ).toHaveCount( 0 );

	// INVARIANT — an apply runs through the terminal and is refused while a
	// command is running there. The refusal is a line in the terminal, which
	// the dialog is in front of, so the button is held and says it.
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFile( page );
	await expect( preview ).toBeVisible( { timeout: 30_000 } );
	await expect( apply ).toBeDisabled();
	await expect( apply ).toHaveAccessibleDescription( applyHeldReason( { terminalRunning: true } ) );

	// INVARIANT — the command over, the same dialog can apply.
	await app.evaluate( ( { BrowserWindow } ) => {
		BrowserWindow.getAllWindows()[ 0 ].webContents.send( 'npm:run-script:done', { runId: 'e2e-run-1', code: 0 } );
	} );
	await expect( apply ).toBeEnabled();
	await expect( apply ).toHaveAccessibleDescription( '' );
} );

test( 'saying no to the question about loose edits drops the pull request that was asked for', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	addPullRequestToOrigin( site.origin, 7, { [ LOGIN ]: '<?php // pull request 7\n' } );
	const { page } = await session.start( site.settings );
	// An edit on trunk, with no ticket for it to belong to.
	const mine = '<?php // a loose edit\n';
	write( site.dir, DOOMED, mine );

	const card = ui.card( page, 'Apply a patch or PR' );
	await ui.prField( card ).fill( '7' );
	await ui.applyPrButton( card ).click();
	await expect( page.getByText( 'PR #7 changes 1 file.', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await ui.applyAndRebuildButton( page ).click();

	// INVARIANT — the app asks what should become of the edit before it
	// moves anything, and "Cancel" is the way out that touches nothing: no
	// checkout, the edit as it was, and the preview not brought back in
	// front of whoever has just said no. The field can be used again.
	const discard = page.getByRole( 'button', { name: 'Discard them and check out PR #7', exact: true } );
	await expect( discard ).toBeVisible( { timeout: 30_000 } );
	// The question's own Cancel, in the work-item card: the preview's, on its
	// way out, has one of the same name.
	await ui.workItemCard( page, 'Trac ticket' ).getByRole( 'button', { name: 'Cancel', exact: true } ).click();
	await expect( discard ).toHaveCount( 0 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( ui.prField( card ) ).toBeEnabled();
	expect( currentBranch( site.dir ) ).toBe( 'trunk' );
	expect( read( site.dir, DOOMED ) ).toBe( mine );
} );
