/**
 * The tray along the bottom of the window (#558).
 *
 * The terminal used to be a panel at the foot of a site's page, always there
 * and always that site's. It is in a tray now: the window's, closed until it
 * is asked for, opened from the footer, as tall as it is dragged, and showing
 * whichever site is open. Moving it must not cost a site its terminal, so
 * the first journey is that: each site's terminal is its own, and is still
 * there, with what was printed in it, after the tray was closed and after
 * another site was looked at.
 *
 * The second is the tray's edge: moved with the keyboard and with a pointer,
 * kept inside its limits, and the terminal fitted to the room it is given.
 *
 * What the terminal does with what is typed in it is `terminal.spec.js`.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );
const { DEFAULT_TRAY_HEIGHT, MIN_TRAY_HEIGHT, TRAY_KEY_STEP, trayHeightLimits } = require( '../../../src/renderer/tray.cjs' );

// What the terminal has drawn. It has no role of its own, so it is found by
// the element xterm draws its rows in, inside the tray.
const terminalScreen = ( page ) => ui.tray( page, 'Terminal' ).locator( '.xterm-rows' ).filter( { visible: true } );

test( 'the tray is closed until the footer opens it, shows the open site\'s own terminal, and keeps each one through a close and a look at another site', async ( { session } ) => {
	const first = await makeSite( session, { label: 'first-site' } );
	const second = await makeSite( session, { label: 'second-site' } );
	// The app opens on the newest site.
	second.settings.siteMeta[ second.dir ].createdAt = new Date( Date.now() - 7 * 24 * 60 * 60 * 1000 ).toISOString();
	const { page } = await session.start( {
		sites: [ first.dir, second.dir ],
		siteMeta: { ...first.settings.siteMeta, ...second.settings.siteMeta },
		preferences: {},
	} );
	await expect( ui.siteHeading( page, 'first-site' ) ).toBeVisible( { timeout: 30_000 } );
	const toggle = ui.trayToggle( page, 'Terminal' );
	const tray = ui.tray( page, 'Terminal' );
	const terminal = ui.terminalInput( page );

	// INVARIANT — the window opens with the tray closed: nothing of it on
	// screen, and its button not pressed.
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( tray ).toHaveCount( 0 );
	await expect( page.getByRole( 'heading', { name: 'Terminal', exact: true } ) ).toHaveCount( 0 );

	// INVARIANT — the button opens it: named and headed for what it holds,
	// and the button says so.
	await toggle.click();
	await expect( tray ).toBeVisible();
	await expect( tray.getByRole( 'heading', { level: 2, name: 'Terminal', exact: true } ) ).toBeVisible();
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'true' );
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );

	// INVARIANT — the tray takes its room from the page and covers none of
	// it: the last thing on the page can still be brought wholly into view,
	// above the tray.
	const lastCard = ui.card( page, 'Mail' );
	await lastCard.scrollIntoViewIfNeeded();
	await expect( lastCard ).toBeInViewport( { ratio: 1 } );
	const cardBox = await lastCard.boundingBox();
	const trayBox = await tray.boundingBox();
	expect( cardBox.y + cardBox.height ).toBeLessThanOrEqual( trayBox.y );

	// Something only this site's terminal has: a command it does not know,
	// which it names back. The other site's terminal has not been drawn yet,
	// so this is the one place there is to type.
	await terminal.pressSequentially( 'only-in-first', { delay: 10 } );
	await terminal.press( 'Enter' );
	await expect( terminalScreen( page ) ).toContainText( 'Unsupported command: only-in-first' );

	// INVARIANT — the tray is the window's: it stays open across a change of
	// site, and what it shows is the site now open, whose terminal has none
	// of the other's.
	await ui.sidebarEntry( page, 'second-site' ).click();
	await expect( ui.siteHeading( page, 'second-site' ) ).toBeVisible();
	await expect( tray ).toBeVisible();
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );
	await expect( terminalScreen( page ) ).not.toContainText( 'only-in-first' );

	// INVARIANT — closed from inside, the tray goes and the focus goes back
	// to the button that opened it, not to the top of the document.
	await tray.getByRole( 'button', { name: 'Close', exact: true } ).click();
	await expect( tray ).toHaveCount( 0 );
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
	await expect( toggle ).toBeFocused();

	// INVARIANT — closing it and looking at another site cost the first
	// site's terminal nothing: opened again on that site, what was printed
	// is there.
	await ui.sidebarEntry( page, 'first-site' ).click();
	await expect( ui.siteHeading( page, 'first-site' ) ).toBeVisible();
	await toggle.click();
	await expect( terminalScreen( page ) ).toContainText( 'Unsupported command: only-in-first' );

	// INVARIANT — and the button that opened it closes it.
	await toggle.click();
	await expect( tray ).toHaveCount( 0 );
	await expect( toggle ).toHaveAttribute( 'aria-pressed', 'false' );
} );

test( 'the tray\'s edge is moved with the arrow keys and with a pointer, stays inside its limits, and the terminal is fitted to the room', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	const tray = await ui.openTray( page, 'Terminal' );
	const edge = ui.trayEdge( page );
	const limits = trayHeightLimits( await page.evaluate( () => window.innerHeight ) );
	const height = async () => Math.round( ( await tray.boundingBox() ).height );
	const said = async () => Number( await edge.getAttribute( 'aria-valuenow' ) );
	// How many rows the terminal has drawn, and how many more would fit in
	// the element it is drawn in: none, when it is fitted.
	const fit = () => terminalScreen( page ).evaluate( ( rows ) => {
		const room = rows.closest( '.xterm' ).parentElement.clientHeight;
		const rowHeight = rows.firstElementChild.getBoundingClientRect().height;
		return { rows: rows.children.length, spare: Math.floor( ( room - rows.children.length * rowHeight ) / rowHeight ) };
	} );

	// CHARACTERISATION — it opens at the height it is given until someone
	// moves it. INVARIANT — and the edge says how tall the tray is, and how
	// tall it may be.
	await expect( terminalScreen( page ) ).toContainText( 'WordPress npm helper terminal.' );
	expect( await height() ).toBe( DEFAULT_TRAY_HEIGHT );
	expect( await said() ).toBe( DEFAULT_TRAY_HEIGHT );
	await expect( edge ).toHaveAttribute( 'aria-valuemin', String( limits.min ) );
	await expect( edge ).toHaveAttribute( 'aria-valuemax', String( limits.max ) );
	expect( limits.min ).toBe( MIN_TRAY_HEIGHT );

	// INVARIANT — the terminal has as many rows as the tray has room for.
	await expect.poll( async () => ( await fit() ).spare ).toBe( 0 );
	const rowsAtFirst = ( await fit() ).rows;

	// INVARIANT — the up arrow makes the tray taller by a step, the terminal
	// gains rows to match, and the down arrow takes both back.
	await edge.focus();
	await page.keyboard.press( 'ArrowUp' );
	await expect.poll( height ).toBe( DEFAULT_TRAY_HEIGHT + TRAY_KEY_STEP );
	expect( await said() ).toBe( DEFAULT_TRAY_HEIGHT + TRAY_KEY_STEP );
	await expect.poll( async () => ( await fit() ).spare ).toBe( 0 );
	expect( ( await fit() ).rows ).toBeGreaterThan( rowsAtFirst );
	await page.keyboard.press( 'ArrowDown' );
	await expect.poll( height ).toBe( DEFAULT_TRAY_HEIGHT );
	await expect.poll( async () => ( await fit() ).rows ).toBe( rowsAtFirst );

	// INVARIANT — Home and End are the two limits, and no key goes past
	// either: the page keeps its half of the window.
	await page.keyboard.press( 'Home' );
	await expect.poll( height ).toBe( limits.max );
	await page.keyboard.press( 'ArrowUp' );
	await expect.poll( height ).toBe( limits.max );
	await page.keyboard.press( 'End' );
	await expect.poll( height ).toBe( limits.min );
	await page.keyboard.press( 'ArrowDown' );
	await expect.poll( height ).toBe( limits.min );

	// INVARIANT — dragged, the edge follows the pointer: up by this much
	// makes the tray this much taller, and the terminal is fitted again.
	const edgeBox = await edge.boundingBox();
	const hold = { x: edgeBox.x + edgeBox.width / 2, y: edgeBox.y + edgeBox.height / 2 };
	await page.mouse.move( hold.x, hold.y );
	await page.mouse.down();
	await page.mouse.move( hold.x, hold.y - 60, { steps: 6 } );
	await page.mouse.up();
	await expect.poll( height ).toBe( limits.min + 60 );
	expect( await said() ).toBe( limits.min + 60 );
	await expect.poll( async () => ( await fit() ).spare ).toBe( 0 );

	// INVARIANT — and a drag past the limit stops at it.
	await page.mouse.move( hold.x, hold.y - 60 );
	await page.mouse.down();
	await page.mouse.move( hold.x, 0, { steps: 6 } );
	await page.mouse.up();
	await expect.poll( height ).toBe( limits.max );

	// INVARIANT — the height is the tray's, not the terminal's: closed and
	// opened again, it is as tall as it was left.
	await ui.trayToggle( page, 'Terminal' ).click();
	await expect( tray ).toHaveCount( 0 );
	await ui.trayToggle( page, 'Terminal' ).click();
	await expect.poll( height ).toBe( limits.max );
} );
