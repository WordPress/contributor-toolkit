'use strict';

/**
 * Derives the done/ready/disabled state of every step in the site setup
 * checklist.
 *
 * Kept as a pure, dependency-free module so it can be unit tested without a
 * DOM: the renderer bundle imports it, `node --test` requires it directly.
 *
 * `isPending` means the `wordpress-develop` clone for this site is still
 * running, so nothing that touches the working tree may be offered yet.
 */
function computeSetupStepState(flags = {}) {
	const isPending = Boolean(flags.isPending);
	const statusLoading = Boolean(flags.statusLoading);
	const hasNodeModules = Boolean(flags.hasNodeModules);
	const hasBuilt = Boolean(flags.hasBuilt);
	const installing = Boolean(flags.installing);
	const building = Boolean(flags.building);
	const starting = Boolean(flags.starting);

	return {
		download: {
			done: !isPending,
			ready: true
		},
		install: {
			done: hasNodeModules,
			ready: !isPending,
			disabled: isPending || statusLoading || installing || hasNodeModules
		},
		build: {
			done: hasBuilt,
			ready: hasNodeModules,
			disabled: statusLoading || building || !hasNodeModules || hasBuilt
		},
		dev: {
			done: false,
			ready: hasBuilt,
			disabled: statusLoading || starting || !hasBuilt
		}
	};
}

module.exports = { computeSetupStepState };
