<script setup>
// Wraps the default layout to put <DownloadButton /> in the home hero, where
// the static "Download" action used to sit. The hero's actions come from
// index.md frontmatter and cannot host a component, so the only way for the
// most prominent Download on the page to be the platform-aware one is this
// slot — otherwise the landing page offers two things called "Download" and
// the dumb one is the one people click.
import DefaultTheme from 'vitepress/theme';
import DownloadButton from './DownloadButton.vue';

const { Layout } = DefaultTheme;
</script>

<template>
	<Layout>
		<template #home-hero-actions-after>
			<!-- No alignment of its own: the hero switches between left and
			     centred depending on viewport and whether a hero image is set,
			     so inheriting is the only way the button stays attached to the
			     actions above it. -->
			<DownloadButton />
		</template>
	</Layout>
</template>
