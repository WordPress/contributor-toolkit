// The user-agent → platform decision behind <DownloadButton />, kept out of the
// component so the root `node --test` suite can reach it (the docs package has
// no test harness of its own). ESM rather than .cjs because the browser loads
// it as-is through Vite; the test imports it dynamically.
//
// `assetPattern` is matched against the release asset names produced by the
// artifactName pattern in the root package.json. The arch token is matched
// loosely on purpose: electron-builder maps `x64` to `x86_64` for some targets
// (AppImage among them), so an exact `-x64` match is one rebuild away from
// silently missing every Linux asset. macOS stays pinned to `arm64` — the app
// has no Intel build, and the label promises Apple Silicon.
export const PLATFORMS = [
	{
		id: 'windows',
		test: /Windows/,
		assetPattern: /-win-[^.]+\.exe$/,
		label: 'Windows',
	},
	{
		id: 'mac',
		// "Macintosh", not "Mac": every iOS user agent contains "like Mac OS X",
		// and an iPhone cannot open a .dmg. (iPadOS in desktop mode presents
		// itself as a Mac and is genuinely indistinguishable.)
		test: /Macintosh/,
		assetPattern: /-mac-arm64\.dmg$/,
		label: 'macOS (Apple Silicon)',
	},
	{
		id: 'linux',
		test: /Linux|X11/,
		assetPattern: /-linux-[^.]+\.AppImage$/,
		label: 'Linux',
	},
];

/**
 * Pick the download platform for a browser user-agent string, or null when
 * there is no build for it (mobile, unknown OS) and the caller should fall
 * back to the Releases page.
 *
 * @param {string} ua `navigator.userAgent`.
 * @return {?{id: string, test: RegExp, assetPattern: RegExp, label: string}}
 *         The matched platform entry.
 */
export function matchPlatform( ua ) {
	// Android UAs contain "Linux" and iOS UAs contain "like Mac OS X"; there
	// is no build for either.
	if ( /Android|iPhone|iPad|iPod/.test( ua ) ) {
		return null;
	}
	return PLATFORMS.find( ( platform ) => platform.test.test( ua ) ) ?? null;
}
