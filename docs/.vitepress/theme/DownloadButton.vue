<script setup>
// A download button that detects the visitor's platform and links straight to
// the matching asset of the latest GitHub release. Release filenames follow the
// artifactName pattern in the root package.json —
// wordpress-contributor-toolkit-<version>-<os>-<arch>.<ext> — so the version is
// baked into every asset name and there is no stable direct-download URL: the
// asset has to be resolved at runtime from the releases API.
//
// Everything platform- and network-dependent happens in onMounted, so the SSR
// build renders the fallback state: a plain link to the Releases page. That is
// also what visitors get on an undetectable platform (mobile, unknown OS), when
// the API call fails (offline, rate-limited), or with JavaScript disabled — the
// button is never worse than the old "pick your file" link.
import { ref, onMounted } from 'vue';
import { matchPlatform, PLATFORMS } from './match-platform.mjs';

const RELEASES_PAGE =
	'https://github.com/WordPress/contributor-toolkit/releases/latest';
const LATEST_RELEASE_API =
	'https://api.github.com/repos/WordPress/contributor-toolkit/releases/latest';

const downloadUrl = ref( RELEASES_PAGE );
const platformId = ref( null );
const platformLabel = ref( null );
const version = ref( null );

// The unauthenticated API allows 60 requests per hour per IP address — and a
// Contributor Day room shares one. Cache the resolved asset for the session so
// each visitor costs one request instead of one per page view.
const CACHE_KEY = 'contributor-toolkit-latest-release';

async function resolveAsset( platform ) {
	try {
		const cached = sessionStorage.getItem( CACHE_KEY );
		if ( cached ) {
			return JSON.parse( cached )[ platform.id ] ?? null;
		}
	} catch {
		// Storage unavailable (private mode, quota): fall through to the API.
	}
	const response = await fetch( LATEST_RELEASE_API );
	if ( ! response.ok ) {
		return null;
	}
	return cacheAndPick( await response.json(), platform );
}

function cacheAndPick( release, platform ) {
	const byPlatform = {};
	for ( const asset of release.assets ) {
		// Only ever hand the browser a GitHub release download; anything else
		// in the API response is not a link this button should follow.
		if ( ! asset.browser_download_url?.startsWith( 'https://github.com/' ) ) {
			continue;
		}
		const match = matchPlatformAsset( asset.name );
		if ( match ) {
			byPlatform[ match ] = {
				url: asset.browser_download_url,
				version: release.tag_name,
			};
		}
	}
	try {
		sessionStorage.setItem( CACHE_KEY, JSON.stringify( byPlatform ) );
	} catch {
		// Storage unavailable: the fetch just happens again on the next page.
	}
	return byPlatform[ platform.id ] ?? null;
}

function matchPlatformAsset( name ) {
	const entry = PLATFORMS.find( ( p ) => p.assetPattern.test( name ) );
	return entry ? entry.id : null;
}

onMounted( async () => {
	const platform = matchPlatform( navigator.userAgent );
	if ( ! platform ) {
		return;
	}
	try {
		const asset = await resolveAsset( platform );
		if ( ! asset ) {
			return;
		}
		downloadUrl.value = asset.url;
		platformId.value = platform.id;
		platformLabel.value = platform.label;
		version.value = asset.version;
	} catch {
		// Offline or rate-limited: keep the Releases page link.
	}
} );
</script>

<template>
	<div class="download-button">
		<a class="download-button__action" :href="downloadUrl">
			<template v-if="platformLabel">
				Download for {{ platformLabel }}
				<span v-if="version" class="download-button__version">{{
					version
				}}</span>
			</template>
			<template v-else>Download from the Releases page</template>
		</a>
		<p v-if="platformId === 'mac'" class="download-button__note">
			Intel Macs are not currently supported.
		</p>
		<p class="download-button__note">
			All platforms and previous versions on the
			<a :href="RELEASES_PAGE" target="_blank" rel="noreferrer"
				>Releases page</a
			>.
		</p>
	</div>
</template>

<style scoped>
.download-button {
	margin: 24px 0;
	text-align: center;
}

/* Sized and colored like the hero's brand action button. */
.download-button__action {
	display: inline-block;
	border-radius: 20px;
	padding: 0 24px;
	line-height: 40px;
	font-size: 14px;
	font-weight: 600;
	color: var( --vp-button-brand-text );
	background-color: var( --vp-button-brand-bg );
	transition:
		color 0.25s,
		background-color 0.25s;
	text-decoration: none;
}

.download-button__action:hover {
	color: var( --vp-button-brand-hover-text );
	background-color: var( --vp-button-brand-hover-bg );
}

.download-button__version {
	margin-left: 6px;
	font-weight: 400;
	opacity: 0.8;
}

.download-button__note {
	margin: 8px 0 0;
	font-size: 13px;
	line-height: 1.5;
	color: var( --vp-c-text-2 );
}

.download-button__note a {
	color: var( --vp-c-brand-1 );
	text-decoration: underline;
	text-underline-offset: 2px;
}
</style>
