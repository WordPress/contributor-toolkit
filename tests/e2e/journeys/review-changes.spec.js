/**
 * Reading your own changes before they go anywhere (#553).
 *
 * "Review & submit changes" opens on the diff: what this site has that its
 * copy of trunk does not. It is the last look a contributor gets at their work
 * before it becomes a patch or a pull request, and the pane around it is where
 * that work can be saved to a file, copied, or thrown away. So the diff has to
 * be the tree's, the file has to hold it, and discarding has to say so and
 * leave the pane showing what is left, which is nothing.
 *
 * Where the patch goes from here, the destinations on the right, is
 * `open-pull-request.spec.js` and `gutenberg-site.spec.js`. A diff that could
 * not be read is in `pr-checkout.spec.js`.
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
