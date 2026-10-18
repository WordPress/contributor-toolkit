'use strict';

// This repository's own lint rules, for what no shared preset knows about it.
// They are switched on in eslint.config.mjs, for the files each one is about.

module.exports = {
	rules: {
		'no-hardcoded-colors': require( './no-hardcoded-colors.cjs' ),
		'no-inline-styles': require( './no-inline-styles.cjs' ),
	},
};
