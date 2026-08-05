// The deterministic half of PR review: everything a linter can decide without judgement.
//
// The judgement half — architecture, security, performance, cross-platform — lives in
// .github/ai-review-rules.md and is reviewed by an agent. Keeping the two apart is
// deliberate: style nits mixed into an agent's prompt bury its real findings.
//
// Built on @wordpress/eslint-plugin so this repo follows the same JS standards as
// wordpress-develop and gutenberg.
//
// Note on formatting: `configs.recommended` layers Prettier on top of
// `recommended-with-formatting`, but only when `prettier` is installed. It deliberately
// is not. Indentation here is mixed (tabs in src/*.js, four spaces in
// src/renderer/index.jsx and scripts/azure-sign.cjs), so enabling Prettier today would
// rewrite most of the tree and drown every real finding. .editorconfig steers new code;
// normalising the existing files is a separate job.

import globals from 'globals';
import wordpress from '@wordpress/eslint-plugin';

export default [
	{
		ignores: [
			// esbuild output, committed so the app runs without a build step.
			'src/renderer/bundle.js',
			'src/renderer/bundle.css',
			'src/renderer/index.js',
			'build/',
			'dist/',
			'node_modules/',
		],
	},

	...wordpress.configs.recommended,

	{
		languageOptions: {
			globals: globals.node,
		},
		settings: {
			react: { version: 'detect' },
		},
		rules: {
			// See the formatting note at the top. `prettier` is not a direct dependency,
			// but it arrives transitively under @wordpress/eslint-plugin and the preset
			// enables itself on mere presence — so switching it off has to be explicit.
			'prettier/prettier': 'off',

			// Ships in the same Prettier block, and is formatting too. The codebase
			// consistently writes single-line guards (`if (!url) return false;`); this
			// rule fires on 142 of them and says nothing about correctness.
			curly: 'off',

			// Electron and electron-builder are devDependencies by design: electron-builder
			// bundles them into the artifact rather than resolving them at runtime.
			'import/no-extraneous-dependencies': 'off',

			// The repo predates this config and documents intent in prose comments
			// rather than JSDoc blocks. Requiring them now would flag most of the tree
			// without making anything more correct.
			'jsdoc/require-param-description': 'off',
			'jsdoc/require-returns-description': 'off',
		},
	},

	{
		// Renderer: browser context, bundled by esbuild with the automatic JSX runtime,
		// so React needs no import to be in scope.
		files: [ 'src/renderer/**/*.{js,jsx,cjs}' ],
		languageOptions: {
			globals: { ...globals.browser, ...globals.node },
		},
		rules: {
			'react/react-in-jsx-scope': 'off',
		},
	},

	{
		files: [ 'test/**/*.{js,cjs,mjs}' ],
		languageOptions: {
			globals: { ...globals.node },
		},
	},
];
