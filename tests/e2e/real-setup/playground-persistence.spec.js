const fs = require( 'node:fs/promises' );
const os = require( 'node:os' );
const path = require( 'node:path' );
const { createHash } = require( 'node:crypto' );
const { test, expect } = require( '@playwright/test' );
const { planPlaygroundLaunch, planServeConstants } = require( '../../../src/playground-plan.cjs' );
const { removeTree } = require( '../../../src/remove-tree.js' );
const { removePersistentPlaygroundSite } = require( '../../../src/playground-storage.cjs' );

// A real WordPress is necessary: a mocked CLI cannot prove that the selected
// command retains SQLite and uploads. This stays in the opt-in network lane.
test( 'a gutenberg site keeps posts and uploads across restarts, but not deletion', async () => {
	test.skip( process.env.TOOLKIT_REAL_SETUP !== '1', 'Set TOOLKIT_REAL_SETUP=1 to allow a real network install.' );
	const previousDir = process.cwd();
	const checkout = await fs.mkdtemp( path.join( os.tmpdir(), 'wpct-persistence-' ) );
	// The CLI keys its persistent installation by cwd. This key belongs only
	// to our new fixture, so cleanup cannot reach an existing contributor site.
	process.chdir( await fs.realpath( checkout ) );
	const key = createHash( 'sha256' ).update( process.cwd() ).digest( 'hex' );
	const storedSite = path.join( os.homedir(), '.wordpress-playground', 'sites', key );
	let server;
	try {
		await fs.writeFile( path.join( checkout, 'probe.php' ), '<?php\n/* Plugin Name: Persistence probe */\n' );
		require( '../../../src/hide-child-windows' ).hideChildWindows();
		require( '../../../src/bind-loopback' ).bindLoopbackOnly();
		const { runCLI } = require( '@wp-playground/cli' );
		const config = { strategy: 'plugin-mount', pluginDir: checkout, pluginSlug: 'gutenberg' };
		const launch = () => runCLI( {
			command: 'server',
			...planPlaygroundLaunch( config ),
			verbosity: 'quiet',
			blueprint: { constants: planServeConstants( config ) },
		} );
		server = await launch();
		const created = await server.playground.run( { code: `<?php
			require '/wordpress/wp-load.php';
			$id = wp_insert_post( array( 'post_title' => 'Persistent editor fixture', 'post_status' => 'publish' ) );
			$upload = wp_upload_bits( 'fixture.txt', null, 'persistent upload' );
			echo json_encode( array( 'id' => $id, 'upload' => $upload['file'], 'error' => $upload['error'] ) );
		` } );
		const saved = JSON.parse( created.text );
		expect( saved.id ).toBeGreaterThan( 0 );
		expect( saved.error ).toBe( false );
		await server[ Symbol.asyncDispose ]();
		server = null;
		server = await launch();
		const readSaved = () => server.playground.run( { code: `<?php
			require '/wordpress/wp-load.php';
			$saved = json_decode( '${ JSON.stringify( saved ) }', true );
			echo json_encode( array(
				'title' => get_the_title( $saved['id'] ),
				'upload' => file_exists( $saved['upload'] ) ? file_get_contents( $saved['upload'] ) : null
			) );
		` } );
		const restored = await readSaved();
		expect( JSON.parse( restored.text ) ).toEqual( { title: 'Persistent editor fixture', upload: 'persistent upload' } );
		await server[ Symbol.asyncDispose ]();
		server = null;
		await removePersistentPlaygroundSite( checkout );
		// Creating a new site at the same location must start with a fresh
		// installation, rather than resurrecting the deleted site's content.
		server = await launch();
		const fresh = JSON.parse( ( await readSaved() ).text );
		expect( fresh.title ).not.toBe( 'Persistent editor fixture' );
		expect( fresh.upload ).toBeNull();
	} finally {
		try {
			if ( server ) await server[ Symbol.asyncDispose ]();
		} finally {
			process.chdir( previousDir );
			await removeTree( storedSite );
			await removeTree( checkout );
		}
	}
} );
