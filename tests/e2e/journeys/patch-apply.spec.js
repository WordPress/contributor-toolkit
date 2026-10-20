/**
 * Applying and reverting a patch, driven through the app (#361).
 *
 * The other half of a contributor's day: someone else's work arrives as a patch
 * file, and it has to go onto the checkout and come off again without taking
 * anything of theirs with it. #350 changes what "applied" means —
 * today it is a layer the app holds, afterwards it is a commit — so what is
 * pinned here is the part that must survive either model.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see ticket-branches.spec.js
 * for what the distinction buys during that refactor.
 *
 * The patch arrives from a local file through the app's own file dialog, answered
 * from the test. Nothing here fetches a pull request: that would put a third
 * party in the path of a test that is about the checkout.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { gitOk, commitFiles } = require( '../../unit/helpers/git.cjs' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const {
	makeSite,
	makePatchFile,
	read,
	write,
	SUBSTRATE,
	SUBSTRATE_CONTENT,
	LOGIN,
	DOOMED,
} = require( '../helpers/git-site.cjs' );

const TRUNK_LOGIN = '<?php // trunk';
const PATCHED_LOGIN = '<?php // fixed by the patch';

/**
 * Chooses a patch file and confirms the preview the app shows before writing.
 *
 * @param {Object} session
 * @param {string} patchFile
 */
async function applyPatchFile( session, patchFile ) {
	const { page } = session;
	await session.answerFileDialog( [ patchFile ] );
	await ui.choosePatchFile( page );

	// The preview is a gate, not a formality: it is the app saying what it is
	// about to write, before anything is written. It names `src/wp-login.php`
	// though the patch says `wp-login.php`, because the app rewrites paths
	// written against core's pre-`src/` layout — see src/patch-plan.cjs.
	await expect( page.getByRole( 'dialog' ).getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await ui.applyAndRebuildButton( page ).click();
}

test( 'applying a patch file changes the checkout and records what was applied', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );

	// The offer to undo is the app saying the apply finished, and it is on the
	// same card. Waiting for it beats waiting for a rebuild that a slower runner
	// may still be finishing.
	await expect( ui.revertPatchButton( page ) ).toBeVisible( {
		timeout: 60_000,
	} );

	// INVARIANT — the patch is on disk, in the working tree, not merely recorded.
	expect( read( site.dir, LOGIN ) ).toBe( `${ PATCHED_LOGIN }\n` );

	// INVARIANT — and it wrote nothing else. The substrate is what a rebuild
	// would be most likely to take with it.
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );

	// CHARACTERISATION — today the applied patch is a record the app holds
	// against the branch, naming the files it touched. After #350 it should be a
	// commit; this assertion is the one that will say so.
	const meta = session.readSettings().siteMeta[ site.dir ];
	const applied = meta.branches[ 'ticket/60001' ].appliedPatch;
	expect( applied.label ).toBe( 'ticket-60001.patch' );
	// The rewritten path, not the one the patch named: what the record has to
	// describe is what changed on disk.
	expect( applied.files ).toEqual( [ 'src/wp-login.php' ] );
} );

test( 'reverting puts the checkout back and leaves unrelated work alone', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	// The contributor's own work, in a file the patch does not touch. Reverting
	// somebody else's patch must not reach it.
	write( site.dir, DOOMED, '<?php // my own work in progress\n' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	const revert = ui.revertPatchButton( page );
	await expect( revert ).toBeVisible( { timeout: 60_000 } );

	await revert.click();
	await expect( revert ).toHaveCount( 0, { timeout: 60_000 } );
	// The button leaves the moment the revert starts, so it is not the signal
	// that the revert finished. The next-step line is: it names the operation
	// while it runs and moves on once the status has been reloaded, which
	// happens after the checkout and the record are both written.
	await expect( page.getByText( 'A patch is being applied or reverted.' ) ).toHaveCount( 0, { timeout: 60_000 } );

	// INVARIANT — the patched file is back, byte for byte.
	expect( read( site.dir, LOGIN ) ).toBe( `${ TRUNK_LOGIN }\n` );

	// INVARIANT — and the contributor's own edit survived both directions. This
	// is the failure that costs somebody their afternoon and reports nothing.
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // my own work in progress\n' );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	// CHARACTERISATION — the record goes with it.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.branches[ 'ticket/60001' ].appliedPatch ).toBeFalsy();
} );

const EDITOR = { name: 'Example Editor', path: path.join( os.tmpdir(), 'example-editor' ) };

/**
 * Stands in for the handlers that reach other applications, and keeps what
 * each was asked. Detection finds `editors`, which may be none; opening in an
 * editor answers with `answers` in turn, then `{ ok: true }`.
 *
 * @param {Object}   app
 * @param {Object[]} editors   `{ name, path }`.
 * @param {Object[]} [answers] What `editor:open` says, first call first.
 * @return {Promise<Function>} Resolves to what was asked so far.
 */
async function standInForApplications( app, editors, answers = [] ) {
	await app.evaluate( ( { ipcMain }, { detected, queued } ) => {
		const asked = { opens: [], shows: [] };
		global.__e2eApplications = asked;
		const replace = ( channel, handler ) => {
			ipcMain.removeHandler( channel );
			ipcMain.handle( channel, handler );
		};
		replace( 'editor:list', () => ( { detected } ) );
		replace( 'editor:open', ( event, sitePath, editorPath, relPath ) => {
			asked.opens.push( { sitePath, editorPath, relPath } );
			return queued.shift() || { ok: true };
		} );
		replace( 'dir:show', ( event, sitePath, relPath ) => {
			asked.shows.push( { sitePath, relPath } );
			return { ok: true };
		} );
	}, { detected: editors, queued: answers } );
	return () => app.evaluate( () => global.__e2eApplications );
}

// The file in the open site's details, by its path, and nowhere else: the
// preview names the same path while it is up. Drawn as a link, it is a
// button, because it opens an application rather than going anywhere. It is
// named by the file's own name, its folders being the rows above it in the
// tree, and carries its whole path as its tooltip.
const affectedFile = ( page, file ) => page
	.getByRole( 'complementary', { name: 'Details of e2e-site', exact: true } )
	.getByRole( 'button', { name: file.split( '/' ).pop(), exact: true } )
	.and( page.locator( `[title="${ file }"]` ) );

// The open site's details, and a file in them by its path.
const details = ( page ) => page.getByRole( 'complementary', { name: 'Details of e2e-site', exact: true } );
const group = ( page, name ) => details( page ).getByRole( 'heading', { level: 3, name, exact: true } );
// Asks for the answer the app asks for when its window gets focus back,
// which is when a contributor returns from their editor.
const refocus = ( page ) => page.evaluate( () => window.dispatchEvent( new Event( 'focus' ) ) );

test( 'each file the applied patch changed opens in the editor from the details (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const asked = await standInForApplications( app, [ EDITOR ] );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( { timeout: 60_000 } );

	// INVARIANT — the file looks like something to click: underlined, with a
	// file's icon beside it. A button drawn as a link has no underline of its
	// own, and without one the path read as plain text.
	const file = affectedFile( page, 'src/wp-login.php' );
	await expect( file ).toHaveCSS( 'text-decoration-line', 'underline' );
	// And it ends the details, so a long list never pushes the server and the
	// build watch out of reach; its folder is a row of the tree above it.
	await expect( details( page ).getByRole( 'heading', { level: 2 } ).last() ).toHaveText( 'Changed files' );
	const tree = details( page ).getByRole( 'treegrid' );
	await expect( tree.getByRole( 'row' ) ).toHaveText( [ 'src', 'wp-login.php' ] );
	// INVARIANT — a folder closes and opens, by its button and by the arrow
	// keys, and Down moves from a folder to the file under it.
	const folder = tree.getByRole( 'button', { name: 'src', exact: true } );
	await folder.click();
	await expect( tree.getByRole( 'row' ) ).toHaveText( [ 'src' ] );
	await folder.press( 'ArrowRight' );
	await expect( tree.getByRole( 'row' ) ).toHaveText( [ 'src', 'wp-login.php' ] );
	await folder.press( 'ArrowDown' );
	await expect( file ).toBeFocused();
	await expect( file.locator( '..' ).locator( 'svg' ) ).toHaveCount( 1 );

	// INVARIANT — the file is listed once the patch is applied, and one click
	// opens it in the editor detection found, inside the site. The site's menu
	// is never opened first: the click must not depend on it having been.
	await file.click();
	await expect.poll( async () => ( await asked() ).opens ).toEqual( [
		{ sitePath: site.dir, editorPath: EDITOR.path, relPath: 'src/wp-login.php' },
	] );

	// INVARIANT — the list goes with the patch: not hidden behind a dialog,
	// gone from details that can be read.
	await ui.revertPatchButton( page ).click();
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0, { timeout: 60_000 } );
	await expect( page.getByText( 'A patch is being applied or reverted.' ) ).toHaveCount( 0, { timeout: 60_000 } );
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( ui.confirmDialog( page ) ).toHaveCount( 0 );
	await expect( details( page ).getByRole( 'heading', { level: 2, name: 'Details', exact: true } ) ).toBeVisible();
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toHaveCount( 0 );
} );

test( 'choosing another application after a file would not open opens that file in it (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const asked = await standInForApplications( app, [ EDITOR ], [ { ok: false, reason: 'spawn-failed', error: 'EACCES' } ] );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( { timeout: 60_000 } );

	await affectedFile( page, 'src/wp-login.php' ).click();
	await page.getByRole( 'button', { name: 'Choose application…', exact: true } ).click();

	// INVARIANT — the way out the notice offers opens the same file, in the
	// application picked (null: main's file dialog), not the bare site.
	await expect.poll( async () => ( await asked() ).opens ).toEqual( [
		{ sitePath: site.dir, editorPath: EDITOR.path, relPath: 'src/wp-login.php' },
		{ sitePath: site.dir, editorPath: null, relPath: 'src/wp-login.php' },
	] );
} );

test( 'with no editor on the machine, an applied file is shown in the file manager (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	const asked = await standInForApplications( app, [] );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( { timeout: 60_000 } );

	// INVARIANT — a link that does nothing is the failure this replaces, so
	// with nothing to open it in, the file is shown where it is.
	await affectedFile( page, 'src/wp-login.php' ).click();
	await expect.poll( async () => ( await asked() ).shows ).toEqual( [
		{ sitePath: site.dir, relPath: 'src/wp-login.php' },
	] );
	expect( ( await asked() ).opens ).toEqual( [] );
} );

test( 'files edited or added after a patch are told apart from the patch\'s own (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( { timeout: 60_000 } );

	// INVARIANT — straight after the apply, everything changed is the patch's:
	// nothing under "Your changes", and the patched file is not "also edited".
	await expect( group( page, 'From the patch' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( group( page, 'Your changes' ) ).toHaveCount( 0 );
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByRole( 'img', { name: 'You edited this file', exact: true } ) ).toHaveCount( 0 );

	// The contributor works on top: an edit to the patched file, and a file
	// of their own.
	write( site.dir, LOGIN, '<?php // fixed by the patch, then by me\n' );
	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	await refocus( page );

	// INVARIANT — the patched file stays the patch's, marked as edited since;
	// the new file is the contributor's, marked new. Each is listed once.
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByRole( 'img', { name: 'You edited this file', exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( affectedFile( page, 'src/new-helper.php' ).locator( '..' ).getByRole( 'img', { name: 'You created this file', exact: true } ) ).toBeVisible();
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toHaveCount( 1 );
	expect( await ui.inDocumentOrder( page, [
		group( page, 'From the patch' ),
		affectedFile( page, 'src/wp-login.php' ),
		group( page, 'Your changes' ),
		affectedFile( page, 'src/new-helper.php' ),
	] ) ).toBe( true );
} );

// "Discard your changes" takes the contributor's work and leaves the patch
// (#669): the patched file goes back to what the patch wrote, their own file
// goes, and the patch can still be reverted afterwards.
test( 'discarding your changes keeps the applied patch (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( { timeout: 60_000 } );

	write( site.dir, LOGIN, '<?php // fixed by the patch, then by me\n' );
	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	await refocus( page );
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByRole( 'img', { name: 'You edited this file', exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( affectedFile( page, 'src/new-helper.php' ) ).toBeVisible();

	await ui.reviewChangesButton( page ).click();
	const review = page.getByRole( 'dialog', { name: 'Review & submit changes' } );
	await review.getByRole( 'button', { name: 'Discard your changes', exact: true } ).click();

	// INVARIANT — the question says what goes and what stays, before anything goes.
	const question = ui.confirmDialog( page );
	await expect( question ).toHaveAccessibleName( 'Discard your changes?' );
	await expect( question.getByText( 'Your edits to 2 files are removed. The patch ticket-60001.patch stays applied. This can’t be undone.', { exact: true } ) ).toBeVisible();
	expect( fs.existsSync( path.join( site.dir, 'src/new-helper.php' ) ) ).toBe( true );

	await ui.confirmYesButton( page, 'Discard changes' ).click();
	await expect.poll( () => fs.existsSync( path.join( site.dir, 'src/new-helper.php' ) ), { timeout: 30_000 } ).toBe( false );
	await ui.closeDialogButton( review ).click();
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( ui.confirmDialog( page ) ).toHaveCount( 0 );

	// INVARIANT — the patched file is as the patch left it, not as trunk had it.
	expect( read( site.dir, LOGIN ) ).toBe( `${ PATCHED_LOGIN }\n` );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	// INVARIANT — the patch is still applied, and the list says the file is the
	// patch's alone again.
	await expect( ui.revertPatchButton( page ) ).toBeVisible();
	await expect( group( page, 'From the patch' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( group( page, 'Your changes' ) ).toHaveCount( 0 );
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByRole( 'img', { name: 'You edited this file', exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — with nothing of the contributor's left, the discard is off
	// and says why, instead of resetting and re-applying to remove nothing.
	await ui.reviewChangesButton( page ).click();
	const again = review.getByRole( 'button', { name: 'Discard your changes', exact: true } );
	await expect( again ).toBeDisabled( { timeout: 30_000 } );
	await expect( again ).toHaveAccessibleDescription( 'There are no edits of yours to discard.' );
	await ui.closeDialogButton( review ).click();
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );

	// INVARIANT — and it still comes off cleanly.
	await ui.revertPatchButton( page ).click();
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0, { timeout: 60_000 } );
	await expect( page.getByText( 'A patch is being applied or reverted.' ) ).toHaveCount( 0, { timeout: 60_000 } );
	expect( read( site.dir, LOGIN ) ).toBe( `${ TRUNK_LOGIN }\n` );
} );

// The escape hatch is the other discard (#669): for a patch the app cannot
// lift back out, "Discard this ticket to its base" has to take the patch too,
// where "Discard your changes" would keep it.
test( 'discarding a ticket to its base removes a patch too large to revert (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	// Over the size the app keeps a copy of for an undo.
	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: `${ PATCHED_LOGIN } ${ 'x'.repeat( 600 * 1024 ) }` },
	] );
	await applyPatchFile( session, patch );
	const toBase = page.getByRole( 'button', { name: 'Discard this ticket to its base', exact: true } );
	await expect( toBase ).toBeVisible( { timeout: 60_000 } );
	write( site.dir, DOOMED, '<?php // my own work in progress\n' );

	await toBase.click();

	// INVARIANT — it asks the full-wipe question, not "Discard your changes?".
	const question = ui.confirmDialog( page );
	await expect( question ).toHaveAccessibleName( 'Discard all local changes?' );
	await ui.confirmYesButton( page, 'Discard changes' ).click();

	// INVARIANT — the patch is gone with the contributor's work, and so is its record.
	await expect.poll( () => read( site.dir, LOGIN ), { timeout: 30_000 } ).toBe( `${ TRUNK_LOGIN }\n` );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	await expect( toBase ).toHaveCount( 0, { timeout: 30_000 } );
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.branches[ 'ticket/60001' ].appliedPatch ).toBeFalsy();
} );

// One file at a time, as "Discard your changes" would leave it (#669): a new
// file goes, a file of the contributor's goes back to the base, and the
// patch's own file goes back to what the patch wrote, with the patch still
// applied. A patch file nobody touched offers no revert.
test( 'each file the contributor changed can be reverted on its own (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( { timeout: 60_000 } );
	const revertButton = ( file ) => details( page ).getByRole( 'button', { name: `Revert ${ file }`, exact: true } );

	// INVARIANT — the patch's own file, untouched, has nothing to revert.
	await expect( group( page, 'From the patch' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( revertButton( 'src/wp-login.php' ) ).toHaveCount( 0 );

	write( site.dir, LOGIN, '<?php // fixed by the patch, then by me\n' );
	write( site.dir, DOOMED, '<?php // my own work in progress\n' );
	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	await refocus( page );
	await expect( revertButton( 'src/new-helper.php' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the revert button is in the tree's reach of the arrow keys:
	// Right from the file's name moves to it, Left goes back, and the mark is
	// the name's description, since it cannot be reached itself.
	await affectedFile( page, 'src/wp-login.php' ).focus();
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toHaveAccessibleDescription( 'You edited this file' );
	await page.keyboard.press( 'ArrowRight' );
	await expect( revertButton( 'src/wp-login.php' ) ).toBeFocused();
	// INVARIANT — a focus ring, drawn outside what has the focus, is not cut
	// off by either edge of the details, which clip what passes them: not the
	// revert button's at the end of a row, nor a file's or a folder's.
	const ringInside = ( locator ) => locator.evaluate( ( element ) => {
		const style = window.getComputedStyle( element );
		const ring = parseFloat( style.outlineWidth ) + parseFloat( style.outlineOffset );
		const box = element.getBoundingClientRect();
		const slot = element.closest( '.dashboard-sidebar-slot' ).getBoundingClientRect();
		return box.left - ring >= slot.left && box.right + ring <= slot.right;
	} );
	expect( await ringInside( revertButton( 'src/wp-login.php' ) ) ).toBe( true );
	await page.keyboard.press( 'ArrowLeft' );
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toBeFocused();
	expect( await ringInside( affectedFile( page, 'src/wp-login.php' ) ) ).toBe( true );
	const folder = details( page ).locator( '.affected-files-folder' ).first();
	await folder.focus();
	expect( await ringInside( folder ) ).toBe( true );
	await affectedFile( page, 'src/wp-login.php' ).focus();

	// INVARIANT — a file the contributor created is deleted, after asking so.
	await revertButton( 'src/new-helper.php' ).click();
	await expect( ui.confirmDialog( page ) ).toHaveAccessibleName( 'Delete src/new-helper.php?' );
	await ui.confirmYesButton( page, 'Delete file' ).click();
	await expect.poll( () => fs.existsSync( path.join( site.dir, 'src/new-helper.php' ) ), { timeout: 30_000 } ).toBe( false );
	await expect( affectedFile( page, 'src/new-helper.php' ) ).toHaveCount( 0, { timeout: 30_000 } );

	// INVARIANT — a file of the contributor's goes back to the base, and
	// nothing else moves.
	await revertButton( 'src/doomed.php' ).click();
	await expect( ui.confirmDialog( page ) ).toHaveAccessibleName( 'Revert src/doomed.php?' );
	await ui.confirmYesButton( page, 'Revert file' ).click();
	await expect.poll( () => read( site.dir, DOOMED ), { timeout: 30_000 } ).toBe( '<?php // to be deleted\n' );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // fixed by the patch, then by me\n' );

	// INVARIANT — the patch's file goes back to what the patch wrote, and the
	// patch is still applied.
	await revertButton( 'src/wp-login.php' ).click();
	await expect( ui.confirmDialog( page ).getByText( 'Your edits to it are removed, and it goes back to how the patch left it. This can’t be undone.', { exact: true } ) ).toBeVisible();
	await ui.confirmYesButton( page, 'Revert file' ).click();
	await expect.poll( () => read( site.dir, LOGIN ), { timeout: 30_000 } ).toBe( `${ PATCHED_LOGIN }\n` );
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByRole( 'img', { name: 'You edited this file', exact: true } ) ).toHaveCount( 0, { timeout: 30_000 } );
	await expect( revertButton( 'src/wp-login.php' ) ).toHaveCount( 0 );
	await expect( group( page, 'Your changes' ) ).toHaveCount( 0 );
	await expect( ui.revertPatchButton( page ) ).toBeVisible();
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );
} );

test( 'a ticket with no patch lists only the contributor\'s own changes (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	write( site.dir, LOGIN, '<?php // my fix\n' );
	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	await refocus( page );

	// INVARIANT — the section is there for work with nothing applied, with the
	// one group, and the new file marked new and the edited one not.
	await expect( group( page, 'Your changes' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( details( page ).getByRole( 'heading', { level: 3 } ) ).toHaveCount( 1 );
	await expect( affectedFile( page, 'src/new-helper.php' ).locator( '..' ).getByRole( 'img', { name: 'You created this file', exact: true } ) ).toBeVisible();
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByRole( 'img', { name: 'You created this file', exact: true } ) ).toHaveCount( 0 );
} );

test( 'while the build after an apply runs, the patch\'s files are the patch\'s (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );
	// A build that runs until the test ends: the stand-in answers with the
	// run's name and starts no process, so the apply stays at its build.
	await app.evaluate( ( { ipcMain } ) => {
		ipcMain.removeHandler( 'npm:run-script' );
		ipcMain.handle( 'npm:run-script', () => ( { runId: 'e2e-run-1' } ) );
	} );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );

	// INVARIANT — the file list is walked as soon as the patch is on disk, and
	// grouped by the patch now applied rather than by the nothing before it:
	// the patched file is the patch's, not the contributor's, for the minutes
	// an install and a build take. It fails if the status is read only once
	// the build is over.
	await expect( group( page, 'From the patch' ) ).toBeVisible( { timeout: 30_000 } );
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toBeVisible();
	await expect( group( page, 'Your changes' ) ).toHaveCount( 0 );
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0 );
} );

test( 'a file that leaves the list does not take its tree out of the tab order (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );
	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	write( site.dir, 'src/other-helper.php', '<?php // mine too\n' );
	await refocus( page );
	await expect( affectedFile( page, 'src/other-helper.php' ) ).toBeVisible( { timeout: 30_000 } );

	// The tree remembers the last button focused in it, and gives every other
	// one no tab stop. That file goes, undone in the editor, and the list is
	// walked again on the way back.
	await affectedFile( page, 'src/new-helper.php' ).focus();
	fs.rmSync( path.join( site.dir, 'src/new-helper.php' ) );
	await refocus( page );
	await expect( affectedFile( page, 'src/new-helper.php' ) ).toHaveCount( 0, { timeout: 30_000 } );

	// INVARIANT — the tree keeps a button Tab can stop at.
	expect( await details( page ).getByRole( 'treegrid' ).evaluateAll( ( trees ) => trees.map(
		( tree ) => [ ...tree.querySelectorAll( 'button' ) ].some( ( button ) => button.tabIndex >= 0 )
	) ) ).toEqual( [ true ] );
} );

test( 'discarding the contributor\'s changes takes them out of the list, with no refocus (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// Counts the walks the list is measured by, so the discard below happens
	// with none in flight. One still running when it lands would answer after
	// it and clear the list by luck, and this would pass without the fix.
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eProbes = 0;
		const handler = ipcMain._invokeHandlers.get( 'git:unsubmitted-work' );
		ipcMain.removeHandler( 'git:unsubmitted-work' );
		ipcMain.handle( 'git:unsubmitted-work', ( ...args ) => {
			global.__e2eProbes += 1;
			return handler( ...args );
		} );
	} );
	const probes = () => app.evaluate( () => global.__e2eProbes );
	await ui.linkTicket( page, '60001' );

	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	await refocus( page );
	await expect( affectedFile( page, 'src/new-helper.php' ) ).toBeVisible( { timeout: 30_000 } );
	// Settled: the count holds still across a second.
	await expect.poll( async () => {
		const before = await probes();
		await page.waitForTimeout( 1000 );
		return ( await probes() ) === before;
	}, { timeout: 30_000 } ).toBe( true );

	await ui.reviewChangesButton( page ).click();
	const review = page.getByRole( 'dialog', { name: 'Review & submit changes' } );
	await review.getByRole( 'button', { name: 'Discard your changes', exact: true } ).click();
	await ui.confirmYesButton( page, 'Discard changes' ).click();
	await expect.poll( () => fs.existsSync( path.join( site.dir, 'src/new-helper.php' ) ), { timeout: 30_000 } ).toBe( false );
	await ui.closeDialogButton( review ).click();
	// With every dialog gone and the details readable: while a modal is up the
	// page behind it is hidden from the accessibility tree, and the counts
	// below would be 0 whatever the list said.
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( ui.confirmDialog( page ) ).toHaveCount( 0 );
	await expect( details( page ).getByRole( 'heading', { level: 2, name: 'Details', exact: true } ) ).toBeVisible();

	// INVARIANT — the list follows the discard itself. The window never lost
	// focus, so a list that waited for the next focus would go on naming a
	// file that is gone.
	await expect( group( page, 'Your changes' ) ).toHaveCount( 0, { timeout: 30_000 } );
	await expect( affectedFile( page, 'src/new-helper.php' ) ).toHaveCount( 0 );
} );

test( 'a patch that does not fit is refused, and writes nothing', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );

	// The contributor has already edited the line the patch expects to find.
	const mine = '<?php // I got here first\n';
	write( site.dir, LOGIN, mine );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFile( page );
	await expect( page.getByRole( 'dialog' ).getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the app warns before writing, not after. A contributor about
	// to drop somebody else's patch onto their own edits is told so while they
	// can still stop.
	await expect(
		page.getByRole( 'alert' ).filter( { hasText: 'You have your own edits to src/wp-login.php' } )
	).toBeVisible();

	await ui.applyAndRebuildButton( page ).click();

	// INVARIANT — the refusal says the checkout was not touched, names the file,
	// and says how much of the patch failed. Asserted on the alert rather than on
	// the page: the preview above is still on screen and already names the file,
	// so a looser locator would pass whether or not the app reported anything.
	const failure = page.getByRole( 'alert' ).filter( { hasText: 'The checkout was not changed' } );
	await expect( failure ).toBeVisible( { timeout: 60_000 } );
	await expect( failure ).toContainText( 'src/wp-login.php' );

	// INVARIANT — all or nothing. A half-applied patch leaves a contributor with
	// a tree neither they nor the app can explain.
	expect( read( site.dir, LOGIN ) ).toBe( mine );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	// INVARIANT — and nothing is offered to undo, because nothing was done.
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0 );
} );

test( 'a refused patch leaves the contributor\'s changes listed (#669)', async ( { session } ) => {
	const site = await makeSite( session );
	const { app, page } = await session.start( site.settings );
	// Holds the walks the list is measured by once the apply starts, so a list
	// emptied by the refusal stays empty long enough to be seen. A walk that
	// answered at once would put it back before any assertion could look.
	await app.evaluate( ( { ipcMain } ) => {
		global.__e2eHold = null;
		const handler = ipcMain._invokeHandlers.get( 'git:unsubmitted-work' );
		ipcMain.removeHandler( 'git:unsubmitted-work' );
		ipcMain.handle( 'git:unsubmitted-work', async ( ...args ) => {
			if ( global.__e2eHold ) await global.__e2eHold.promise;
			return handler( ...args );
		} );
	} );
	await ui.linkTicket( page, '60001' );

	write( site.dir, LOGIN, '<?php // I got here first\n' );
	await refocus( page );
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toBeVisible( { timeout: 30_000 } );

	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFile( page );
	await expect( page.getByRole( 'dialog' ).getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await app.evaluate( () => {
		let release;
		const promise = new Promise( ( resolve ) => { release = resolve; } );
		global.__e2eHold = { promise, release };
	} );
	await ui.applyAndRebuildButton( page ).click();
	await expect( page.getByRole( 'alert' ).filter( { hasText: 'The checkout was not changed' } ) ).toBeVisible( { timeout: 60_000 } );
	// With every dialog gone and the details readable, so the count below is
	// the list's and not a modal hiding it.
	await expect( page.getByRole( 'dialog' ) ).toHaveCount( 0 );
	await expect( details( page ).getByRole( 'heading', { level: 2, name: 'Details', exact: true } ) ).toBeVisible();

	// INVARIANT — a refusal writes nothing, so the list it leaves is the list
	// from before it. Clearing it would empty the section until the next walk
	// answered, moving the sidebar just as the refusal is shown.
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toBeVisible();
	await app.evaluate( () => global.__e2eHold.release() );
} );


test( 'a partial patch failure restores the symlink and leaves no applied record (#413)', async ( { session } ) => {
	const site = await makeSite( session );
	const outsideDir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-outside-' ) ) );
	const outside = path.join( outsideDir, 'untouched.txt' );
	fs.writeFileSync( outside, 'outside\n' );
	const link = path.join( site.dir, 'src', 'link' );
	gitOk( [ 'config', 'core.symlinks', 'true' ], site.dir );
	fs.symlinkSync( 'wp-login.php', link, 'file' );
	write( site.dir, 'src/blocker', 'not a directory\n' );
	commitFiles( site.dir, [ 'src/link', 'src/blocker' ], 'patch failure fixture' );

	// Generate the symlink diff with bundled Git so Windows targets are encoded
	// correctly. Restore the fixture before the app sees it.
	fs.unlinkSync( link );
	fs.symlinkSync( outside, link, 'file' );
	const patch = path.join( outsideDir, 'blocked.patch' );
	gitOk( [ 'diff', '--output', patch, '--', 'src/link' ], site.dir );
	fs.appendFileSync( patch, `diff --git a/src/blocker/new.txt b/src/blocker/new.txt
new file mode 100644
--- /dev/null
+++ b/src/blocker/new.txt
@@ -0,0 +1 @@
+hello
` );
	fs.unlinkSync( link );
	fs.symlinkSync( 'wp-login.php', link, 'file' );

	const { page } = await session.start( site.settings );
	await ui.linkTicket( page, '60001' );
	await session.answerFileDialog( [ patch ] );
	await ui.choosePatchFile( page );
	await expect( page.getByText( 'src/link', { exact: true } ) ).toBeVisible();
	await ui.applyAndRebuildButton( page ).click();

	// INVARIANT: a partial write is reported as a failure, never as success.
	const failure = page.getByRole( 'alert' ).filter( { hasText: 'The checkout was not changed' } );
	await expect( failure ).toBeVisible();
	await expect( failure ).toContainText( 'src/blocker/new.txt' );

	// INVARIANT: recovery restores link identity without writing outside the site.
	expect( fs.readFileSync( outside, 'utf8' ) ).toBe( 'outside\n' );
	expect( fs.lstatSync( link ).isSymbolicLink() ).toBe( true );
	expect( fs.readlinkSync( link ) ).toBe( 'wp-login.php' );
	expect( read( site.dir, LOGIN ) ).toBe( `${ TRUNK_LOGIN }\n` );
	expect( read( site.dir, 'src/blocker' ) ).toBe( 'not a directory\n' );
	expect( fs.existsSync( path.join( site.dir, 'src/blocker/new.txt' ) ) ).toBe( false );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0 );

	// CHARACTERISATION: the failed patch is absent from the persisted ticket record.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.branches[ 'ticket/60001' ].appliedPatch ).toBeFalsy();
} );

test( 'work carried into a ticket takes the applied-patch record with it (#236)', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );

	// Applied on trunk, before any ticket is known — the order that produced
	// the bug. The edits are loose on the site, and so is the record.
	const patch = makePatchFile( session, 'ticket-60001.patch', [
		{ file: 'wp-login.php', from: TRUNK_LOGIN, to: PATCHED_LOGIN },
	] );
	await applyPatchFile( session, patch );
	await expect( ui.revertPatchButton( page ) ).toBeVisible( {
		timeout: 60_000,
	} );

	// Linking a ticket now asks what happens to the loose work (#234). Taking
	// it along is the path under test.
	await ui.ticketField( page ).first().fill( '60001' );
	await ui.linkTicketButton( page ).first().click();
	await page.getByRole( 'button', { name: 'Take these edits into #60001', exact: true } ).click();
	await expect( ui.workItemNumber( page, '60001' ).first() ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — the files came along.
	expect( read( site.dir, LOGIN ) ).toBe( `${ PATCHED_LOGIN }\n` );

	// INVARIANT — and so did the claim about them. Split, this is the bug: the
	// changes on the ticket, the record on trunk.
	const carried = session.readSettings().siteMeta[ site.dir ];
	expect( carried.branches[ 'ticket/60001' ].appliedPatch.label ).toBe( 'ticket-60001.patch' );
	expect( carried.appliedPatch ).toBeFalsy();

	// INVARIANT — and the offer to undo is still on screen, against the branch
	// that now holds both halves.
	await expect( ui.revertPatchButton( page ) ).toBeVisible( {
		timeout: 60_000,
	} );

	// The moment the report was about: back on trunk, over a tree that holds
	// none of it, the app used to name the patch, count its files and offer to
	// revert it.
	await ui.unlinkButton( page ).click();
	await expect( ui.revertPatchButton( page ) ).toHaveCount( 0, {
		timeout: 30_000,
	} );
	expect( gitOk( [ 'status', '--porcelain' ], site.dir ).trim() ).toBe( '' );
} );
