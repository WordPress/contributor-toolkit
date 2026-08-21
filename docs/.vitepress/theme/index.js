// The default theme, extended for <DownloadButton />: a Layout wrapper that
// puts it in the home hero, and a global registration so markdown pages (the
// install section of the guide) can use it too.
import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import DownloadButton from './DownloadButton.vue';

export default {
	extends: DefaultTheme,
	Layout,
	enhanceApp( { app } ) {
		app.component( 'DownloadButton', DownloadButton );
	},
};
