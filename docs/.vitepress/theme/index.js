// The default theme, extended only to register <DownloadButton /> for use in
// markdown pages (the landing page and the install section of the guide).
import DefaultTheme from 'vitepress/theme';
import DownloadButton from './DownloadButton.vue';

export default {
	extends: DefaultTheme,
	enhanceApp( { app } ) {
		app.component( 'DownloadButton', DownloadButton );
	},
};
