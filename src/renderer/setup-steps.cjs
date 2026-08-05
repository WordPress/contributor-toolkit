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
	const installFailed = Boolean(flags.installFailed);

	// node_modules existing is not evidence the install succeeded: a failed
	// install leaves a partial one behind, and treating that as a completed
	// step disabled the retry and unlocked a build that could not work (#42).
	// The recorded outcome of the last install run overrides existence.
	const installOk = hasNodeModules && !installFailed;

	return {
		download: {
			done: !isPending,
			ready: true
		},
		install: {
			done: installOk,
			ready: !isPending,
			disabled: isPending || statusLoading || installing || installOk
		},
		build: {
			done: hasBuilt,
			ready: installOk,
			disabled: statusLoading || building || !installOk || hasBuilt
		},
		dev: {
			done: false,
			ready: hasBuilt,
			disabled: statusLoading || starting || !hasBuilt
		}
	};
}

module.exports = { computeSetupStepState };
