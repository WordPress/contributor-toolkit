'use strict';

const test = require('node:test');
const assert = require('node:assert');

const {
	computeSetupStepState,
	setupStepStatuses,
	setupStepCopy,
	setupAutoStartDecision,
	setupStepLabel
} = require('../../src/renderer/setup-steps.cjs');

// The four checklist rows, in order, as the renderer builds them — so the ladder
// tests below read as the screen the contributor is looking at.
function checklist(flags) {
	const state = computeSetupStepState(flags);
	return setupStepStatuses([
		{ key: 'download', ...state.download },
		{ key: 'install', ...state.install },
		{ key: 'build', ...state.build },
		{ key: 'dev', ...state.dev }
	]);
}

function statuses(flags) {
	return Object.fromEntries(checklist(flags).map((s) => [s.key, s.status]));
}

test('while the clone is still running, the install step is locked (issue #47)', () => {
	const steps = computeSetupStepState({ isPending: true });

	assert.strictEqual(steps.download.done, false, 'download must not read as complete mid-clone');
	assert.strictEqual(steps.install.ready, false, 'install must stay locked mid-clone');
	assert.strictEqual(steps.install.disabled, true, 'install button must be disabled mid-clone');
});

test('a pending clone never unlocks the later steps', () => {
	const steps = computeSetupStepState({ isPending: true, hasNodeModules: true, hasBuilt: true });

	assert.strictEqual(steps.install.disabled, true);
	assert.strictEqual(steps.download.done, false);
});

test('once the clone finishes the install step becomes actionable', () => {
	const steps = computeSetupStepState({ isPending: false });

	assert.strictEqual(steps.download.done, true);
	assert.strictEqual(steps.install.ready, true);
	assert.strictEqual(steps.install.disabled, false);
});

test('the status probe still gates the install button', () => {
	const steps = computeSetupStepState({ statusLoading: true });

	assert.strictEqual(steps.install.disabled, true);
});

test('an install in flight disables its own button', () => {
	const steps = computeSetupStepState({ installing: true });

	assert.strictEqual(steps.install.disabled, true);
	assert.strictEqual(steps.install.done, false);
});

test('installed dependencies complete the install step and unlock the build', () => {
	const steps = computeSetupStepState({ hasNodeModules: true });

	assert.strictEqual(steps.install.done, true);
	assert.strictEqual(steps.install.disabled, true, 'nothing left to install');
	assert.strictEqual(steps.build.ready, true);
	assert.strictEqual(steps.build.disabled, false);
});

test('a failed install does not complete the step, even though node_modules exists (issue #42)', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, installFailed: true });

	assert.strictEqual(steps.install.done, false, 'a failed install is not a completed step');
	assert.strictEqual(steps.install.disabled, false, 'the retry must stay available');
	assert.strictEqual(steps.build.ready, false, 'the build stays locked after a failed install');
	assert.strictEqual(steps.build.disabled, true);
});

test('a successful install after a failure completes the step again', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, installFailed: false });

	assert.strictEqual(steps.install.done, true);
	assert.strictEqual(steps.build.ready, true);
});

test('the build stays locked without node_modules', () => {
	const steps = computeSetupStepState({});

	assert.strictEqual(steps.build.ready, false);
	assert.strictEqual(steps.build.disabled, true);
});

test('a finished build completes its step and unlocks the dev server', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true });

	assert.strictEqual(steps.build.done, true);
	assert.strictEqual(steps.build.disabled, true, 'nothing left to build');
	assert.strictEqual(steps.dev.ready, true);
	assert.strictEqual(steps.dev.disabled, false);
});

test('the dev step is never marked done by the checklist', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true, starting: true });

	assert.strictEqual(steps.dev.done, false);
	assert.strictEqual(steps.dev.disabled, true, 'disabled while starting');
});

test('a trunk update in flight locks the checklist even before its own install/build flags are set (#111 review)', () => {
	// The update chain's fetch step runs before `installing`/`building` are
	// ever set, so this reproduces the exact window a race would occur in:
	// node_modules and a build already exist, nothing is "installing" yet,
	// but the working tree is being reset underneath the checklist.
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true, isUpdating: true });

	assert.strictEqual(steps.install.disabled, true, 'install must not race the update chain\'s checkout');
	assert.strictEqual(steps.build.disabled, true, 'build must not race the update chain\'s checkout');
	assert.strictEqual(steps.dev.disabled, true, 'the dev server must not start against a tree the update owns');
});

test('a finished update releases the checklist again', () => {
	const steps = computeSetupStepState({ hasNodeModules: true, hasBuilt: true, isUpdating: false });

	assert.strictEqual(steps.install.disabled, true, 'nothing left to install');
	assert.strictEqual(steps.build.disabled, true, 'nothing left to build');
	assert.strictEqual(steps.dev.disabled, false);
});

test('the current step reads "Ready" until its action starts (#257)', () => {
	// The exact case from the report: a fresh site, install is the next step,
	// nothing is running. It must not claim to be under way.
	assert.strictEqual(setupStepLabel('current', false), 'Ready');
});

test('the current step reads "In progress" once its action is running (#257)', () => {
	assert.strictEqual(setupStepLabel('current', true), 'In progress');
});

test('the other statuses keep their fixed labels regardless of the running flag', () => {
	for (const running of [true, false]) {
		assert.strictEqual(setupStepLabel('complete', running), 'Completed');
		assert.strictEqual(setupStepLabel('failed', running), 'Failed');
		assert.strictEqual(setupStepLabel('pending', running), 'Pending');
		assert.strictEqual(setupStepLabel('locked', running), 'Locked');
	}
});

// --- the ladder (#44, #246) ----------------------------------------------
//
// #44's acceptance criteria are a matrix: before start, during, after success
// and after failure, for each asynchronous step. These walk it. What every one
// of them is really asserting is that the status comes from what is on disk plus
// the last run's outcome — never from where a chain happens to be — because that
// is what lets a half-finished site reopened days later still read true.

test('the ladder walks the checklist: exactly one current step, the rest locked behind it', () => {
	assert.deepStrictEqual(statuses({ isPending: true }), {
		download: 'current', install: 'locked', build: 'locked', dev: 'locked'
	});
});

test('before install starts, install is current and nothing claims to be running (#44)', () => {
	const rows = checklist({});
	assert.deepStrictEqual(statuses({}), {
		download: 'complete', install: 'current', build: 'locked', dev: 'locked'
	});
	// The #44 report itself: the next step must not announce itself as under way.
	assert.strictEqual(setupStepLabel(rows[1].status, false), 'Ready');
});

test('while install runs, its step says so (#44)', () => {
	const rows = checklist({ installing: true });
	assert.strictEqual(rows[1].status, 'current');
	assert.strictEqual(setupStepLabel(rows[1].status, true), 'In progress');
});

test('after a successful install the build takes over as current (#44)', () => {
	assert.deepStrictEqual(statuses({ hasNodeModules: true }), {
		download: 'complete', install: 'complete', build: 'current', dev: 'locked'
	});
});

test('after a failed install the step reads failed, and nothing downstream becomes current (#44)', () => {
	const rows = checklist({ hasNodeModules: true, installFailed: true });
	assert.deepStrictEqual(statuses({ hasNodeModules: true, installFailed: true }), {
		download: 'complete', install: 'failed', build: 'locked', dev: 'locked'
	});
	assert.strictEqual(setupStepLabel(rows[1].status, false), 'Failed');
	// The retry is the point of naming the failure — a failed step with a dead
	// button is worse than no label at all.
	assert.strictEqual(rows[1].disabled, false);
});

test('a retry in flight replaces the failed label rather than sitting under it', () => {
	// installFailed is still recorded — the flag only clears when the next run
	// finishes — so without the `installing` guard the step would read "Failed"
	// while its own retry was streaming output to the terminal.
	const rows = checklist({ hasNodeModules: true, installFailed: true, installing: true });
	assert.strictEqual(rows[1].status, 'current');
	assert.strictEqual(setupStepLabel(rows[1].status, true), 'In progress');
});

test('after a failed build the step reads failed, and the dev server stays locked (#44)', () => {
	assert.deepStrictEqual(statuses({ hasNodeModules: true, buildFailed: true }), {
		download: 'complete', install: 'complete', build: 'failed', dev: 'locked'
	});
});

test('a build that succeeded after failing earlier reads complete, not failed', () => {
	// hasBuilt is the ground truth; a stale buildFailed flag must not outrank it.
	assert.deepStrictEqual(statuses({ hasNodeModules: true, hasBuilt: true, buildFailed: true }), {
		download: 'complete', install: 'complete', build: 'complete', dev: 'current'
	});
});

test('the dev server step is the last current one and never completes itself', () => {
	assert.deepStrictEqual(statuses({ hasNodeModules: true, hasBuilt: true }), {
		download: 'complete', install: 'complete', build: 'complete', dev: 'current'
	});
});

// --- the words on the steps (#246) ---------------------------------------

test('the install step says what it is offering in each of its four states', () => {
	assert.strictEqual(setupStepCopy({}).installLabel, 'Install npm dependencies');
	assert.strictEqual(setupStepCopy({ hasNodeModules: true }).installLabel, 'Dependencies installed');
	assert.strictEqual(
		setupStepCopy({ hasNodeModules: true, installFailed: true }).installLabel,
		'Retry npm install'
	);
	// The retry stays named as a retry while it runs, rather than reverting to
	// the first-run wording halfway through.
	assert.strictEqual(
		setupStepCopy({ hasNodeModules: true, installFailed: true, installing: true }).installLabel,
		'Retry npm install'
	);
});

test('a failed step points at the terminal, since nobody clicked to start it (#246)', () => {
	// The chain runs install and build unattended, so a bare "Failed" would be
	// the first a contributor heard of it with nowhere to look.
	const install = setupStepCopy({ hasNodeModules: true, installFailed: true });
	assert.match(install.installDescription, /Terminal below/);
	const build = setupStepCopy({ hasNodeModules: true, buildFailed: true });
	assert.strictEqual(build.buildLabel, 'Retry the build');
	assert.match(build.buildDescription, /Terminal below/);
});

test('a completed step says where a later install or build lives (#182)', () => {
	const copy = setupStepCopy({ hasNodeModules: true, hasBuilt: true });
	assert.strictEqual(copy.buildLabel, 'Build complete');
	assert.match(copy.installDescription, /Terminal below/);
	assert.match(copy.buildDescription, /Terminal below/);
});

test('the copy and the button state cannot disagree about a failed install', () => {
	// Both come from the same flags: node_modules exists but the install failed,
	// so the step is not done, its button is live, and it says "Retry" (#42).
	const flags = { hasNodeModules: true, installFailed: true };
	assert.strictEqual(computeSetupStepState(flags).install.done, false);
	assert.strictEqual(computeSetupStepState(flags).install.disabled, false);
	assert.strictEqual(setupStepCopy(flags).installLabel, 'Retry npm install');
});

// --- auto-starting the chain (#246) --------------------------------------
//
// The riskiest decision in the feature: too eager and it launches a half-hour
// build nobody asked for, too shy and the wizard never finishes itself.

test('the clone finishing is what asks for a status read', () => {
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: true, isPending: false }),
		'probe'
	);
});

test('a fresh clone with the wizard still on starts the chain', () => {
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: true, isPending: false, status: {} }),
		'start'
	);
});

test('nothing happens while the clone is still running', () => {
	assert.strictEqual(setupAutoStartDecision({ wasPending: true, isPending: true }), 'skip');
});

test('a site that was already cloned when its row appeared never auto-starts', () => {
	// This is what makes reopening the app safe: no edge, no chain, whatever
	// state the site is in.
	assert.strictEqual(setupAutoStartDecision({ wasPending: false, isPending: false }), 'skip');
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: false, isPending: false, status: {} }),
		'skip'
	);
});

test('the chain arms once per row, so a re-render cannot start a second one', () => {
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: true, isPending: false, alreadyArmed: true }),
		'skip'
	);
});

test('a skipped wizard means the contributor drives, so the chain stays out of it', () => {
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: true, isPending: false, status: { skipInitWizard: true } }),
		'skip'
	);
});

test('an existing node_modules is not the fresh clone it looks like', () => {
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: true, isPending: false, status: { hasNodeModules: true } }),
		'skip'
	);
});

test('a status read that failed refuses rather than assuming the site is fresh', () => {
	// null is a failed probe, not an empty one. Guessing here would run npm
	// install against a tree nothing is known about.
	assert.strictEqual(
		setupAutoStartDecision({ wasPending: true, isPending: false, status: null }),
		'skip'
	);
});
