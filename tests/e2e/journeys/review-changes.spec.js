/**
 * "Review & submit changes": reading your own changes, and sending them off
 * the way that needs no account (#553).
 *
 * The dialog opens on the diff: what this site has that its copy of trunk does
 * not. It is the last look a contributor gets at their work before it becomes
 * a patch or a pull request, and the pane around it is where that work can be
 * saved to a file, copied, or thrown away. So the diff has to be the tree's,
 * the file has to hold it, and discarding has to say so and leave the pane
 * showing what is left, which is nothing. That is the first journey here.
 *
 * Beside the diff are the places the patch can go. The second journey is one
 * of them, handing the patch to a mentor. The pull request is
 * `open-pull-request.spec.js`, and which destinations a site offers at all is
 * `gutenberg-site.spec.js`. A diff that could not be read is in
 * `pr-checkout.spec.js`.
 *
 * Copying is asked of a stand-in. The button writes to the system clipboard,
 * and a journey that let it would replace whatever the person running the
 * suite had on theirs.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, read, write, LOGIN } = require( '../helpers/git-site.cjs' );
const { discardDisabledReason } = require( '../../../src/renderer/changes-note.cjs' );
const { parseHandle } = require( '../../../src/wporg-handle.cjs' );
const { TITLE } = require( '../../../src/patch-provenance.cjs' );

const MY_EDIT = '<?php // my fix\n';

test( 'the review pane shows the tree\'s diff, saves it to the file chosen, says when it could not, and is empty after a discard', async ( { session } ) => {
	const site = await makeSite( session );
	const saveDir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-review-' ) ) );
	const savedFile = path.join( saveDir, 'my-fix.diff' );
	const { app, page } = await session.start( site.settings );
	const confirmsAnswered = await session.acceptConfirms();
	// The save dialog is the operating system's; the test answers for it, and
	// counts how often it was asked.
	const answerSaveDialog = ( answer ) => app.evaluate( ( { dialog }, result ) => {
		dialog.showSaveDialog = async () => {
			global.__e2eSaveDialogs = ( global.__e2eSaveDialogs || 0 ) + 1;
			return result;
		};
	}, answer );
	const saveDialogsAnswered = () => app.evaluate( () => global.__e2eSaveDialogs || 0 );

	write( site.dir, LOGIN, MY_EDIT );
	await ui.reviewChangesButton( page ).click();
	const dialog = page.getByRole( 'dialog', { name: 'Review & submit changes' } );
	const save = dialog.getByRole( 'button', { name: 'Save', exact: true } );

	// The pane is found by the line that says what it holds; the wording is a
	// CHARACTERISATION, pinned by the unit test of the module that words it.
	await expect( dialog.getByText( 'Everything this site has that its copy of trunk does not.', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	// INVARIANT — the pane is the diff of the tree against trunk: the line that
	// went and the line that came, under the file's name as the patch writes it.
	await expect( dialog.getByText( '+++ b/src/wp-login.php', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( '-<?php // trunk', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( '+<?php // my fix', { exact: true } ) ).toBeVisible();

	// INVARIANT — backing out of the save dialog reports nothing: no "Saved
	// to", and no error for a save that was never attempted.
	//
	// Nothing on screen changes when a save is backed out of, so there is
	// nothing to wait for there. The test waits for the save dialog to have
	// been answered, then asks the main process one more question and waits
	// for that answer: the reply to the save was sent before it, so by then the
	// pane has heard how the save went.
	await answerSaveDialog( { canceled: true } );
	await save.click();
	await expect.poll( saveDialogsAnswered ).toBe( 1 );
	await page.evaluate( () => window.api.getSitesWithMeta() );
	await expect( dialog.getByText( /^Saved to / ) ).toHaveCount( 0 );
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );

	// INVARIANT — a save that fails says so in the pane, with the reason, and
	// claims no file.
	await answerSaveDialog( { canceled: false, filePath: path.join( saveDir, 'no-such-folder', 'my-fix.diff' ) } );
	await save.click();
	await expect( dialog.getByRole( 'alert' ).filter( { hasText: /^Could not save the patch: .*ENOENT/ } ) ).toBeVisible();
	await expect( dialog.getByText( /^Saved to / ) ).toHaveCount( 0 );

	// INVARIANT — a save that works writes the diff on screen to the file that
	// was chosen, names that file in the pane, and takes the earlier failure
	// away.
	await answerSaveDialog( { canceled: false, filePath: savedFile } );
	await save.click();
	await expect( dialog.getByText( `Saved to ${ savedFile }`, { exact: true } ) ).toBeVisible();
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );
	expect( fs.readFileSync( savedFile, 'utf8' ) ).toContain( '+<?php // my fix' );

	// INVARIANT — the button that copies says how the copy went, on itself:
	// the diff on screen is what was copied, and a copy that failed is not
	// reported as one that worked.
	const copyButton = dialog.getByRole( 'button', { name: /^(Copy|Copied|Could not copy)$/ } );
	await page.evaluate( () => {
		navigator.clipboard.writeText = async ( text ) => {
			window.__e2eCopied = text;
		};
	} );
	await expect( copyButton ).toHaveAccessibleName( 'Copy' );
	await copyButton.click();
	await expect( copyButton ).toHaveAccessibleName( 'Copied' );
	expect( await page.evaluate( () => window.__e2eCopied ) ).toContain( '+<?php // my fix' );
	await page.evaluate( () => {
		navigator.clipboard.writeText = async () => {
			throw new Error( 'the document is not focused' );
		};
	} );
	await copyButton.click();
	await expect( copyButton ).toHaveAccessibleName( 'Could not copy' );

	// INVARIANT — discarding asks first, puts the file back, and the pane then
	// shows what is left to send: nothing, and it says so rather than showing
	// an empty box.
	await dialog.getByRole( 'button', { name: 'Discard all changes', exact: true } ).click();
	await expect( dialog.getByText( 'No changes.', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( dialog.getByText( 'There is nothing to send yet — this site has no changes against its copy of trunk.', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( '+<?php // my fix', { exact: true } ) ).toHaveCount( 0 );
	expect( await confirmsAnswered() ).toBe( 1 );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // trunk\n' );

	// INVARIANT — with nothing to discard, the control is off and says why,
	// instead of offering to do it again.
	const discard = dialog.getByRole( 'button', { name: 'Discard all changes', exact: true } );
	await expect( discard ).toBeDisabled();
	await expect( discard ).toHaveAccessibleDescription( discardDisabledReason( { patchHasChanges: false } ) );
} );

/**
 * Handing the patch to a mentor (#166).
 *
 * The one way out of the dialog that needs no account anywhere: the patch is
 * saved with the contributor's WordPress.org username and the event they are
 * at written into it, so whoever pushes it knows whose props it carries. The
 * app asks for the two once and remembers them for every site. So what is
 * typed has to be what is remembered, a name that is not a username has to be
 * turned away with the reason, and the saved file has to say what the dialog
 * said it would.
 */
test( 'handing a patch to a mentor asks for a username once, refuses one that is not, and saves a patch that carries it', async ( { session } ) => {
	const site = await makeSite( session );
	const saveDir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-handoff-' ) ) );
	const savedFile = path.join( saveDir, 'handoff.diff' );
	const { app, page } = await session.start( site.settings );
	// The save dialog is the operating system's; the test answers for it, and
	// keeps the name the app proposed.
	await app.evaluate( ( { dialog }, filePath ) => {
		dialog.showSaveDialog = async ( options ) => {
			global.__e2eProposedName = options.defaultPath;
			return { canceled: false, filePath };
		};
	}, savedFile );

	write( site.dir, LOGIN, MY_EDIT );
	const openDialog = async () => {
		await ui.reviewChangesButton( page ).click();
		await expect( dialog.getByText( 'Hand it to a mentor', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	};
	const dialog = page.getByRole( 'dialog', { name: 'Review & submit changes' } );
	const username = dialog.getByLabel( 'WordPress.org username', { exact: true } );
	const event = dialog.getByLabel( 'Event this patch was written at', { exact: true } );
	const remember = dialog.getByRole( 'button', { name: 'Remember this', exact: true } );
	const saveAs = ( handle ) => dialog.getByRole( 'button', { name: `Save patch as ${ handle }`, exact: true } );
	await openDialog();

	// INVARIANT — before the first answer there is nothing to save as and
	// nothing to remember: the form is shown, and its button is off until
	// there is a name in it.
	await expect( username ).toHaveValue( '' );
	await expect( remember ).toBeDisabled();
	await expect( dialog.getByRole( 'button', { name: /^Save patch as / } ) ).toHaveCount( 0 );

	// INVARIANT — a name typed and abandoned is not waiting in the form the
	// next time the dialog opens.
	await username.fill( 'abandoned' );
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );
	await openDialog();
	await expect( username ).toHaveValue( '' );

	// INVARIANT — a name that is not a WordPress.org username is turned away,
	// with the reason, and nothing is remembered.
	await username.fill( 'jane doe!' );
	await remember.click();
	await expect( dialog.getByRole( 'alert' ).filter( { hasText: parseHandle( 'jane doe!' ).error } ) ).toBeVisible();
	expect( session.readSettings().preferences.wporgHandle ).toBeFalsy();

	// INVARIANT — typing a new name takes the complaint about the last one
	// away, and a username and an event, once given, are what the dialog offers
	// to save as and says the patch will carry.
	await username.fill( 'janedoe' );
	await expect( dialog.getByRole( 'alert' ) ).toHaveCount( 0 );
	await event.fill( 'WordCamp Test 2026' );
	await remember.click();
	await expect( saveAs( 'janedoe' ) ).toBeVisible();
	await expect( dialog.getByText( 'The patch will say it was written at WordCamp Test 2026.', { exact: true } ) ).toBeVisible();
	// CHARACTERISATION — they are the app's, not the site's: kept in its
	// preferences.
	expect( session.readSettings().preferences ).toMatchObject( { wporgHandle: 'janedoe', contributionEvent: 'WordCamp Test 2026' } );

	// INVARIANT — changing them starts from what is remembered, and an event
	// left empty is an event cleared, which the dialog then says.
	await dialog.getByRole( 'button', { name: 'Change these', exact: true } ).click();
	await expect( username ).toHaveValue( 'janedoe' );
	await expect( event ).toHaveValue( 'WordCamp Test 2026' );
	await event.fill( '' );
	await remember.click();
	await expect( dialog.getByText( 'No event on the patch.', { exact: true } ) ).toBeVisible();

	// INVARIANT — the file says what the dialog said it would: it opens as a
	// patch from this app, names the contributor, names no event because the
	// dialog had just said there was none, and holds the diff. It is proposed
	// under a name that carries the username, and the pane names where it went.
	await saveAs( 'janedoe' ).click();
	await expect( dialog.getByText( `Saved to ${ savedFile }`, { exact: true } ) ).toBeVisible();
	const saved = fs.readFileSync( savedFile, 'utf8' );
	expect( saved.startsWith( TITLE ) ).toBe( true );
	expect( saved ).toContain( '# Contributor: janedoe (wordpress.org)\n' );
	expect( saved ).not.toMatch( /^# Event:/m );
	expect( saved ).toContain( '+<?php // my fix' );
	expect( path.basename( await app.evaluate( () => global.__e2eProposedName ) ) ).toBe( 'janedoe.diff' );

	// INVARIANT — a change begun and abandoned changes nothing: the next time
	// the dialog opens it offers the name that was remembered, not the form.
	await dialog.getByRole( 'button', { name: 'Change these', exact: true } ).click();
	await username.fill( 'someoneelse' );
	await page.keyboard.press( 'Escape' );
	await expect( dialog ).toHaveCount( 0 );
	await openDialog();
	await expect( saveAs( 'janedoe' ) ).toBeVisible();
	await expect( username ).toHaveCount( 0 );
} );
