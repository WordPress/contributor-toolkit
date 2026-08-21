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
 * `isUpdating` means the trunk-update chain (#94) owns the working tree —
 * its own fetch/checkout step runs before `installing`/`building` are set,
 * so without this flag the checklist's install/build buttons stay clickable
 * during that window and a click races `git.checkout({force: true})`.
 *
 * @param {Object} flags
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
	const buildFailed = Boolean(flags.buildFailed);
	const isUpdating = Boolean(flags.isUpdating);

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
			// A failed attempt is reported as its own state rather than folded
			// into "not done yet" (#44): the difference between a step nobody
			// has started and one that ran and lost is the whole reason a
			// contributor knows to look at the terminal.
			failed: installFailed && !installing,
			disabled: isPending || statusLoading || installing || installOk || isUpdating
		},
		build: {
			done: hasBuilt,
			ready: installOk,
			failed: buildFailed && !building && !hasBuilt,
			disabled: statusLoading || building || !installOk || hasBuilt || isUpdating
		},
		dev: {
			done: false,
			ready: hasBuilt,
			disabled: statusLoading || starting || !hasBuilt || isUpdating
		}
	};
}

/**
 * Walks the checklist and gives every step its status word.
 *
 * The ladder: a finished step is `complete`; a step whose last attempt lost is
 * `failed`; the first unfinished step whose prerequisites are met is `current`;
 * later reachable steps are `pending`; anything still waiting on a prerequisite
 * is `locked`.
 *
 * `failed` outranks `current` so a step that ran and lost keeps the row rather
 * than handing it to whatever comes next — and it does not consume `current`,
 * because the thing to do next is still to retry it.
 *
 * Every one of these states is derived from what is on disk plus the recorded
 * outcome of the last run, never from the position of a chain — which is what
 * lets a site reopened days later, with nothing running, still show the truth.
 *
 * Lived in the renderer as an inline loop until #246; moved here because it is a
 * decision with branches, and those belong in a module by this project's own
 * rule.
 *
 * @param {Array} steps Steps carrying `done`, `ready` and optional `failed`.
 * @return {Array} The same steps, each with a `status`.
 */
function setupStepStatuses(steps = []) {
	let currentCaptured = false;
	return steps.map((step) => {
		let status;
		if (step.done) {
			status = 'complete';
		} else if (step.failed) {
			status = 'failed';
		} else if (!currentCaptured && step.ready) {
			status = 'current';
			currentCaptured = true;
		} else if (step.ready) {
			status = 'pending';
		} else {
			status = 'locked';
		}
		return { ...step, status };
	});
}

/**
 * The status word shown on a checklist step.
 *
 * `current` is the step a contributor should act on next — but being next is
 * not the same as being under way (#257). Its old label, "In progress", read as
 * "the app is already doing this" on a step whose button had not been touched:
 * on a fresh site *Install npm dependencies* announced itself as running while
 * nothing was, so a contributor waited instead of clicking. The distinction the
 * label was missing is `isRunning` — whether the step's own action (the clone,
 * install, build or dev-server start) is actually in flight — which the caller
 * already knows from the flags that drive the buttons. A current step reads
 * "Ready" until that is true, and "In progress" only once it is.
 *
 * Kept here, pure and tested, rather than as a lookup in the component: it is a
 * decision with branches, and those belong in a module by this project's own
 * rule.
 *
 * @param {string}  status    One of complete|failed|current|pending|locked.
 * @param {boolean} isRunning The current step's action is under way.
 * @return {string}
 */
function setupStepLabel(status, isRunning) {
	switch (status) {
		case 'complete':
			return 'Completed';
		case 'failed':
			return 'Failed';
		case 'pending':
			return 'Pending';
		case 'locked':
			return 'Locked';
		default:
			return isRunning ? 'In progress' : 'Ready';
	}
}

/**
 * The button label and description on the install and build steps.
 *
 * Both read differently in four situations — not started, running, done, and
 * failed — and both are strings a contributor reads to decide what to do, so
 * they belong here rather than as ternaries in the component. Derived from the
 * same flags as `computeSetupStepState` so the words and the button state can
 * never disagree.
 *
 * @param {Object} flags The flags computeSetupStepState takes.
 * @return {{installLabel: string, installDescription: string, buildLabel: string, buildDescription: string}}
 */
function setupStepCopy(flags = {}) {
	const state = computeSetupStepState(flags);
	const installFailed = Boolean(flags.installFailed);
	const hasBuilt = Boolean(flags.hasBuilt);

	let installLabel = 'Install npm dependencies';
	if (state.install.done) installLabel = 'Dependencies installed';
	else if (installFailed) installLabel = 'Retry npm install';

	let installDescription = 'Install npm packages so commands can run.';
	if (state.install.done) {
		// Once done, this button never re-enables (#182), so the step says where a
		// later install lives rather than leaving a dead control unexplained.
		installDescription = 'Installed. Added a dependency to package.json since? Run npm install in the Terminal below.';
	} else if (state.install.failed) {
		// A failure the contributor did not start (the chain runs install on its
		// own now) has to say where the evidence is, or "Failed" is all they get.
		installDescription = 'The install did not finish. Its output is in the Terminal below — retry when you have read it.';
	}

	let buildLabel = 'Run full build';
	if (hasBuilt) buildLabel = 'Build complete';
	else if (state.build.failed) buildLabel = 'Retry the build';

	let buildDescription = 'Compile WordPress Core to generate the dist files. Later updates rebuild automatically.';
	if (hasBuilt) {
		buildDescription = 'Built. Edited files in src/ since? Run npm run build in the Terminal below so the site picks them up — updates and applied patches rebuild on their own.';
	} else if (state.build.failed) {
		buildDescription = 'The build did not finish. Its output is in the Terminal below — retry when you have read it.';
	}

	return { installLabel, installDescription, buildLabel, buildDescription };
}

/**
 * What the renderer should do about auto-starting the setup chain (#246).
 *
 * Three answers, because the decision is taken in two halves: the trigger is an
 * edge — the clone going from running to finished — and only once that holds is
 * it worth reading the site's state off disk. So `probe` means "this is the
 * moment, go and read the status", and the caller comes back with that status
 * for the second, final call.
 *
 * Getting the edge wrong is the difference between a wizard that finishes
 * itself and one that launches a half-hour build every time the app opens,
 * which is why this is a tested decision rather than a chain of conditions in
 * an effect. The refusals, and why each one:
 *
 * - not the edge: a site already cloned when its row appeared never triggers,
 *   which is what makes reopening the app safe;
 * - already armed: once per mount, so a re-render cannot start a second chain;
 * - the wizard was skipped: that contributor has said they want the manual path;
 * - node_modules already exists: this is not the fresh clone it looks like, and
 *   the tree may be one somebody is already working in.
 *
 * @param {Object}  root0
 * @param {boolean} root0.wasPending     The clone was running on the last render.
 * @param {boolean} root0.isPending      The clone is running now.
 * @param {boolean} [root0.alreadyArmed] This row has already triggered once.
 * @param {?Object} [root0.status]       A fresh site:status read; omit to ask
 *                                       whether reading one is worthwhile.
 * @return {'skip'|'probe'|'start'}
 */
function setupAutoStartDecision({ wasPending, isPending, alreadyArmed, status } = {}) {
	if (!wasPending || isPending || alreadyArmed) return 'skip';
	if (status === undefined) return 'probe';
	// A read that failed is not evidence the site is fresh, so it refuses.
	if (!status) return 'skip';
	if (status.skipInitWizard || status.hasNodeModules) return 'skip';
	return 'start';
}

module.exports = {
	computeSetupStepState,
	setupStepStatuses,
	setupStepCopy,
	setupAutoStartDecision,
	setupStepLabel
};
