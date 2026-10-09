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
	await expect( page.getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
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

// The file in the open site's details, and nowhere else: the preview names
// the same path while it is up. Drawn as a link, it is a button, because it
// opens an application rather than going anywhere.
const affectedFile = ( page, file ) => page
	.getByRole( 'complementary', { name: 'Details of e2e-site', exact: true } )
	.getByRole( 'button', { name: file, exact: true } );

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
	// And it leads the details, above the facts about the checkout: while a
	// change is applied, its files are what the contributor came for.
	await expect(
		page.getByRole( 'complementary', { name: 'Details of e2e-site', exact: true } ).getByRole( 'heading', { level: 2 } ).first()
	).toHaveText( 'Changed files' );
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
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByText( 'also edited', { exact: true } ) ).toHaveCount( 0 );

	// The contributor works on top: an edit to the patched file, and a file
	// of their own.
	write( site.dir, LOGIN, '<?php // fixed by the patch, then by me\n' );
	write( site.dir, 'src/new-helper.php', '<?php // mine\n' );
	await refocus( page );

	// INVARIANT — the patched file stays the patch's, marked as edited since;
	// the new file is the contributor's, marked new. Each is listed once.
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByText( 'also edited', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	await expect( affectedFile( page, 'src/new-helper.php' ).locator( '..' ).getByText( 'new', { exact: true } ) ).toBeVisible();
	await expect( affectedFile( page, 'src/wp-login.php' ) ).toHaveCount( 1 );
	expect( await ui.inDocumentOrder( page, [
		group( page, 'From the patch' ),
		affectedFile( page, 'src/wp-login.php' ),
		group( page, 'Your changes' ),
		affectedFile( page, 'src/new-helper.php' ),
	] ) ).toBe( true );
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
	await expect( affectedFile( page, 'src/new-helper.php' ).locator( '..' ).getByText( 'new', { exact: true } ) ).toBeVisible();
	await expect( affectedFile( page, 'src/wp-login.php' ).locator( '..' ).getByText( 'new', { exact: true } ) ).toHaveCount( 0 );
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
	await review.getByRole( 'button', { name: 'Discard all changes', exact: true } ).click();
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
	await expect( page.getByText( 'src/wp-login.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );

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
