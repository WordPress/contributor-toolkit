/**
 * Updating a site to the latest trunk, driven through the app (#385).
 *
 * The update crosses every layer at once: the main process fetches from the
 * site's own origin and resets the checkout, the renderer runs the install
 * and build steps and clears the marker that says the update is incomplete,
 * and the store keeps the new snapshot. Only a journey can say the whole
 * chain ends where the contributor expects it to.
 *
 * The origin is a clone of the site on disk, moved ahead by the test; nothing
 * here reaches the network. The lockfile is left alone so the install step is
 * the one the app names as skipped: an `npm install`, even of nothing, is not
 * what this journey is about.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const fs = require( 'node:fs' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite, advanceOrigin, read, write, exists, currentBranch, SUBSTRATE, SUBSTRATE_CONTENT, LOGIN, DOOMED, TRUNK } = require( '../helpers/git-site.cjs' );

const NEWER_LOGIN = '<?php // newer trunk\n';

test( 'an update fetches from the site\'s origin, resets the checkout, rebuilds, and leaves the history whole', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const newTip = advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const { page } = await session.start( site.settings );
	await session.acceptConfirms();

	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();

	// INVARIANT — the chain ends with the app saying so, and with the summary
	// the guide describes: the install step was named as skipped.
	await expect( ui.toast( page, 'Updated to the latest trunk' ) ).toBeVisible( { timeout: 120_000 } );
	await expect( page.getByText( /^Dependencies unchanged, rebuilt/ ) ).toBeVisible( { timeout: 30_000 } );
	await expect( page.getByText( 'Update incomplete', { exact: false } ) ).toHaveCount( 0 );

	// INVARIANT — what the update did is said on the page until it is sent
	// away, by the notice's own button.
	const done = page.getByText( 'Up to date with trunk as of today.', { exact: true } );
	await expect( done ).toBeVisible();
	await done.locator( '..' ).getByRole( 'button', { name: 'Dismiss', exact: true } ).click();
	await expect( done ).toHaveCount( 0 );
	// The notice's own sentence, and not the terminal's, which says the
	// install was skipped in words that begin the same.
	await expect( page.getByText( /^Dependencies unchanged, rebuilt/ ) ).toHaveCount( 0 );

	// INVARIANT — the checkout is the origin's trunk now, still on trunk, and
	// the substrate survived the reset.
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	expect( currentBranch( site.dir ) ).toBe( TRUNK );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );

	// INVARIANT — the update fetched, it did not truncate: no shallow boundary,
	// and the commit the site started on is still behind the new tip.
	expect( exists( site.dir, path.join( '.git', 'shallow' ) ) ).toBe( false );
	expect( fs.readFileSync( path.join( site.dir, '.git', 'FETCH_HEAD' ), 'utf8' ) ).toContain( newTip );

	// CHARACTERISATION — the registry holds the new snapshot and no
	// incomplete-update marker.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.trunkOid ).toBe( newTip );
	expect( meta.updateIncomplete ).toBeFalsy();
} );

/**
 * The update run from a linked ticket, all the way back to trunk (#419).
 *
 * The journey above runs the same chain from trunk, where the flag that says
 * "the code is new but the built assets are old" is written and cleared in the
 * same place and nothing can disagree. From a ticket it is written after the
 * park, while the app is on trunk, and cleared after the return, while it is on
 * the ticket — two scopes, and the bug was that only one of them was ever
 * cleared. Nothing below trunk's own level can see it: the layer-3 test proves
 * the handlers write where they should, and this proves the contributor is not
 * looking at a red banner after a build that succeeded.
 *
 * The step that reveals it is the last one. Everything is quiet until Unlink
 * puts the site back on trunk, which is where the stale flag is read from.
 *
 * The tree is left clean deliberately: an uncommitted edit sends Update to
 * latest trunk through the dirty-tree modal, which discards before it updates
 * and is a different flow with its own journey, the last one in this file.
 * Parking a clean ticket still moves the checkout both ways, which is all
 * this needs.
 */
test( 'an update run from a linked ticket leaves no incomplete marker behind on trunk', async ( { session } ) => {
	const site = await makeSite( session, { origin: true } );
	const newTip = advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const { page } = await session.start( site.settings );
	await session.acceptConfirms();

	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );
	await ui.linkTicket( page, '60002' );
	expect( currentBranch( site.dir ) ).toBe( 'ticket/60002' );

	await ui.siteMenuButton( page ).click();
	await ui.updateTrunkMenuItem( page ).click();

	// INVARIANT — the chain ends where it does from trunk, and it ends with the
	// contributor back on their ticket rather than stranded on trunk.
	await expect( ui.toast( page, 'Updated to the latest trunk' ) ).toBeVisible( { timeout: 120_000 } );
	await expect( page.getByText( 'Update incomplete', { exact: false } ) ).toHaveCount( 0 );
	expect( currentBranch( site.dir ) ).toBe( 'ticket/60002' );
	// And the ticket is still measured from where it started: the update moved
	// trunk, it did not silently carry the branch forward. `branches:rebase` is
	// what does that, when the contributor asks for it.
	expect( read( site.dir, LOGIN ) ).not.toBe( NEWER_LOGIN );

	await ui.unlinkButton( page ).click();
	await expect( ui.ticketField( page ).first() ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — #419 itself. The build ran and succeeded minutes ago; trunk
	// must not be offering to retry it.
	expect( currentBranch( site.dir ) ).toBe( TRUNK );
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	await expect( page.getByText( 'Update incomplete', { exact: false } ) ).toHaveCount( 0 );
	await expect( ui.retryInstallButton( page ) ).toHaveCount( 0 );

	// CHARACTERISATION — the store's side of the same thing: the snapshot moved,
	// and neither scope is left claiming the site is mid-update.
	const meta = session.readSettings().siteMeta[ site.dir ];
	expect( meta.trunkOid ).toBe( newTip );
	expect( meta.updateIncomplete ).toBeFalsy();
	expect( meta.branches[ 'ticket/60002' ].updateIncomplete ).toBeFalsy();
} );

/**
 * The update with edits loose in the tree (#553).
 *
 * An update resets the checkout, and a reset erases what is not committed. So
 * the app asks first, and the question is the only thing between a contributor
 * and their afternoon's work: it has to come up, name what is at stake, do
 * nothing when it is dismissed, and lose the edits only on the answer that
 * says so. The safe answer is the one already chosen when the dialog opens.
 *
 * Two updates in one launch, so both answers are given against a real reset:
 * the origin moves ahead before each.
 */
test( 'an update asks before it resets edits in the tree: cancelling keeps them, saving writes them to a patch first, and only discarding loses them', async ( { session } ) => {
	const MY_EDIT = '<?php // an afternoon of work\n';
	const SECOND_EDIT = '<?php // and another hour\n';
	const NEWEST_LOGIN = '<?php // newest trunk\n';
	const site = await makeSite( session, { origin: true } );
	advanceOrigin( site.origin, { 'src/wp-login.php': NEWER_LOGIN } );
	const patchDir = session.track( fs.mkdtempSync( path.join( os.tmpdir(), 'wpct-e2e-saved-' ) ) );
	const patchFile = path.join( patchDir, 'saved.diff' );
	const { app, page } = await session.start( site.settings );
	const confirmsAnswered = await session.acceptConfirms();
	await expect( ui.siteMenuButton( page ) ).toBeVisible( { timeout: 30_000 } );

	const startUpdate = async () => {
		await ui.siteMenuButton( page ).click();
		await ui.updateTrunkMenuItem( page ).click();
	};
	// The save dialog is the operating system's; the test answers for it. It
	// can also leave it open, as a person reading the file name would, and
	// answer when it chooses: that is how the test looks at the app while a save
	// is under way, and how it knows the app has finished acting on the answer
	// before it looks at the tree.
	const answerSaveDialog = ( answer ) => app.evaluate( ( { dialog }, result ) => {
		dialog.showSaveDialog = async () => result;
	}, answer );
	const leaveSaveDialogOpen = () => app.evaluate( ( { dialog } ) => {
		dialog.showSaveDialog = () => new Promise( ( resolve ) => {
			global.__e2eCloseSaveDialog = resolve;
		} );
	} );
	// The app builds the patch before it asks where to put it, so the save
	// dialog comes up a moment after the click and not with it.
	const saveDialogIsOpen = () => app.evaluate( () => typeof global.__e2eCloseSaveDialog === 'function' );
	const closeSaveDialog = ( answer ) => app.evaluate( ( electron, result ) => {
		global.__e2eCloseSaveDialog( result );
		delete global.__e2eCloseSaveDialog;
	}, answer );
	const dialog = page.getByRole( 'dialog', { name: 'Update to latest trunk?' } );
	const saveChoice = dialog.getByRole( 'button', { name: /^Save them as a patch first/ } );
	const discardChoice = dialog.getByRole( 'button', { name: /^Discard them/ } );
	const saveAndUpdate = dialog.getByRole( 'button', { name: 'Save patch & update', exact: true } );
	const discardAndUpdate = dialog.getByRole( 'button', { name: 'Discard & update', exact: true } );

	write( site.dir, DOOMED, MY_EDIT );
	await startUpdate();

	// INVARIANT — the app asks before it touches anything, says how much is at
	// stake and names the file, as Git names it, and the answer already chosen
	// is the one that cannot lose work.
	await expect( dialog ).toBeVisible( { timeout: 30_000 } );
	await expect( dialog.getByText( 'You\'ve changed 1 file in this site. Resetting to trunk would throw them away.', { exact: true } ) ).toBeVisible();
	await expect( dialog.getByText( 'src/doomed.php', { exact: true } ) ).toBeVisible();
	await expect( saveChoice ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( discardChoice ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( saveAndUpdate ).toBeVisible();
	// INVARIANT — which answer is chosen is on screen as well as said to a
	// screen reader: the chosen one is ringed in the design system's brand
	// colour and the other is not. And the answer that loses work is in the
	// colour of something going wrong, chosen or not (#557).
	const brand = await ui.tokenColour( page, 'var(--wpds-color-stroke-surface-brand-strong)' );
	const wrong = await ui.tokenColour( page, 'var(--wpds-color-foreground-content-error-weak)' );
	expect( ( await ui.paintOf( saveChoice ) ).border ).toBe( brand );
	expect( await ui.paintOf( discardChoice ) ).toMatchObject( { text: wrong } );
	expect( ( await ui.paintOf( discardChoice ) ).border ).not.toBe( brand );

	// INVARIANT — the button says what the chosen answer will do, and
	// dismissing the dialog does none of it: no confirmation asked, the edit
	// in place, trunk where it was.
	//
	// The tree is not read the instant the dialog is gone: a reset that Cancel
	// had wrongly started would not have touched a file yet. The update is
	// asked for again first. That goes back through the main process's own
	// look at the tree, which has to find the edit for the question to come up
	// a second time, and it cannot come up at all while an update is running.
	await discardChoice.click();
	await expect( discardAndUpdate ).toBeVisible();
	await expect( saveAndUpdate ).toHaveCount( 0 );
	// INVARIANT — and the ring has moved with the choice.
	expect( ( await ui.paintOf( discardChoice ) ).border ).toBe( brand );
	expect( ( await ui.paintOf( saveChoice ) ).border ).not.toBe( brand );
	await dialog.getByRole( 'button', { name: 'Cancel', exact: true } ).click();
	await expect( dialog ).toHaveCount( 0 );
	expect( await confirmsAnswered() ).toBe( 0 );
	await startUpdate();
	await expect( dialog.getByText( 'src/doomed.php', { exact: true } ) ).toBeVisible( { timeout: 30_000 } );
	expect( read( site.dir, DOOMED ) ).toBe( MY_EDIT );
	expect( read( site.dir, LOGIN ) ).toBe( '<?php // trunk\n' );

	// INVARIANT — asked again, the dialog is back on the safe answer, not on
	// the one it was left on.
	await expect( saveChoice ).toHaveAttribute( 'aria-pressed', 'true' );

	// INVARIANT — while a save is under way the question cannot be dismissed
	// from under it: the save dialog is still up, and this one's close button
	// leaves it where it is.
	await leaveSaveDialogOpen();
	await saveAndUpdate.click();
	await expect.poll( saveDialogIsOpen ).toBe( true );
	await expect( saveAndUpdate ).toBeDisabled();
	await ui.closeDialogButton( dialog ).click();
	// The close button fades the dialog out first and asks to close it when
	// the fade is done, so for a fifth of a second the dialog is on screen
	// whether or not it is about to go. The class is the components' own mark
	// of that fade, and the one selector here that reads markup: there is no
	// role or text for "has finished deciding". With animations off it is
	// never there and the wait is nothing.
	await expect( page.locator( '.components-modal__screen-overlay.is-animating-out' ) ).toHaveCount( 0 );
	await expect( dialog ).toBeVisible();
	expect( await saveDialogIsOpen() ).toBe( true );

	// INVARIANT — backing out of the save dialog leaves the question open and
	// the edit in place: nothing is reset for a patch that was never written.
	await closeSaveDialog( { canceled: true } );
	await expect( saveAndUpdate ).toBeEnabled();
	await expect( dialog ).toBeVisible();
	expect( read( site.dir, DOOMED ) ).toBe( MY_EDIT );

	// INVARIANT — saving writes the edit to the file the contributor chose
	// before the reset, and then the update runs: the edit is gone from the
	// tree, it is in the patch, and the checkout is the newer trunk.
	await answerSaveDialog( { canceled: false, filePath: patchFile } );
	await saveAndUpdate.click();
	await expect( ui.toast( page, 'Updated to the latest trunk' ) ).toBeVisible( { timeout: 120_000 } );
	await expect( dialog ).toHaveCount( 0 );
	expect( fs.readFileSync( patchFile, 'utf8' ) ).toContain( '+<?php // an afternoon of work' );
	// INVARIANT — and the notice that the update is done says where the edit
	// went: it is the one place that still names the file once the dialog and
	// the confirmation are gone.
	await expect( page.getByText( `Your changes were saved to ${ patchFile } before the reset.` ) ).toBeVisible();
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	expect( read( site.dir, LOGIN ) ).toBe( NEWER_LOGIN );
	expect( await confirmsAnswered() ).toBe( 0 );

	// INVARIANT — discarding asks once more before it does, loses the edit
	// and no other file, and then the update runs.
	advanceOrigin( site.origin, { 'src/wp-login.php': NEWEST_LOGIN }, 'trunk moves on again' );
	write( site.dir, DOOMED, SECOND_EDIT );
	await startUpdate();
	await expect( dialog ).toBeVisible( { timeout: 30_000 } );
	await discardChoice.click();
	await discardAndUpdate.click();
	await expect.poll( () => read( site.dir, LOGIN ), { timeout: 120_000 } ).toBe( NEWEST_LOGIN );
	await expect( dialog ).toHaveCount( 0 );
	expect( await confirmsAnswered() ).toBe( 1 );
	expect( read( site.dir, DOOMED ) ).toBe( '<?php // to be deleted\n' );
	expect( read( site.dir, SUBSTRATE ) ).toBe( SUBSTRATE_CONTENT );
} );
