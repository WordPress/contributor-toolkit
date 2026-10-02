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
const { makeSite, makePatchFile, read, write, LOGIN } = require( '../helpers/git-site.cjs' );

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

	// INVARIANT — applying it closes the dialog, and once it is applied the
	// card says so and is still on the tab it was left on, though its fields
	// went while the patch was applied.
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFileButton( card ).click();
	await ui.applyAndRebuildButton( preview ).click();
	await expect( preview ).toHaveCount( 0 );
	await expect( ui.revertPatchButton( card ) ).toBeVisible( { timeout: 60_000 } );
	expect( read( site.dir, LOGIN ) ).toBe( `${ PATCHED_LOGIN }\n` );
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
