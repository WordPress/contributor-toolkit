/**
 * The terminal, the logs and the mail, under a site's cards (#557).
 *
 * What each of them does is its own journey's: terminal.spec.js, logs.spec.js
 * and mail.spec.js. This file is about what they are on the page: three
 * regions, each named by its heading, and painted with the design system's
 * colours and not with colours of their own. The terminal is the one that
 * needs saying: it draws itself and is told its colours as values, so that
 * they are the design system's can only be seen by looking.
 *
 * Assertions are marked INVARIANT or CHARACTERISATION; see
 * ticket-branches.spec.js for why.
 */

const { test, expect } = require( '../helpers/app.cjs' );
const ui = require( '../helpers/ui.cjs' );
const { makeSite } = require( '../helpers/git-site.cjs' );

/**
 * A token's colour, as the page resolves it where the site's view is.
 *
 * @param {Object} page
 * @param {string} token The token, as CSS uses it: `var(--…)`.
 * @return {Promise<string>} The colour, as the browser writes one.
 */
const tokenColour = ( page, token ) => page.evaluate( ( expression ) => {
	const probe = document.createElement( 'span' );
	probe.style.color = expression;
	document.body.appendChild( probe );
	const colour = window.getComputedStyle( probe ).color;
	probe.remove();
	return colour;
}, token );

test( 'the terminal, the logs and the mail are regions named by their headings, and the terminal is painted with the design system\'s colours', async ( { session } ) => {
	const site = await makeSite( session );
	const { page } = await session.start( site.settings );
	await expect( ui.terminalHint( page, 'npm run build' ) ).toBeVisible( { timeout: 30_000 } );

	// INVARIANT — each is a region a screen reader can go to, named by a
	// heading of the page's second level, in the order they are on the page.
	const regions = [ 'Terminal', 'Logs', 'Mail' ].map( ( name ) => page.getByRole( 'region', { name, exact: true } ) );
	for ( const [ index, name ] of [ 'Terminal', 'Logs', 'Mail' ].entries() ) {
		await expect( regions[ index ].getByRole( 'heading', { level: 2, name, exact: true } ) ).toBeVisible();
	}
	expect( await ui.inDocumentOrder( page, regions ) ).toBe( true );

	// INVARIANT — the terminal's surface and its text are the design
	// system's: the weak surface the log panes have, with the text's own
	// colour on it. Read where the terminal paints them, since it is told
	// them as values and not by a stylesheet.
	const surface = await tokenColour( page, 'var(--wpds-color-background-surface-neutral-weak)' );
	const text = await tokenColour( page, 'var(--wpds-color-foreground-content-neutral)' );
	const terminal = regions[ 0 ];
	const painted = await terminal.locator( '.xterm-viewport' ).evaluate( ( viewport ) => ( {
		surface: window.getComputedStyle( viewport ).backgroundColor,
		text: window.getComputedStyle( viewport.parentElement.querySelector( '.xterm-rows' ) ).color,
	} ) );
	expect( painted ).toEqual( { surface, text } );
	expect( surface ).not.toBe( text );

	// INVARIANT — and a log pane is the same surface, so that the two read
	// as one kind of thing.
	const pane = regions[ 1 ].getByRole( 'tabpanel' ).locator( '> div' ).first();
	expect( await pane.evaluate( ( element ) => window.getComputedStyle( element ).backgroundColor ) ).toBe( surface );

	// INVARIANT — a command named under the terminal is a button that types
	// it, and what it types is run by the contributor: the prompt holds it.
	await ui.terminalHint( page, 'npm install' ).click();
	await expect( page.locator( '.xterm-rows' ).filter( { visible: true } ).getByText( '$ npm install', { exact: true } ) ).toBeVisible();
} );
