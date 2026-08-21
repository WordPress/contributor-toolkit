// The user-agent → platform decision behind the docs site's <DownloadButton />.
// The module lives in docs/.vitepress/theme/ because the browser loads it, but
// the docs package has no test harness, so its test lives here in the root
// suite. ESM module, CJS suite: imported dynamically.
const { describe, it, before } = require( 'node:test' );
const assert = require( 'node:assert' );

// Real user-agent strings, not synthetic ones — the iOS case exists precisely
// because every iPhone UA contains "like Mac OS X".
const UA = {
	macChrome:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
	macSafari:
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
	windows:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
	linuxX11:
		'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
	linuxFirefox:
		'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
	android:
		'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
	iphone:
		'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
	ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
};

describe( 'matchPlatform', () => {
	let matchPlatform;
	let PLATFORMS;

	before( async () => {
		( { matchPlatform, PLATFORMS } = await import(
			'../../docs/.vitepress/theme/match-platform.mjs'
		) );
	} );

	it( 'maps each desktop OS to its platform', () => {
		assert.strictEqual( matchPlatform( UA.macChrome ).id, 'mac' );
		assert.strictEqual( matchPlatform( UA.macSafari ).id, 'mac' );
		assert.strictEqual( matchPlatform( UA.windows ).id, 'windows' );
		assert.strictEqual( matchPlatform( UA.linuxX11 ).id, 'linux' );
		assert.strictEqual( matchPlatform( UA.linuxFirefox ).id, 'linux' );
	} );

	it( 'returns null for mobile, which has no build', () => {
		// Android UAs contain "Linux"…
		assert.strictEqual( matchPlatform( UA.android ), null );
		// …and iOS UAs contain "like Mac OS X". A .dmg on an iPhone helps nobody.
		assert.strictEqual( matchPlatform( UA.iphone ), null );
		assert.strictEqual( matchPlatform( UA.ipad ), null );
	} );

	it( 'returns null for an unrecognised user agent', () => {
		assert.strictEqual( matchPlatform( 'curl/8.6.0' ), null );
	} );

	it( 'matches the published asset names, loose on the arch token', () => {
		const names = {
			windows: 'wordpress-contributor-toolkit-0.1.2-win-x64.exe',
			mac: 'wordpress-contributor-toolkit-0.1.2-mac-arm64.dmg',
			linux: 'wordpress-contributor-toolkit-0.1.2-linux-x64.AppImage',
			// electron-builder maps x64 → x86_64 for AppImage when expanding
			// ${arch}, so a rebuild can rename the Linux asset out from under
			// an exact match without any error surfacing anywhere.
			linuxRenamed:
				'wordpress-contributor-toolkit-0.2.0-linux-x86_64.AppImage',
		};
		const byId = Object.fromEntries( PLATFORMS.map( ( p ) => [ p.id, p ] ) );
		assert.ok( byId.windows.assetPattern.test( names.windows ) );
		assert.ok( byId.mac.assetPattern.test( names.mac ) );
		assert.ok( byId.linux.assetPattern.test( names.linux ) );
		assert.ok( byId.linux.assetPattern.test( names.linuxRenamed ) );
		// No pattern matches another platform's asset.
		for ( const platform of PLATFORMS ) {
			for ( const [ id, name ] of Object.entries( names ) ) {
				if ( id !== platform.id && ! id.startsWith( platform.id ) ) {
					assert.ok(
						! platform.assetPattern.test( name ),
						`${ platform.id } pattern must not match ${ name }`
					);
				}
			}
		}
	} );
} );
